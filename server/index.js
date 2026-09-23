'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');

const { db, UPLOAD_DIR } = require('./db');
const { parseFontFile } = require('./font-inspect');
const RangeParser = require('../shared/range-parser');
const UB = require('../shared/unicode-blocks');

const PORT = parseInt(process.env.PORT || '3000', 10);
const MAX_UPLOAD_MB = parseInt(process.env.MAX_UPLOAD_MB || '64', 10);
const MAX_RESULT_ROWS = parseInt(process.env.MAX_RESULT_ROWS || '120000', 10);

const app = express();
app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));
// 共享脚本也直接暴露给浏览器（与 Node 共用一份）
app.use('/shared', express.static(path.join(__dirname, '..', 'shared')));

// ---------- 上传存储 ----------
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => {
      const id = crypto.randomBytes(8).toString('hex');
      const ext = path.extname(file.originalname) || '.font';
      cb(null, `${Date.now()}_${id}${ext}`);
    }
  }),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/\.(ttf|otf|woff2?|ttc)$/i.test(file.originalname)) cb(null, true);
    else cb(new Error('仅支持 .ttf/.otf/.woff/.woff2/.ttc 字体文件'));
  }
});

// ---------- 预处理语句 ----------
const stmts = {
  insertFont: db.prepare(`INSERT INTO fonts
    (name, family_name, version, postscript, format, num_glyphs, units_per_em,
     ascent, descent, line_gap, file_size, sha256, storage_path)
    VALUES (@name, @family_name, @version, @postscript, @format, @num_glyphs,
     @units_per_em, @ascent, @descent, @line_gap, @file_size, @sha256, @storage_path)`),
  findByHash: db.prepare('SELECT * FROM fonts WHERE sha256 = ?'),
  insertCp: db.prepare('INSERT OR IGNORE INTO font_codepoints (font_id, codepoint, gid) VALUES (?, ?, ?)'),
  getFont: db.prepare('SELECT * FROM fonts WHERE id = ?'),
  listFonts: db.prepare('SELECT id, name, family_name, version, postscript, format, num_glyphs, file_size, created_at FROM fonts ORDER BY id DESC'),
  deleteFont: db.prepare('DELETE FROM fonts WHERE id = ?'),
  countCp: db.prepare('SELECT COUNT(*) AS n FROM font_codepoints WHERE font_id = ?'),
  getCps: db.prepare('SELECT codepoint, gid FROM font_codepoints WHERE font_id = ?'),
  insertScan: db.prepare(`INSERT INTO scans
    (font_id, label, range_spec, sample_size, missing_count, fallback_count,
     covered_count, options_json)
    VALUES (@font_id, @label, @range_spec, @sample_size, @missing_count,
     @fallback_count, @covered_count, @options_json)`),
  insertResult: db.prepare('INSERT OR REPLACE INTO scan_results (scan_id, codepoint, status, detected_font, cmap_covered) VALUES (?, ?, ?, ?, ?)'),
  getScan: db.prepare('SELECT * FROM scans WHERE id = ?'),
  listScans: db.prepare(`SELECT s.*, f.family_name AS font_family, f.postscript AS font_postscript
                         FROM scans s JOIN fonts f ON f.id = s.font_id ORDER BY s.id DESC LIMIT 100`),
  getResults: db.prepare('SELECT codepoint, status, detected_font, cmap_covered FROM scan_results WHERE scan_id = ?'),
  deleteScan: db.prepare('DELETE FROM scans WHERE id = ?')
};

// ---------- API：字体 ----------

