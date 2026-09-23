/**
 * 字体相关路由：上传、列表、详情、删除、文件下载（供浏览器 FontFace 加载）。
 */
import express from 'express';
import multer from 'multer';
import fs from 'node:fs/promises';
import path from 'node:path';
import { stmts, mapFontRow, UPLOAD_DIR } from '../db.js';
import { parseFont, sha256, sniffFormat } from '../font-parser.js';

export const router = express.Router();

const ACCEPTED_MIME = new Set([
  'font/ttf', 'font/otf', 'font/woff', 'font/woff2',
  'application/font-woff', 'application/font-woff2',
  'application/octet-stream', 'application/x-font-ttf',
  'application/x-font-otf', 'application/vnd.ms-opentype',
]);

const ACCEPTED_EXT = new Set(['.ttf', '.otf', '.ttc', '.woff', '.woff2']);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024, files: 1 },
});

router.get('/', (req, res) => {
  res.json(stmts.listFonts.all().map(mapFontRow));
});

router.get('/:id', (req, res, next) => {
  const row = stmts.getFont.get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: '字体不存在' });
  res.json(mapFontRow(row));
});

router.post('/', upload.single('font'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: '未收到上传文件（字段名必须为 font）' });
    const { originalname, mimetype, buffer, size } = req.file;
    const ext = path.extname(originalname).toLowerCase();

    if (!ACCEPTED_EXT.has(ext) && !ACCEPTED_MIME.has(mimetype)) {
      return res.status(415).json({ error: `不支持的字体类型：${mimetype || originalname}` });
    }
    const sniffed = sniffFormat(buffer);
    if (sniffed === 'unknown') {
      return res.status(415).json({ error: '文件内容不像 TTF / OTF / TTC / WOFF / WOFF2 字体' });
    }

    // 先落盘计算 hash，相同文件直接复用已有记录
    const tmpName = `incoming-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
    const tmpPath = path.join(UPLOAD_DIR, tmpName);
    await fs.writeFile(tmpPath, buffer);
    const hash = await sha256(tmpPath);

    const existing = stmts.getFontBySha.get(hash);
    if (existing) {
      await fs.rm(tmpPath, { force: true });
      return res.status(200).json({ ...mapFontRow(existing), deduped: true });
    }

    const finalName = `${Date.now()}-${hash.slice(0, 12)}${ext}`;
    const finalPath = path.join(UPLOAD_DIR, finalName);
    await fs.rename(tmpPath, finalPath);

    const { meta, cmapRanges, cmapTotal, warning } = await parseFont(finalPath);

    const info = stmts.insertFont.run({
      family_name: meta.familyName,
      subfamily_name: meta.subfamilyName,
      full_name: meta.fullName,
      postscript_name: meta.postscriptName,
      version: meta.version,
      copyright: meta.copyright,
      format: meta.format,
      mime: mimetype,
      file_size: size,
      sha256: hash,
      storage_path: finalName,
      cmap_total: cmapTotal,
      cmap_ranges: JSON.stringify(cmapRanges),
      parse_warning: warning,
    });
    res.status(201).json(mapFontRow(stmts.getFont.get(info.lastInsertRowid)));
  } catch (err) {
    next(err);
  }
});

router.get('/:id/file', async (req, res, next) => {
  try {
    const row = stmts.getFont.get(Number(req.params.id));
    if (!row) return res.status(404).json({ error: '字体不存在' });
    res.sendFile(path.join(UPLOAD_DIR, row.storage_path));
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const row = stmts.getFont.get(id);
    if (!row) return res.status(404).json({ error: '字体不存在' });
    stmts.deleteFont.run(id);
    await fs.rm(path.join(UPLOAD_DIR, row.storage_path), { force: true });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
