/**
 * SQLite 数据访问层（better-sqlite3，同步 API）。
 * 数据文件位于 data/app.db，目录不存在时自动创建。
 */
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
export const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
export const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(ROOT, 'uploads');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

export const db = new Database(path.join(DATA_DIR, 'app.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS fonts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  family_name    TEXT,
  subfamily_name TEXT,
  full_name      TEXT,
  postscript_name TEXT,
  version        TEXT,
  copyright      TEXT,
  format         TEXT NOT NULL,
  mime           TEXT,
  file_size      INTEGER NOT NULL,
  sha256         TEXT NOT NULL UNIQUE,
  storage_path   TEXT NOT NULL,
  cmap_total     INTEGER DEFAULT 0,
  cmap_ranges    TEXT,
  parse_warning  TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reports (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  kind        TEXT NOT NULL CHECK (kind IN ('coverage', 'comparison')),
  title       TEXT,
  font_id     INTEGER REFERENCES fonts(id) ON DELETE SET NULL,
  font_b_id   INTEGER REFERENCES fonts(id) ON DELETE SET NULL,
  range_input TEXT,
  range_count INTEGER,
  segments    TEXT,
  mode        TEXT,
  summary     TEXT,
  document    TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_reports_created ON reports(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_font ON reports(font_id);
`);

export function mapFontRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    familyName: row.family_name,
    subfamilyName: row.subfamily_name,
    fullName: row.full_name,
    postscriptName: row.postscript_name,
    version: row.version,
    copyright: row.copyright,
    format: row.format,
    mime: row.mime,
    fileSize: row.file_size,
    sha256: row.sha256,
    cmapTotal: row.cmap_total,
    cmapRanges: row.cmap_ranges ? JSON.parse(row.cmap_ranges) : null,
    parseWarning: row.parse_warning,
    createdAt: row.created_at,
  };
}

export const stmts = {
  insertFont: db.prepare(`
    INSERT INTO fonts (family_name, subfamily_name, full_name, postscript_name,
      version, copyright, format, mime, file_size, sha256, storage_path,
      cmap_total, cmap_ranges, parse_warning)
    VALUES (@family_name, @subfamily_name, @full_name, @postscript_name,
      @version, @copyright, @format, @mime, @file_size, @sha256, @storage_path,
      @cmap_total, @cmap_ranges, @parse_warning)
  `),
  getFont: db.prepare('SELECT * FROM fonts WHERE id = ?'),
  getFontBySha: db.prepare('SELECT * FROM fonts WHERE sha256 = ?'),
  listFonts: db.prepare('SELECT * FROM fonts ORDER BY id DESC'),
  deleteFont: db.prepare('DELETE FROM fonts WHERE id = ?'),

  insertReport: db.prepare(`
    INSERT INTO reports (kind, title, font_id, font_b_id, range_input,
      range_count, segments, mode, summary, document)
    VALUES (@kind, @title, @font_id, @font_b_id, @range_input,
      @range_count, @segments, @mode, @summary, @document)
  `),
  getReport: db.prepare('SELECT * FROM reports WHERE id = ?'),
  listReports: db.prepare(`
    SELECT id, kind, title, font_id, font_b_id, range_input, range_count,
           mode, summary, created_at
    FROM reports ORDER BY id DESC
  `),
  deleteReport: db.prepare('DELETE FROM reports WHERE id = ?'),
};
