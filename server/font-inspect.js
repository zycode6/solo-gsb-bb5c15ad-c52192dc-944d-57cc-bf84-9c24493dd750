'use strict';

/**
 * 字体解析：fontkit 读取元数据与 cmap；返回声明覆盖的码点表。
 * 支持 ttf / otf / woff / woff2 / ttc（取第一个或全部 collection）。
 */
const fontkit = require('fontkit');

function detectFormat(name) {
  const n = name.toLowerCase();
  if (n.endsWith('.woff2')) return 'woff2';
  if (n.endsWith('.woff')) return 'woff';
  if (n.endsWith('.otf')) return 'opentype';
  if (n.endsWith('.ttc')) return 'collection';
  if (n.endsWith('.ttf')) return 'truetype';
  return 'unknown';
}

/**
 * @param {string} filePath
 * @param {string} originalName
 * @returns {{ meta: object, fonts: Array<{meta:object, codepoints: number[]}> }}
 */
function parseFontFile(filePath, originalName) {
  const buf = require('fs').readFileSync(filePath);
  const decoded = fontkit.create(buf);

  // TTC：decoded.fonts 为各成员；单字体时直接用 decoded
  const members = decoded.fonts ? decoded.fonts : [decoded];
  const fonts = members.map((font, idx) => extractMember(font, idx, members.length));
  return { format: detectFormat(originalName), fonts };
}

function extractMember(font, index, total) {
  // fontkit v1：命名字段为 Font 实例上的 getter
  const familyName = font.familyName || null;
  const fullName = font.fullName || familyName || null;
  const version = (font.version || '').replace(/^Version\s+/i, '') || null;
  const postscript = font.postscriptName || null;

  // cmap：characterSet 已给出该字体支持的码点数组
  let codepoints = [];
  try {
    codepoints = font.characterSet.filter(
      cp => cp !== 0 && cp <= 0x10FFFF && !(cp >= 0xD800 && cp <= 0xDFFF)
    );
  } catch (e) {
    codepoints = [];
  }

  // 取每个码点的 glyph id（批量映射，用于报告）
  const cmapRows = [];
  for (const cp of codepoints) {
    let gid = null;
    try {
      const g = font.glyphForCodePoint(cp);
      if (g) gid = g.id;
    } catch (_) { /* 忽略单个码点失败 */ }
    cmapRows.push({ codepoint: cp, gid });
  }

  const meta = {
    member_index: total > 1 ? index : null,
    family_name: familyName || fullName || 'Unknown',
    full_name: fullName || 'Unknown',
    version,
    postscript,
    num_glyphs: font.numGlyphs || codepoints.length,
    units_per_em: font.unitsPerEm || null,
    ascent: font.ascent ?? null,
    descent: font.descent ?? null,
    line_gap: font.lineGap ?? null
  };
  return { meta, cmapRows };
}

module.exports = { parseFontFile, detectFormat };
