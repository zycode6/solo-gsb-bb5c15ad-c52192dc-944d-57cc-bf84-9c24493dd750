/**
 * Unicode 范围解析器（前后端共用）。
 *
 * 支持的写法，以逗号/分号/空白分隔，可混用：
 *   U+4E00–U+9FFF      区间（连字符支持 - – — ~）
 *   U+0041             单个码点
 *   4E00-4E10          可省略 U+ 前缀
 *   0x41,0x42          0x 前缀
 *   A                  直接写字面字符（多字符按每个字符解析）
 *   Latin              按脚本名选择全部区块
 *   "CJK Unified Ideographs"  按区块全名选择（带空格需引号或直接写全名片段）
 * 注释用 #
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./unicode-blocks'));
  } else root.RangeParser = factory(root.UnicodeBlocks);
})(typeof self !== 'undefined' ? self : this, function (UB) {
  const SCRIPT_ALIASES = {
    'han': 'CJK', 'cjk': 'CJK', 'chinese': 'CJK', '汉字': 'CJK', '中文': 'CJK',
    'kana': 'Hiragana', 'hiragana': 'Hiragana', 'ひらがな': 'Hiragana',
    'katakana': 'Katakana', 'カタカナ': 'Katakana',
    'hangul': 'Hangul', 'korean': 'Hangul', '한글': 'Hangul',
    'arabic': 'Arabic', '阿拉伯': 'Arabic',
    'cyrillic': 'Cyrillic',
    'greek': 'Greek',
    'thai': 'Thai', '泰文': 'Thai',
    'hebrew': 'Hebrew',
    'devanagari': 'Devanagari',
    'emoji': 'Emoji', '表情': 'Emoji'
  };

  function parseCodepointToken(tok) {
    let t = tok.trim();
    if (!t) return null;
    if (/^[uU]\+/.test(t)) t = t.slice(2);
    else if (/^0[xX]/.test(t)) t = t.slice(2);
    if (!/^[0-9a-fA-F]+$/.test(t)) return null;
    const cp = parseInt(t, 16);
    if (cp > 0x10FFFF) return null;
    return cp;
  }

  /**
   * @returns {{ ranges: Array<{start:number,end:number,label:string}>,
   *           scripts: string[], codepoints: number[], errors: string[] }}
   */
  function parse(input) {
    const errors = [];
    const ranges = [];
    const scriptSet = new Set();
    const codepointSet = new Set();

    if (!input || !input.trim()) {
      errors.push('范围为空');
      return { ranges, scripts: [...scriptSet], codepoints: [], errors };
    }

    // 去掉注释行；逗号/分号/顿号统一作为分隔符（连字符保留给区间）
    const text = input.split(/\r?\n/).map(l => l.replace(/[#＃].*$/, ''))
      .join(' ').replace(/[,;，、]/g, ' ');

    // 引号内的区块名整体作为一个 token
    const tokens = [];
    const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      tokens.push(m[1] !== undefined ? m[1] : (m[2] !== undefined ? m[2] : m[3]));
    }

    for (let raw of tokens) {
      // 区间：a-b / a–b / a—b / a~b（端点带不带 U+ 都行）
      const rangeMatch = raw.match(/^(.+?)\s*[-–—~]\s*(.+)$/);
      if (rangeMatch && /^(?:[uU]\+|0[xX])?[0-9a-fA-F]+$/.test(rangeMatch[1].trim())
          && /^(?:[uU]\+|0[xX])?[0-9a-fA-F]+$/.test(rangeMatch[2].trim())) {
        const a = parseCodepointToken(rangeMatch[1]);
        const b = parseCodepointToken(rangeMatch[2]);
        if (a == null || b == null || a > b) {
          errors.push(`无效区间：${raw}`);
          continue;
        }
        ranges.push({ start: a, end: b, label: `${UB.hex(a)}–${UB.hex(b)}` });
        continue;
      }

      // 十六进制码点
      const cp = parseCodepointToken(raw);
      if (cp != null && /^(?:[uU]\+|0[xX])[0-9a-fA-F]+$|^[0-9a-fA-F]{2,}$/.test(raw.trim())) {
        codepointSet.add(cp);
        continue;
      }

      // 字面字符（按字符展开，支持 AST 码点）
      if (!/^(?:[uU]\+|0[xX])/.test(raw) && /[^\x00-\x7F]/.test(raw) && raw.length >= 1
          && !/[0-9a-fA-F]{2,}/.test(raw)) {
        for (const ch of raw) codepointSet.add(ch.codePointAt(0));
        continue;
      }

      // 脚本名 / 区块名
      const name = raw.trim().toLowerCase();
      const alias = SCRIPT_ALIASES[name];
      if (alias) { scriptSet.add(alias); continue; }

      const exactScript = UB.BLOCKS.find(b => b[3].toLowerCase() === name);
      if (exactScript) { scriptSet.add(exactScript[3]); continue; }

      // 区块名包含匹配（如 CJK Unified）
      const blockHits = UB.BLOCKS.filter(b => b[2].toLowerCase().includes(name));
      if (blockHits.length) {
        for (const b of blockHits) {
          ranges.push({ start: b[0], end: b[1], label: b[2] });
        }
        continue;
      }

      errors.push(`无法识别：${raw}`);
    }

    // 脚本展开为区块区间
    for (const script of scriptSet) {
      for (const b of UB.BLOCKS) {
        if (b[3] === script) ranges.push({ start: b[0], end: b[1], label: b[2] });
      }
    }

    // 合并重叠区间，限制总规模
    const merged = mergeRanges(ranges);
    return {
      ranges: merged,
      scripts: [...scriptSet],
      codepoints: [...codepointSet].sort((a, b) => a - b),
      errors
    };
  }

  function mergeRanges(ranges) {
    if (!ranges.length) return [];
    const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end);
    const out = [sorted[0]];
    for (const r of sorted.slice(1)) {
      const last = out[out.length - 1];
      if (r.start <= last.end + 1) {
        if (r.end > last.end) {
          last.end = r.end;
          last.label = `${UB.hex(last.start)}–${UB.hex(last.end)}`;
        }
      } else out.push({ ...r });
    }
    return out;
  }

  /** 展开为去重后的码点数组；onlyRenderable 时跳过控制/代理码点 */
  function expand(spec, { onlyRenderable = true, limit = 120000 } = {}) {
    const cps = new Set();
    const add = cp => {
      if (onlyRenderable && !UB.isRenderable(cp)) return;
      cps.add(cp);
    };
    for (const cp of spec.codepoints) add(cp);
    for (const r of spec.ranges) {
      for (let cp = r.start; cp <= r.end; cp++) add(cp);
      if (cps.size > limit) break;
    }
    const arr = [...cps].sort((a, b) => a - b);
    return { codepoints: arr.slice(0, limit), truncated: arr.length > limit, total: arr.length };
  }

  return { parse, expand, mergeRanges };
});
