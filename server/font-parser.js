/**
 * 字体元数据与 cmap（声明覆盖）解析。
 * 使用 fontkit：支持 TTF / OTF / WOFF / WOFF2 / TTC（TTC 取第 0 个 face）。
 * 注意：cmap 只代表字体「声明有此码位」，字形是否为 .notdef / 空白
 *       需由前端 Canvas 真实渲染判定（见 public/js/detector.js）。
 */
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as fontkit from 'fontkit';

/** 依据魔数判定字体容器格式 */
export function sniffFormat(buf) {
  if (buf.length >= 4) {
    const tag = buf.toString('latin1', 0, 4);
    if (tag === 'wOFF') return 'woff';
    if (tag === 'wOF2') return 'woff2';
    if (tag === 'ttcf' || tag === 'OTTO') return 'otf/ttc';
    if (buf[0] === 0x00 && buf[1] === 0x01 && buf[2] === 0x00 && buf[3] === 0x00) {
      return 'ttf';
    }
    // 某些 TTC 字体首标签为 true
    if (tag === 'true') return 'ttf';
  }
  return 'unknown';
}

export async function sha256(filePath) {
  const content = await fs.readFile(filePath);
  return createHash('sha256').update(content).digest('hex');
}

/**
 * 解析字体文件。
 * @param {string} filePath
 * @returns {Promise<{meta:object, cmapRanges:number[][], cmapTotal:number, warning:string|null}>}
 */
export async function parseFont(filePath) {
  const buf = await fs.readFile(filePath);
  const format = sniffFormat(buf);
  let font;
  let warning = null;

  const open = () => {
    const f = fontkit.create(buf);
    return f.fonts ? f.fonts[0] : f;
  };

  try {
    font = open();
  } catch (err) {
    warning = `服务端无法解析该字体（${err.message}）；不影响浏览器渲染检测，但无法提供 cmap 预估。`;
  }

  const meta = {
    format,
    familyName: null,
    subfamilyName: null,
    fullName: null,
    postscriptName: null,
    version: null,
    copyright: null,
  };

  let cmapRanges = [];
  let cmapTotal = 0;

  if (font) {
    const pick = (v) => {
      if (v == null) return null;
      const s = String(v).replace(/\0+$/g, '').trim();
      return s || null;
    };
    // fontkit v2：名字字段直接挂在 font 顶层；v1 在 font.name 上
    const src = font.familyName !== undefined ? font : font.name ?? {};
    meta.familyName = pick(src.familyName);
    meta.subfamilyName = pick(src.subfamilyName);
    meta.fullName = pick(src.fullName);
    meta.postscriptName = pick(src.postscriptName);
    meta.version = pick(src.version);
    meta.copyright = pick(src.copyright);

    try {
      const cps = font.characterSet; // 码位数组
      cmapRanges = compressCodepoints(cps);
      cmapTotal = cps.length;
    } catch (err) {
      warning = warning
        ? `${warning} cmap 读取失败：${err.message}`
        : `cmap 读取失败：${err.message}`;
    }
  }

  return { meta, cmapRanges, cmapTotal, warning };
}

/** 有序码位数组 → 连续闭区间数组 */
export function compressCodepoints(cps) {
  if (!cps.length) return [];
  const sorted = cps.slice().sort((a, b) => a - b);
  const ranges = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    const cp = sorted[i];
    if (cp === prev) continue;
    if (cp === prev + 1) {
      prev = cp;
    } else {
      ranges.push([start, prev]);
      start = prev = cp;
    }
  }
  ranges.push([start, prev]);
  return ranges;
}

/** 二分查找：码位是否落在声明区间集合内（供报告统计等场景使用） */
export function rangesContain(ranges, cp) {
  let lo = 0;
  let hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const [a, b] = ranges[mid];
    if (cp < a) hi = mid - 1;
    else if (cp > b) lo = mid + 1;
    else return true;
  }
  return false;
}