// 上传并解析。TTC 只取第一个成员入库（其余成员在响应里提示）
app.post('/api/fonts', upload.single('font'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '未收到字体文件' });
  try {
    const hash = crypto.createHash('sha256').update(fs.readFileSync(req.file.path)).digest('hex');
    const existing = stmts.findByHash.get(hash);
    let parsed;
    try {
      parsed = parseFontFile(req.file.path, req.file.originalname);
    } catch (e) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: '字体解析失败：' + e.message });
    }
    const member = parsed.fonts[0];

    if (existing) {
      // 内容相同：删除刚上传的副本，直接复用旧记录
      fs.unlinkSync(req.file.path);
      return res.json({ id: existing.id, deduped: true, font: fontPublic(existing),
                        members: parsed.fonts.length,
                        notice: parsed.fonts.length > 1 ? 'TTC 集合已取首个成员；其余成员未入库' : null });
    }

    const info = {
      name: req.file.originalname,
      family_name: member.meta.family_name,
      version: member.meta.version,
      postscript: member.meta.postscript,
      format: parsed.format,
      num_glyphs: member.meta.num_glyphs,
      units_per_em: member.meta.units_per_em,
      ascent: member.meta.ascent,
      descent: member.meta.descent,
      line_gap: member.meta.line_gap,
      file_size: req.file.size,
      sha256: hash,
      storage_path: req.file.filename
    };

    const tx = db.transaction(() => {
      const r = stmts.insertFont.run(info);
      const fontId = r.lastInsertRowid;
      const insMany = db.transaction(rows => {
        for (const row of rows) stmts.insertCp.run(fontId, row.codepoint, row.gid);
      });
      // 分批，避免超大 cmap 一次性占内存
      const rows = member.cmapRows;
      const BATCH = 20000;
      for (let i = 0; i < rows.length; i += BATCH) insMany(rows.slice(i, i + BATCH));
      return fontId;
    });
    const fontId = tx();

    res.json({
      id: fontId, deduped: false, members: parsed.fonts.length,
      notice: parsed.fonts.length > 1
        ? `TTC 集合含 ${parsed.fonts.length} 个成员，已取首个「${member.meta.family_name}」入库`
        : null,
      font: fontPublic(stmts.getFont.get(fontId))
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/fonts', (req, res) => {
  res.json(stmts.listFonts.all().map(f => ({
    ...f,
    cmap_size: stmts.countCp.get(f.id).n
  })));
});

app.get('/api/fonts/:id', (req, res) => {
  const font = stmts.getFont.get(req.params.id);
  if (!font) return res.status(404).json({ error: '字体不存在' });
  res.json({ ...fontPublic(font), cmap_size: stmts.countCp.get(font.id).n });
});

// 字体 cmap 全量码点（前端用于“声明覆盖 vs 实测”对照）
app.get('/api/fonts/:id/cmap', (req, res) => {
  const font = stmts.getFont.get(req.params.id);
  if (!font) return res.status(404).json({ error: '字体不存在' });
  const rows = stmts.getCps.all(font.id);
  // gid=0 即映射到 .notdef：声明在 cmap 中但无真实字形
  const codepoints = [];
  const notdefCodepoints = [];
  for (const r of rows) (r.gid === 0 ? notdefCodepoints : codepoints).push(r.codepoint);
  codepoints.sort((a, b) => a - b);
  notdefCodepoints.sort((a, b) => a - b);
  res.json({ font_id: font.id, codepoints, notdef_codepoints: notdefCodepoints });
});

// 原始字体文件（供前端 @font-face 加载渲染）
app.get('/api/fonts/:id/raw', (req, res) => {
  const font = stmts.getFont.get(req.params.id);
  if (!font) return res.status(404).send('not found');
  const file = path.join(UPLOAD_DIR, font.storage_path);
  if (!fs.existsSync(file)) return res.status(404).send('file missing');
  const mime = {
    woff2: 'font/woff2', woff: 'font/woff',
    opentype: 'font/otf', truetype: 'font/ttf', collection: 'font/collection'
  }[font.format] || 'application/octet-stream';
  res.setHeader('Content-Type', mime);
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.sendFile(file);
});

app.delete('/api/fonts/:id', (req, res) => {
  const font = stmts.getFont.get(req.params.id);
  if (!font) return res.status(404).json({ error: '字体不存在' });
  stmts.deleteFont.run(font.id);
  const file = path.join(UPLOAD_DIR, font.storage_path);
  if (fs.existsSync(file)) { try { fs.unlinkSync(file); } catch (_) {} }
  res.json({ ok: true });
});

