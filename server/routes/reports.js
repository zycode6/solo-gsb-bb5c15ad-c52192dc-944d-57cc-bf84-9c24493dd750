/**
 * 检测报告路由：保存（coverage / comparison）、列表、详情、删除、JSON 下载。
 * 文档由前端按真实检测结果生成，服务端负责校验、持久化与导出。
 */
import express from 'express';
import { stmts } from '../db.js';

export const router = express.Router();

const VALID_KIND = new Set(['coverage', 'comparison']);

function mapListRow(row) {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    fontId: row.font_id,
    fontBId: row.font_b_id,
    rangeInput: row.range_input,
    rangeCount: row.range_count,
    mode: row.mode,
    summary: row.summary ? JSON.parse(row.summary) : null,
    createdAt: row.created_at,
  };
}

function mapFullRow(row) {
  return {
    ...mapListRow(row),
    segments: row.segments ? JSON.parse(row.segments) : null,
    document: JSON.parse(row.document),
  };
}

router.get('/', (req, res) => {
  res.json(stmts.listReports.all().map(mapListRow));
});

router.get('/:id', (req, res) => {
  const row = stmts.getReport.get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: '报告不存在' });
  res.json(mapFullRow(row));
});

router.get('/:id/export', (req, res) => {
  const row = stmts.getReport.get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: '报告不存在' });
  const doc = JSON.parse(row.document);
  const filename = encodeURIComponent(
    `${row.kind}-report-${row.id}-${(row.title || 'font').replace(/[^\w一-龥.-]+/g, '_')}.json`,
  );
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);
  res.send(JSON.stringify(doc, null, 2));
});

router.post('/', (req, res) => {
  const body = req.body ?? {};
  const { kind, title, fontId, fontBId, rangeInput, rangeCount, segments, mode, document } = body;

  if (!VALID_KIND.has(kind)) return res.status(400).json({ error: 'kind 必须为 coverage 或 comparison' });
  if (!document || typeof document !== 'object') {
    return res.status(400).json({ error: '缺少 document 检测文档' });
  }
  if (kind === 'comparison' && !fontBId) {
    return res.status(400).json({ error: '对比报告必须提供 fontBId' });
  }

  const info = stmts.insertReport.run({
    kind,
    title: typeof title === 'string' && title.trim() ? title.trim().slice(0, 200) : null,
    font_id: fontId ? Number(fontId) : null,
    font_b_id: fontBId ? Number(fontBId) : null,
    range_input: typeof rangeInput === 'string' ? rangeInput.slice(0, 5000) : null,
    range_count: Number.isFinite(rangeCount) ? Number(rangeCount) : null,
    segments: Array.isArray(segments) ? JSON.stringify(segments) : null,
    mode: typeof mode === 'string' ? mode.slice(0, 32) : null,
    summary: JSON.stringify(buildListSummary(kind, document)),
    document: JSON.stringify(document),
  });
  res.status(201).json({ id: info.lastInsertRowid });
});

/** 列表页展示用的轻量概要（覆盖：覆盖率/缺字数；对比：修复/回归数） */
function buildListSummary(kind, doc) {
  if (kind === 'comparison') {
    const d = doc.delta || {};
    const rateA = doc.summaryA?.rate;
    const rateB = doc.summaryB?.rate;
    return {
      improved: d.improved ?? 0,
      regressed: d.regressed ?? 0,
      changed: d.changed ?? 0,
      fallbackChanged: d.fallbackChanged ?? 0,
      rateA,
      rateB,
    };
  }
  const s = doc.summary;
  if (!s || typeof s !== 'object') return null;
  return {
    rate: s.rate ?? 0,
    covered: s.covered ?? 0,
    fallback: s.fallback ?? 0,
    missingTofu: s.missingTofu ?? 0,
    missingBlank: s.missingBlank ?? 0,
    missing: s.missing ?? 0,
    discrepancy: s.discrepancy ?? 0,
    total: s.total ?? 0,
  };
}

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!stmts.getReport.get(id)) return res.status(404).json({ error: '报告不存在' });
  stmts.deleteReport.run(id);
  res.status(204).end();
});
