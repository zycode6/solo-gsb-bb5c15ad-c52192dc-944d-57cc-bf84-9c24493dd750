'use strict';

/**
 * 浏览器侧字形实测引擎。
 *
 * 原理：
 *  1. 用 FontFace 把上传字体以唯一家族名挂载到 document.fonts；
 *  2. 对每个码点用 4 个字体栈渲染 Canvas：
 *       X = 目标字体 + 参考栈A(serif)     Y = 目标字体 + 参考栈B(sans-serif)
 *       A = 参考栈A（不含目标字体）        B = 参考栈B（不含目标字体）
 *     若 X/Y 既非 .notdef 指纹、又与 A/B 不同 → 字形确实来自目标字体 = covered；
 *     若四个渲染都等于 .notdef 指纹 → 任何字体都没有 = missing；
 *     其余（回退栈有字形）= fallback，并进一步逐个候选字体栈匹配渲染指纹，
 *     判定实际命中的字体族；
 *  3. 指纹 = 16×16 二值位图 + 墨迹像素数 + advance width，同字形跨栈像素级一致；
 *  4. 候选字体先经“可用性探测”（渲染宽度/位图差分），未安装的族会被浏览器忽略。
 */
(function (global) {
  const GRID = 16;
  const SENTINELS = [0x0378, 0x03A2, 0x058B]; // Unicode 未分配码点 → 必走 .notdef

  // 常见平台字体候选（检测实际可用性后使用）
  const CANDIDATE_FAMILIES = [
    // 泛族关键字（永远可解析）
    { family: 'serif', generic: true },
    { family: 'sans-serif', generic: true },
    { family: 'monospace', generic: true },
    // Linux
    'Noto Sans', 'Noto Serif', 'Noto Sans CJK SC', 'Noto Sans CJK TC',
    'Noto Sans CJK JP', 'Noto Sans CJK KR', 'Noto Sans Mono CJK SC',
    'WenQuanYi Zen Hei', 'WenQuanYi Micro Hei', 'AR PL UMing CN', 'Droid Sans Fallback',
    'DejaVu Sans', 'DejaVu Serif', 'Liberation Sans',
    // macOS
    'PingFang SC', 'Hiragino Sans GB', 'STSong', 'Heiti SC', 'Arial Unicode MS',
    'Apple Color Emoji', 'Apple SD Gothic Neo', 'Hiragino Sans',
    // Windows
    'Microsoft YaHei', 'SimSun', 'SimHei', 'KaiTi', 'MingLiU', 'Microsoft JhengHei',
    'Malgun Gothic', 'Meiryo', 'Yu Gothic', 'MS Gothic', 'Segoe UI', 'Segoe UI Emoji',
    'Arial', 'Times New Roman', 'Courier New', 'Tahoma',
    // Android
    'Roboto', 'Noto Color Emoji'
  ];

  class GlyphDetector {
    constructor() {
      this.canvas = document.createElement('canvas');
      this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
      this.loaded = new Map();      // fontId -> family
      this.baselineCache = new Map();
      this.availableFamilies = null;
    }

    /** 加载上传字体，返回探测用唯一家族名 */
    async loadFont(fontId, format) {
      if (this.loaded.has(fontId)) return this.loaded.get(fontId);
      const family = `probe-font-${fontId}-${Math.random().toString(36).slice(2, 8)}`;
      const url = `/api/fonts/${fontId}/raw`;
      const fmt = { woff2: 'woff2', woff: 'woff', opentype: 'opentype', truetype: 'truetype' }[format];
      const face = new FontFace(family, `url(${url})${fmt ? ` format("${fmt}")` : ''}`);
      await face.load();
      document.fonts.add(face);
      this.loaded.set(fontId, family);
      this.baselineCache.clear();
      return family;
    }

    /** 探测候选字体在当前系统是否可用（generic 族永远可用） */
    async probeAvailableFamilies() {
      if (this.availableFamilies) return this.availableFamilies;
      // 用“度量敏感字符”做差分：目标族不存在时浏览器退回 monospace
      const probes = [
        { ch: 'WMmwilli01', family: null },
        { ch: '中文漢', family: 'cjk' },
        { ch: 'あカタカナ', family: 'kana' },
        { ch: '한글가나다', family: 'hangul' },
        { ch: 'ؠبتعش', family: 'arabic' },
        { ch: 'δαβψχ', family: 'greek' },
        { ch: '😀🚀❤️', family: 'emoji' }
      ];
      const base = {};
      for (const p of probes) {
        const stack = `monospace, "Apple Color Emoji", "Noto Color Emoji", "Segoe UI Emoji"`;
        base[p.family || 'lat'] = this.fingerprint(p.ch, stack);
      }
      const available = [];
      for (const cand of CANDIDATE_FAMILIES) {
        if (cand.generic) { available.push(cand.family); continue; }
        let ok = false;
        for (const p of probes) {
          const stack = `"${cand.family}", monospace, "Apple Color Emoji", "Noto Color Emoji", "Segoe UI Emoji"`;
          const f1 = this.fingerprint(p.ch, stack);
          const f0 = base[p.family || 'lat'];
          if (!sameFingerprint(f1, f0)) { ok = true; break; }
        }
        if (ok) available.push(cand.family);
      }
      this.availableFamilies = available;
      return available;
    }

    /**
     * 启动批量检测（立即返回句柄；循环在后台异步执行）。
     * @returns {{ done: Promise<{results:object[], totals:object, cancelled:boolean}>,
     *            cancel: ()=>void }}
     */
    scan(opts) {
      const { targetFamily, codepoints, px = 28 } = opts;
      const candidates = opts.candidates && opts.candidates.length
        ? opts.candidates
        : ['serif', 'sans-serif', 'monospace'];

      // 参考栈：泛族放最后兜底，已安装的候选族作为中间层（捕获平台默认回退）
      const refStackA = this.buildStack([], candidates, 'serif');
      const refStackB = this.buildStack([], candidates, 'sans-serif');
      const refStackC = this.buildStack([], candidates, 'monospace');
      const tStackA = this.buildStack([targetFamily], candidates, 'serif');
      const tStackB = this.buildStack([targetFamily], candidates, 'sans-serif');

      const results = [];
      let covered = 0, fallback = 0, missing = 0, blank = 0;
      let cancelled = false;

      const classify = (cp) => {
        const ch = safeChar(cp);
        const X = this.fingerprint(ch, tStackA, px);
        const Y = this.fingerprint(ch, tStackB, px);
        const A = this.fingerprint(ch, refStackA, px);
        const B = this.fingerprint(ch, refStackB, px);
        const C = this.fingerprint(ch, refStackC, px);
        const nX = this.baseline(tStackA, px);
        const nY = this.baseline(tStackB, px);
        const nA = this.baseline(refStackA, px);
        const nB = this.baseline(refStackB, px);
        const nC = this.baseline(refStackC, px);

        // 零墨/零宽：组合记号、变体选择符等独立不可见
        if (X.ink === 0 && Y.ink === 0 && A.ink === 0) {
          const inCmap = opts.cmap ? opts.cmap.has(cp) : false;
          return {
            codepoint: cp,
            status: inCmap ? 'covered' : 'missing',
            detected_font: null, blank: true
          };
        }

        const xIsNotdef = matchesAny(X, nX);
        const yIsNotdef = matchesAny(Y, nY);
        const aIsNotdef = matchesAny(A, nA);
        const bIsNotdef = matchesAny(B, nB);
        const cIsNotdef = matchesAny(C, nC);
        const inCmap = opts.cmap ? opts.cmap.has(cp) : null;
        const cmapToNotdef = opts.cmapNotdef ? opts.cmapNotdef.has(cp) : false;

        // 目标字体确实出了字形（强信号：两条栈都不是 notdef，且与无目标字体时的渲染不同）
        const targetRenders =
          !xIsNotdef && !yIsNotdef && !sameFingerprint(X, A) && !sameFingerprint(Y, B);
        if (targetRenders && !cmapToNotdef) {
          return { codepoint: cp, status: 'covered', detected_font: null };
        }

        // 补强：cmap 声明覆盖、目标栈确实渲染出非空非 notdef 字形。
        // 覆盖“多字体同形”场景（+ - = 等符号在 sans/serif 间设计上像素一致，
        // 差分失效，但字体在栈首优先渲染的就是它自己的字形）。
        // 映射到 .notdef 或空字形的码点会被 notdef/零墨规则先行拦截。
        const xHasGlyph = !xIsNotdef && !yIsNotdef && X.ink > 0 && Y.ink > 0;
        if (xHasGlyph && inCmap === true && !cmapToNotdef) {
          return { codepoint: cp, status: 'covered', detected_font: null, identical_across_fonts:
            sameFingerprint(X, A) && sameFingerprint(Y, B) };
        }
        // cmap 映射到 .notdef，目标栈渲染的就是它自己的缺字框：按缺失处理
        if (cmapToNotdef) {
          return { codepoint: cp, status: 'missing', detected_font: null, cmap_notdef: true };
        }

        // 1) 所有栈都渲染成标准 .notdef → 真正缺字
        if (xIsNotdef && yIsNotdef && aIsNotdef && bIsNotdef && cIsNotdef) {
          return { codepoint: cp, status: 'missing', detected_font: null };
        }

        // 2) 字形在所有栈中像素级一致（含目标栈），且 cmap 未声明该码点：
        //    真实回退字形会随候选字体栈变化；一致说明是字体自带的
        //    “缺字方框/PUA 空白槽”这类非标准 .notdef 渲染，按缺字处理
        const allSame =
          sameFingerprint(X, A) && sameFingerprint(X, B) &&
          sameFingerprint(X, C) && sameFingerprint(X, Y);
        if (allSame && inCmap === false) {
          return { codepoint: cp, status: 'missing', detected_font: null, nonstandard_notdef: true };
        }

        // 其余情况：由回退字体渲染
        let detected = null;
        if (opts.identifyFallback) {
          detected = this.identifyFallback(ch, X, candidates, px);
        }
        return { codepoint: cp, status: 'fallback', detected_font: detected || 'unknown fallback' };
      };

      const done = (async () => {
        for (let i = 0; i < codepoints.length; i++) {
          if (cancelled) break;
          const r = classify(codepoints[i]);
          results.push(r);
          if (r.status === 'covered') covered++;
          else if (r.status === 'fallback') fallback++;
          else missing++;
          if (r.blank) blank++;

          if ((i & 255) === 255 || i === codepoints.length - 1) {
            await tick();
            if (opts.onProgress) {
              opts.onProgress(i + 1, codepoints.length, { covered, fallback, missing, blank });
            }
          }
        }
        return {
          results,
          totals: { covered, fallback, missing, blank, total: results.length },
          cancelled
        };
      })();

      return { done, cancel: () => { cancelled = true; } };
    }

    /** 在候选族中找与目标栈渲染一致的字体（即真正提供该字形的族） */
    identifyFallback(ch, targetFp, candidates, px) {
      // 先看与泛族默认渲染是否一致（平台默认回退）
      for (const generic of ['serif', 'sans-serif', 'monospace']) {
        const f = this.fingerprint(ch, this.buildStack([], candidates, generic), px);
        if (sameFingerprint(f, targetFp)) return generic + ' (default)';
      }
      let checked = 0;
      for (const fam of candidates) {
        if (['serif', 'sans-serif', 'monospace'].includes(fam)) continue;
        if (checked++ >= 20) break; // 控制每个回退码点的探测成本
        const stack = this.buildStack([fam], candidates, 'serif');
        const f = this.fingerprint(ch, stack, px);
        const n = this.baseline(stack, px);
        if (!matchesAny(f, n) && sameFingerprint(f, targetFp)) return fam;
      }
      return null;
    }

    buildStack(primary, candidates, genericTail) {
      const seen = new Set();
      const quote = f =>
        ['serif', 'sans-serif', 'monospace'].includes(f) ? f : `"${f}"`;
      const parts = [];
      for (const f of [...primary, ...candidates]) {
        if (seen.has(f)) continue;
        seen.add(f);
        parts.push(quote(f));
      }
      parts.push(genericTail);
      return parts.join(', ');
    }

    /** 某字体栈的 .notdef 指纹（哨兵码点，缓存） */
    baseline(stack, px) {
      const key = px + '|' + stack;
      if (this.baselineCache.has(key)) return this.baselineCache.get(key);
      const fps = SENTINELS.map(cp => this.fingerprint(safeChar(cp), stack, px));
      // 取多数一致的指纹；不一致则全部作为候选
      const counts = new Map();
      for (const f of fps) {
        const k = f.hash + ':' + f.width.toFixed(1);
        counts.set(k, (counts.get(k) || 0) + 1);
      }
      let best = null, bestN = 0;
      for (const [k, n] of counts) if (n > bestN) { best = k; bestN = n; }
      const ref = fps.find(f => (f.hash + ':' + f.width.toFixed(1)) === best);
      const arr = bestN >= 2 ? [ref] : fps;
      this.baselineCache.set(key, arr);
      return arr;
    }

    /** 渲染字符串并取指纹（16×16 二值网格 + 墨迹数 + 宽度 + 墨框） */
    fingerprint(ch, fontStack, px = 28) {
      const W = Math.ceil(px * 2.2);
      const H = Math.ceil(px * 2.4);
      const baseX = Math.floor(px * 0.4);
      const baseY = Math.floor(px * 1.55);
      this.canvas.width = W;
      this.canvas.height = H;
      const ctx = this.ctx;
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = '#000';
      ctx.font = `${px}px ${fontStack}`;
      ctx.textBaseline = 'alphabetic';
      ctx.textAlign = 'left';
      ctx.fillText(ch, baseX, baseY);

      const data = ctx.getImageData(0, 0, W, H).data;
      let ink = 0, minX = W, minY = H, maxX = -1, maxY = -1;
      const grid = new Uint8Array(GRID * GRID);
      const cellW = W / GRID, cellH = H / GRID;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const a = data[(y * W + x) * 4 + 3];
          if (a > 20) {
            ink++;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
            const gx = Math.min(GRID - 1, Math.floor(x / cellW));
            const gy = Math.min(GRID - 1, Math.floor(y / cellH));
            grid[gy * GRID + gx] = 1;
          }
        }
      }
      // 以实际墨框做归一化网格，消除不同字体水平定位微差
      let normGrid = '';
      if (ink > 0) {
        const bw = Math.max(1, maxX - minX + 1);
        const bh = Math.max(1, maxY - minY + 1);
        const cells = new Uint8Array(GRID * GRID);
        for (let y = minY; y <= maxY; y++) {
          for (let x = minX; x <= maxX; x++) {
            const a = data[(y * W + x) * 4 + 3];
            if (a > 20) {
              const gx = Math.min(GRID - 1, Math.floor((x - minX) / bw * GRID));
              const gy = Math.min(GRID - 1, Math.floor((y - minY) / bh * GRID));
              cells[gy * GRID + gx] = 1;
            }
          }
        }
        normGrid = cells.join('');
      }
      const width = ctx.measureText(ch).width;
      return {
        hash: normGrid,
        ink,
        width,
        bbox: ink ? [maxX - minX + 1, maxY - minY + 1] : [0, 0]
      };
    }
  }

  function matchesAny(fp, arr) {
    return arr.some(f => sameFingerprint(fp, f));
  }

  function sameFingerprint(a, b) {
    if (!a || !b) return false;
    if (a.ink === 0 && b.ink === 0) return true;
    if (a.ink === 0 || b.ink === 0) return false;
    if (Math.abs(a.width - b.width) > 1.0) return false;
    if (Math.abs(a.ink - b.ink) > Math.max(3, a.ink * 0.04)) return false;
    if (Math.abs(a.bbox[0] - b.bbox[0]) > 2 || Math.abs(a.bbox[1] - b.bbox[1]) > 3) return false;
    return a.hash === b.hash;
  }

  function safeChar(cp) {
    try { return String.fromCodePoint(cp); }
    catch { return '�'; }
  }

  function tick() { return new Promise(r => setTimeout(r, 0)); }

  global.GlyphDetector = GlyphDetector;
})(window);
