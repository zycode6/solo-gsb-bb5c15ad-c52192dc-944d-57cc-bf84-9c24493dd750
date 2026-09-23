/**
 * Unicode 范围解析（前端浏览器与后端 Node 共用的纯 ESM 模块）。
 *
 * 支持的输入写法（逗号 / 分号分隔，可混用）：
 *   - 预设名：            basic-latin, cjk-unified, emoji
 *   - 单个码位：          U+4E2D / 0x4E2D（无前缀时须含数字，如 4E2D）
 *   - 区间：              U+4E00-U+9FFF / 4E00-9FFF
 *   - 字面字符：          测试，Hello！ 或显式加引号 "ABC"
 *   - 注意：裸字母 ABC 按字面量处理（避免与十六进制 0xABC 歧义），
 *           写纯字母码位请用 U+XXXX 前缀。
 *
 * @module shared/ranges
 */

export const MAX_CP = 0x10ffff;
/** 单次检测建议上限（真实渲染模式下超过会提示耗时风险） */
export const ADVISORY_LIMIT = 50000;
/** 硬上限，防止误输入全平面级别范围 */
export const HARD_LIMIT = 500000;

/**
 * 常用预设范围。值为若干闭区间 [起, 止]。
 * @type {Record<string, number[][]>}
 */
export const PRESETS = {
  'ascii-printable': [[0x20, 0x7e]],
  'basic-latin': [[0x20, 0x7f]],
  'latin-1': [[0xa0, 0xff]],
  'latin-ext': [[0x100, 0x24f]],
  ipa: [[0x250, 0x2af]],
  greek: [[0x370, 0x3ff]],
  coptic: [[0x2c80, 0x2cff]],
  cyrillic: [[0x400, 0x4ff], [0x500, 0x52f]],
  armenian: [[0x530, 0x58f]],
  hebrew: [[0x590, 0x5ff]],
  arabic: [[0x600, 0x6ff], [0x750, 0x77f]],
  syriac: [[0x700, 0x74f]],
  thaana: [[0x780, 0x7bf], [0xfdf0, 0xfdff]],
  nko: [[0x7c0, 0x7ff]],
  devanagari: [[0x900, 0x97f]],
  bengali: [[0x980, 0x9ff]],
  gurmukhi: [[0xa00, 0xa7f]],
  gujarati: [[0xa80, 0xaff]],
  oriya: [[0xb00, 0xb7f]],
  tamil: [[0xb80, 0xbff]],
  telugu: [[0xc00, 0xc7f]],
  kannada: [[0xc80, 0xcff]],
  malayalam: [[0xd00, 0xd7f]],
  sinhala: [[0xd80, 0xdff]],
  thai: [[0xe00, 0xe7f]],
  lao: [[0xe80, 0xeff]],
  tibetan: [[0xf00, 0xfff]],
  myanmar: [[0x1000, 0x109f]],
  georgian: [[0x10a0, 0x10ff], [0x2d00, 0x2d2f]],
  'hangul-jamo': [[0x1100, 0x11ff], [0x3130, 0x318f]],
  ethiopic: [[0x1200, 0x137f], [0x1380, 0x139f], [0x2d80, 0x2ddf]],
  cherokee: [[0x13a0, 0x13ff]],
  'canadian-aboriginal': [[0x1400, 0x167f]],
  ogham: [[0x1680, 0x169f]],
  runic: [[0x16a0, 0x16ff]],
  khmer: [[0x1780, 0x17ff], [0x19e0, 0x19ff]],
  mongolian: [[0x1800, 0x18af]],
  ethiopic2: [],
  'general-punctuation': [[0x2000, 0x206f]],
  'super-subscripts': [[0x2070, 0x209f]],
  currency: [[0x20a0, 0x20cf]],
  'letterlike': [[0x2100, 0x214f]],
  arrows: [[0x2190, 0x21ff]],
  math: [[0x2200, 0x22ff], [0x27c0, 0x27ef], [0x2980, 0x2aff]],
  'box-drawing': [[0x2500, 0x257f]],
  'block-elements': [[0x2580, 0x259f]],
  geometric: [[0x25a0, 0x25ff]],
  'misc-symbols': [[0x2600, 0x26ff]],
  dingbats: [[0x2700, 0x27bf]],
  braille: [[0x2800, 0x28ff]],
  glagolitic: [[0x2c00, 0x2c5f]],
  'cjk-symbols': [[0x3000, 0x303f]],
  hiragana: [[0x3040, 0x309f]],
  katakana: [[0x30a0, 0x30ff]],
  bopomofo: [[0x3100, 0x312f], [0x31a0, 0x31bf]],
  'cjk-compat': [[0x3300, 0x33ff]],
  'cjk-ext-a': [[0x3400, 0x4dbf]],
  'cjk-unified': [[0x4e00, 0x9fff]],
  yi: [[0xa000, 0xa48f]],
  'cjk-fullwidth': [[0xff00, 0xffef]],
  'hangul-syllables': [[0xac00, 0xd7af]],
  'cjk-ext-b': [[0x20000, 0x2a6df]],
  'cjk-ext-cdef': [[0x2a700, 0x2ebef]],
  'cjk-compat-ideographs': [[0xf900, 0xfaff], [0x2f800, 0x2fa1f]],
  emoji: [
    [0x231a, 0x231b], [0x23e9, 0x23fa], [0x25aa, 0x27bf],
    [0x2934, 0x2935], [0x2b05, 0x2b55], [0xfe0f, 0xfe0f],
    [0x1f000, 0x1f02f], [0x1f0a0, 0x1f0ff], [0x1f100, 0x1f1ff],
    [0x1f200, 0x1f2ff], [0x1f300, 0x1f9ff],
  ],
  'variation-selectors': [[0xfe00, 0xfe0f], [0xe0100, 0xe01ef]],
  'specials-noncharacters': [[0xfff0, 0xffff], [0x1fffe, 0x1ffff]],
};

