'use strict';

/**
 * 无头验证：用 node-canvas（FontConfig 实际渲染）驱动 public/detect.js 的分类逻辑。
 *
 * 非生产依赖，运行前安装：
 *   npm install --no-save --legacy-peer-deps canvas@2
 * 运行：
 *   node test/headless-detect.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

// ---- 动态构造一个能 require('canvas') 的浏览器垫片模块 ----
const shimDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fcb-shim-'));
const shimPath = path.join(shimDir, 'detect-load.js');
fs.writeFileSync(shimPath, `
const { createCanvas } = require(${JSON.stringify(require.resolve('canvas'))});
const window = {};
const document = {
  createElement: () => createCanvas(120, 100),
  fonts: { add() {} }
};
class FontFace { constructor() {} async load() {} }
window.document = document; window.FontFace = FontFace;
global.window = window; global.document = document; global.FontFace = FontFace;
const src = require('fs').readFileSync(
  ${JSON.stringify(path.join(__dirname, '..', 'public', 'detect.js'))}, 'utf8');
new Function('window', 'document', 'FontFace', src)(window, document, FontFace);
module.exports = window.GlyphDetector;
`);

let GlyphDetector, registerFont, fontkit;
try {
  ({ registerFont } = require('canvas'));
  GlyphDetector = require(shimPath);
  fontkit = require('fontkit');
} catch (e) {
  console.error('缺少测试依赖，请先运行：');
  console.error('  npm install --no-save --legacy-peer-deps canvas@2');
  console.error('\n原始错误：' + e.message);
  process.exit(2);
}

// 用 node-canvas 注册 DejaVu 字体，给唯一族名（模拟 @font-face 加载）
registerFont('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', { family: 'TargetSans' });
registerFont('/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf', { family: 'CandSerif' });
registerFont('/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf', { family: 'CandMono' });

(async () => {
  const det = new GlyphDetector();
  det.loadFont = async () => 'TargetSans';

  const f = fontkit.openSync('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf');
  const cmap = new Set(f.characterSet);

  const cases = [
    [0x41, 'covered', 'Latin A — DejaVu Sans 有'],
    [0x42, 'covered', 'Latin B'],
    [0x3B1, 'covered', '希腊 α — DejaVu Sans 有'],
    [0x4E2D, 'fallback', 'CJK 中（系统无 CJK 字体时可能 missing）'],
    [0x3042, 'fallback', '平假名 あ'],
    [0x1F600, 'fallback', 'Emoji 😀（FontConfig 映射到 DejaVu 本体时可能误判 covered）'],
    [0x0378, 'missing', '未分配码点'],
    [0xE000, 'missing', 'PUA（DejaVu 无映射，渲染为非标准缺字框）']
  ];

  const handle = det.scan({
    targetFamily: 'TargetSans',
    codepoints: cases.map(c => c[0]),
    px: 28,
    candidates: ['CandSerif', 'CandMono', 'serif', 'sans-serif', 'monospace'],
    cmap,
    identifyFallback: true
  });
  const out = await handle.done;

  let pass = 0, fail = 0;
  for (const [cp, expected, desc] of cases) {
    const r = out.results.find(x => x.codepoint === cp);
    let ok;
    if (expected === 'fallback') {
      // 无头环境缺少 CJK/emoji 字体：missing/fallback 都合理；
      // emoji 在 FontConfig 下可能与 serif 同形导致 covered（真实浏览器为彩色字形不会）
      ok = r.status === 'fallback' || r.status === 'missing' ||
        (cp === 0x1F600 && r.status === 'covered');
    } else ok = r.status === expected;
    if (ok) pass++; else fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'} U+${cp.toString(16).toUpperCase().padStart(4, '0')} ` +
      `${String.fromCodePoint(cp)} expected=${expected} got=${r.status} ` +
      `font=${r.detected_font || '-'}  ${desc}`);
  }

  const a = out.results.find(x => x.codepoint === 0x41);
  const unassigned = out.results.find(x => x.codepoint === 0x378);
  const greek = out.results.find(x => x.codepoint === 0x3B1);
  const core = a.status === 'covered' && unassigned.status === 'missing' && greek.status === 'covered';
  console.log(core ? '\n核心判定：✓ covered / .notdef missing 正确区分' : '\n核心判定：✗ 误判');
  if (!core) fail++;

  console.log(`\ntotals:`, JSON.stringify(out.totals));
  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