// ---------- API：扫描（浏览器实测结果回传） ----------
app.post('/api/scans', (req, res) => {
  try {
    const { font_id, label, range_spec, options, results } = req.body || {};
    const font = stmts.getFont.get(font_id);
    if (!font) return res.status(404).json({ error: '字体不存在' });
    if (!Array.isArray(results)) return res.status(400).json({ error: 'results 必须是数组' });
    if (results.length > MAX_RESULT_ROWS)
      return res.status(413).json({ error: `单次检测上限 ${MAX_RESULT_ROWS} 码点` });

    // cmap 声明集合，用于标注
    const cpRows = stmts.getCps.all(font.id);
    const cmap = new Map(cpRows.map(r => [r.codepoint, r.gid]));

    let missing = 0, fallback = 0, covered = 0;
    const rows = results.map(r => {
      const status = r.status === 'covered' || r.status === 'fallback' ? r.status : 'missing';
      if (status === 'covered') covered++;
      else if (status === 'fallback') fallback++;
      else missing++;
      return {
        cp: Number(r.codepoint),
        status,
        detected: status === 'fallback' ? String(r.detected_font || 'unknown').slice(0, 200) : null,
        cmap: cmap.has(Number(r.codepoint)) ? 1 : 0
      };
    });

    const tx = db.transaction(() => {
      const r = stmts.insertScan.run({
        font_id,
        label: label ? String(label).slice(0, 200) : null,
        range_spec: String(range_spec || '').slice(0, 10000),
        sample_size: rows.length,
        missing_count: missing,
        fallback_count: fallback,
        covered_count: covered,
        options_json: JSON.stringify(options || {})
      });
      const scanId = r.lastInsertRowid;
      const BATCH = 20000;
      const insMany = db.transaction(batch => {
        for (const x of batch) stmts.insertResult.run(scanId, x.cp, x.status, x.detected, x.cmap);
      });
      for (let i = 0; i < rows.length; i += BATCH) insMany(rows.slice(i, i + BATCH));
      return scanId;
    });
    const scanId = tx();
    res.json({ id: scanId, sample_size: rows.length, missing_count: missing,
               fallback_count: fallback, covered_count: covered });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/scans', (req, res) => res.json(stmts.listScans.all()));

app.get('/api/scans/:id', (req, res) => {
  const scan = stmts.getScan.get(req.params.id);
  if (!scan) return res.status(404).json({ error: '扫描不存在' });
  const font = stmts.getFont.get(scan.font_id);
  res.json({ ...scan, font: fontPublic(font), results: stmts.getResults.all(scan.id) });
});

app.delete('/api/scans/:id', (req, res) => {
  if (!stmts.getScan.get(req.params.id)) return res.status(404).json({ error: '扫描不存在' });
  stmts.deleteScan.run(req.params.id);
  res.json({ ok: true });
});

// ---------- API：范围解析预览 ----------
app.post('/api/ranges/preview', (req, res) => {
  const spec = RangeParser.parse(String(req.body.range || ''));
  const expanded = RangeParser.expand(spec, {
    onlyRenderable: req.body.skip_nonrendering !== false,
    limit: MAX_RESULT_ROWS
  });
  // 按脚本/区块给出分布预览（只统计，不返回全量）
  const byScript = new Map();
  const byBlock = new Map();
  for (const cp of expanded.codepoints) {
    const blk = UB.findBlock(cp);
    const script = blk ? blk.script : 'Unassigned';
    byScript.set(script, (byScript.get(script) || 0) + 1);
    if (blk) byBlock.set(blk.name, (byBlock.get(blk.name) || 0) + 1);
  }
  res.json({
    errors: spec.errors,
    range_count: spec.ranges.length,
    total: expanded.total,
    truncated: expanded.truncated,
    sample: expanded.codepoints.slice(0, 50),
    by_script: [...byScript.entries()].map(([script, count]) => ({ script, count }))
      .sort((a, b) => b.count - a.count),
    by_block: [...byBlock.entries()].map(([block, count]) => ({ block, count }))
      .sort((a, b) => b.count - a.count).slice(0, 100)
  });
});

// ---------- API：对比两个扫描 ----------
app.get('/api/compare/:a/:b', (req, res) => {
  const s1 = stmts.getScan.get(req.params.a);
  const s2 = stmts.getScan.get(req.params.b);
  if (!s1 || !s2) return res.status(404).json({ error: '扫描不存在' });
  const f1 = stmts.getFont.get(s1.font_id);
  const f2 = stmts.getFont.get(s2.font_id);

  const r1 = new Map(stmts.getResults.all(s1.id).map(r => [r.codepoint, r]));
  const r2 = new Map(stmts.getResults.all(s2.id).map(r => [r.codepoint, r]));

  const rank = { covered: 3, fallback: 2, missing: 1 };
  const cps = new Set([...r1.keys(), ...r2.keys()]);
  const improved = [], regressed = [], unchanged = [];
  for (const cp of cps) {
    const a = r1.get(cp), b = r2.get(cp);
    const sa = a ? a.status : 'missing';
    const sb = b ? b.status : 'missing';
    const rec = {
      codepoint: cp,
      before: sa, before_font: a ? a.detected_font : null,
      after: sb, after_font: b ? b.detected_font : null
    };
    const d = (rank[sb] || 1) - (rank[sa] || 1);
    if (d > 0) improved.push(rec); else if (d < 0) regressed.push(rec);
    else if (a && b && a.detected_font !== b.detected_font && (sa === 'fallback' || sb === 'fallback')) {
      rec.note = '回退字体发生变化';
      unchanged.push(rec);
    } else {
      unchanged.push(rec);
    }
  }
  const cmp = (x, y) => x.codepoint - y.codepoint;
  improved.sort(cmp); regressed.sort(cmp);
  res.json({
    before: { scan_id: s1.id, font: fontPublic(f1),
              counts: { covered: s1.covered_count, fallback: s1.fallback_count, missing: s1.missing_count } },
    after: { scan_id: s2.id, font: fontPublic(f2),
             counts: { covered: s2.covered_count, fallback: s2.fallback_count, missing: s2.missing_count } },
    summary: {
      improved: improved.length, regressed: regressed.length,
      unchanged: unchanged.length
    },
    // 明细仅返回有变化的（可很大时由报告导出接口全量给）
    improved, regressed,
    fallback_changed: unchanged.filter(u => u.note)
  });
});

// ---------- JSON 报告导出 ----------
app.get('/api/reports/scans/:id.json', (req, res) => {
  const scan = stmts.getScan.get(req.params.id);
  if (!scan) return res.status(404).json({ error: '扫描不存在' });
  const font = stmts.getFont.get(scan.font_id);
  const results = stmts.getResults.all(scan.id);

  const byScript = groupResults(results);
  const report = {
    report: 'font-coverage-scan',
    generated_at: new Date().toISOString(),
    font: {
      ...fontPublic(font),
      sha256: font.sha256,
      file_size: font.file_size
    },
    scan: {
      id: scan.id, label: scan.label, created_at: scan.created_at,
      range_spec: scan.range_spec,
      options: safeParse(scan.options_json),
      sample_size: scan.sample_size,
      covered_count: scan.covered_count,
      fallback_count: scan.fallback_count,
      missing_count: scan.missing_count,
      coverage_rate: scan.sample_size
        ? +(scan.covered_count / scan.sample_size * 100).toFixed(2) : 0
    },
    by_script: byScript,
    results: results.map(r => ({
      codepoint: 'U+' + r.codepoint.toString(16).toUpperCase().padStart(4, '0'),
      decimal: r.codepoint,
      char: String.fromCodePoint(r.codepoint),
      status: r.status,
      detected_font: r.detected_font,
      cmap_covered: !!r.cmap_covered
    }))
  };
  res.setHeader('Content-Disposition',
    `attachment; filename="coverage-scan-${scan.id}.json"`);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.send(JSON.stringify(report, null, 2));
});

app.get('/api/reports/compare/:a/:b.json', (req, res) => {
  // 复用对比逻辑：内部简单重算
  const s1 = stmts.getScan.get(req.params.a);
  const s2 = stmts.getScan.get(req.params.b);
  if (!s1 || !s2) return res.status(404).json({ error: '扫描不存在' });
  const f1 = stmts.getFont.get(s1.font_id);
  const f2 = stmts.getFont.get(s2.font_id);
  const r1 = new Map(stmts.getResults.all(s1.id).map(r => [r.codepoint, r]));
  const r2 = new Map(stmts.getResults.all(s2.id).map(r => [r.codepoint, r]));

  const rank = { covered: 3, fallback: 2, missing: 1 };
  const diffs = [];
  for (const cp of new Set([...r1.keys(), ...r2.keys()])) {
    const a = r1.get(cp), b = r2.get(cp);
    const sa = a ? a.status : 'missing', sb = b ? b.status : 'missing';
    if (sa !== sb || (a && b && a.detected_font !== b.detected_font)) {
      diffs.push({
        codepoint: 'U+' + cp.toString(16).toUpperCase().padStart(4, '0'),
        decimal: cp, char: String.fromCodePoint(cp),
        before: sa, before_font: a ? a.detected_font : null,
        after: sb, after_font: b ? b.detected_font : null
      });
    }
  }
  diffs.sort((x, y) => x.decimal - y.decimal);

  const report = {
    report: 'font-coverage-comparison',
    generated_at: new Date().toISOString(),
    before: { scan_id: s1.id, label: s1.label, font: fontPublic(f1),
              counts: { covered: s1.covered_count, fallback: s1.fallback_count, missing: s1.missing_count } },
    after: { scan_id: s2.id, label: s2.label, font: fontPublic(f2),
             counts: { covered: s2.covered_count, fallback: s2.fallback_count, missing: s2.missing_count } },
    total_differences: diffs.length,
    differences: diffs
  };
  res.setHeader('Content-Disposition',
    `attachment; filename="coverage-compare-${s1.id}-vs-${s2.id}.json"`);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.send(JSON.stringify(report, null, 2));
});

// ---------- 工具 ----------
function fontPublic(f) {
  if (!f) return null;
  const { storage_path, sha256, ...pub } = f;
  return pub;
}
function safeParse(s) { try { return JSON.parse(s); } catch { return {}; } }

function groupResults(results) {
  const map = new Map();
  for (const r of results) {
    const blk = UB.findBlock(r.codepoint);
    const script = blk ? blk.script : 'Unassigned';
    const block = blk ? blk.name : 'Unassigned';
    if (!map.has(script)) map.set(script, new Map());
    const blocks = map.get(script);
    if (!blocks.has(block)) blocks.set(block, { total: 0, covered: 0, fallback: 0, missing: 0, gaps: [] });
    const g = blocks.get(block);
    g.total++;
    g[r.status]++;
    if (r.status !== 'covered') {
      g.gaps.push({
        codepoint: 'U+' + r.codepoint.toString(16).toUpperCase().padStart(4, '0'),
        char: String.fromCodePoint(r.codepoint),
        status: r.status,
        detected_font: r.detected_font,
        cmap_covered: !!r.cmap_covered
      });
    }
  }
  const out = [];
  for (const [script, blocks] of map) {
    const bs = [];
    let total = 0, covered = 0, fallback = 0, missing = 0;
    for (const [block, g] of blocks) {
      total += g.total; covered += g.covered; fallback += g.fallback; missing += g.missing;
      bs.push({
        block, total: g.total, covered: g.covered, fallback: g.fallback,
        missing: g.missing,
        coverage_rate: +(g.covered / g.total * 100).toFixed(2),
        gap_count: g.gaps.length,
        gaps: g.gaps
      });
    }
    out.push({
      script, total, covered, fallback, missing,
      coverage_rate: +(covered / total * 100).toFixed(2),
      blocks: bs.sort((a, b) => b.gap_count - a.gap_count)
    });
  }
  return out.sort((a, b) => b.missing - a.missing || b.total - a.total);
}

// ---------- 错误处理 & 启动 ----------
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(413).json({ error: `上传失败：${err.message}（上限 ${MAX_UPLOAD_MB}MB）` });
  }
  if (err) return res.status(400).json({ error: err.message });
  next();
});

app.listen(PORT, () => {
  console.log(`字体覆盖率实验台已启动：http://localhost:${PORT}`);
});