/** 提供给前端 datalist 的预设名 */
export const PRESET_NAMES = Object.keys(PRESETS);

const BARE_HEX_RANGE_RE =
  /^([0-9a-fA-F]{1,6})(?:-([0-9a-fA-F]{1,6}))?$/;
const QUOTED_RE = /^["'“”‘’「」『』](.*)["'“”‘’「」『』]$/s;
/** 带显式前缀的十六进制（区间两端均可带前缀） */
const PREFIXED_HEX_RE =
  /^(?:U\+|0x|\\u)([0-9a-fA-F]{1,6})\s*-\s*(?:U\+|0x|\\u)?([0-9a-fA-F]{1,6})$/i;
const PREFIXED_HEX_ONE_RE = /^(?:U\+|0x|\\u)([0-9a-fA-F]{1,6})$/i;

/**
 * 解析范围文本。
 * @param {string} input
 * @returns {{ segments: number[][], count: number, warnings: string[] }}
 * @throws {Error} 输入为空 / 无法识别 / 越界 / 超硬上限
 */
export function parseRangeSpec(input) {
  const warnings = [];
  if (typeof input !== 'string' || !input.trim()) {
    throw new Error('范围不能为空');
  }

  const rawSegments = [];
  const tokens = input.split(/[,;，；]+/).map((t) => t.trim()).filter(Boolean);

  for (const original of tokens) {
    // 仅在连字符两侧去空格，保留字面量内部的空格
    const token = original.replace(/\s*-\s*/g, '-');
    if (!token) continue;

    const preset = PRESETS[token.toLowerCase()];
    if (preset) {
      if (preset.length === 0) {
        warnings.push(`预设「${token}」为空，已跳过`);
      }
      rawSegments.push(...preset);
      continue;
    }

    const quoted = token.match(QUOTED_RE);
    if (quoted) {
      const cps = [...quoted[1]].map((ch) => ch.codePointAt(0));
      for (const cp of cps) rawSegments.push([cp, cp]);
      continue;
    }

    // 带 U+/0x 前缀：明确是十六进制
    const prefixedTwo = token.match(PREFIXED_HEX_RE);
    const prefixedOne = token.match(PREFIXED_HEX_ONE_RE);
    if (prefixedTwo || prefixedOne) {
      const low = parseInt(prefixedTwo ? prefixedTwo[1] : prefixedOne[1], 16);
      const high = prefixedTwo ? parseInt(prefixedTwo[2], 16) : low;
      assertInRange(low, original);
      assertInRange(high, original);
      if (low > high) {
        throw new Error(`范围「${original}」起始码位大于结束码位`);
      }
      rawSegments.push([low, high]);
      continue;
    }

    // 无前缀：仅当整体是「十六进制样式且至少含一个数字」才按码位解析，
    // 否则视为字面量（解决裸字母 "ABC" 与 0xABC 的歧义）
    const bare = token.match(BARE_HEX_RANGE_RE);
    if (bare && /[0-9]/.test(token)) {
      const low = parseInt(bare[1], 16);
      const high = bare[2] === undefined ? low : parseInt(bare[2], 16);
      assertInRange(low, original);
      assertInRange(high, original);
      if (low > high) {
        throw new Error(`范围「${original}」起始码位大于结束码位`);
      }
      rawSegments.push([low, high]);
      continue;
    }

    // 字面量：逐码位展开（同时支持 BMP 与增补平面）
    const cps = [...token].map((ch) => ch.codePointAt(0));
    if (cps.length === 0) {
      throw new Error(`无法识别的片段：「${original}」`);
    }
    for (const cp of cps) rawSegments.push([cp, cp]);
  }

  if (rawSegments.length === 0) {
    throw new Error('未解析出任何有效范围');
  }

  const segments = mergeSegments(rawSegments);
  const count = segments.reduce((n, [lo, hi]) => n + (hi - lo + 1), 0);
  if (count > HARD_LIMIT) {
    throw new Error(`码位总数 ${count.toLocaleString()} 超出硬上限 ${HARD_LIMIT.toLocaleString()}，请收窄范围`);
  }
  if (count > ADVISORY_LIMIT) {
    warnings.push(
      `共 ${count.toLocaleString()} 个码位：真实渲染模式较慢，建议使用「仅 cmap 声明」预估或缩小范围`,
    );
  }
  return { segments, count, warnings };
}

function assertInRange(cp, original) {
  if (cp > MAX_CP) {
    throw new Error(`码位 U+${cp.toString(16).toUpperCase()} 超出 Unicode 范围（「${original}」）`);
  }
}

/** 合并重叠区间 */
export function mergeSegments(raw) {
  const sorted = raw.map(([lo, hi]) => [lo, hi]).sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [lo, hi] of sorted) {
    const last = out[out.length - 1];
    if (last && lo <= last[1] + 1) {
      if (hi > last[1]) last[1] = hi;
    } else {
      out.push([lo, hi]);
    }
  }
  return out;
}

/** 遍历区间内全部码位 */
export function* iterCodepoints(segments) {
  for (const [lo, hi] of segments) {
    for (let cp = lo; cp <= hi; cp++) yield cp;
  }
}

export function formatSegments(segments) {
  return segments
    .map(([lo, hi]) => (lo === hi ? toHex(lo) : `${toHex(lo)}-${toHex(hi)}`))
    .join(', ');
}

export function toHex(cp) {
  return 'U+' + cp.toString(16).toUpperCase().padStart(4, '0');
}
