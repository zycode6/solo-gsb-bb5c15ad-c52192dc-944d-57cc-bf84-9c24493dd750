-- 字体覆盖率实验台数据库结构
-- 字体记录（每次上传一行，同名字体多版本并存，用于版本对比）
CREATE TABLE IF NOT EXISTS fonts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,          -- 上传文件名（去重展示用 family_name 优先）
  family_name   TEXT,
  version       TEXT,
  postscript    TEXT,
  format        TEXT,                      -- truetype / opentype / woff ...
  num_glyphs    INTEGER,
  units_per_em  INTEGER,
  ascent        INTEGER,
  descent       INTEGER,
  line_gap      INTEGER,
  file_size     INTEGER,
  sha256        TEXT UNIQUE,               -- 内容去重
  storage_path  TEXT    NOT NULL,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- 字体中“声明支持”的码点（cmap 覆盖），用于与浏览器实测结果对照
CREATE TABLE IF NOT EXISTS font_codepoints (
  font_id    INTEGER NOT NULL REFERENCES fonts(id) ON DELETE CASCADE,
  codepoint  INTEGER NOT NULL,
  gid        INTEGER,                      -- glyph id
  PRIMARY KEY (font_id, codepoint)
);

CREATE INDEX IF NOT EXISTS idx_cp_font ON font_codepoints(font_id);

-- 一次覆盖率检测任务
CREATE TABLE IF NOT EXISTS scans (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  font_id      INTEGER NOT NULL REFERENCES fonts(id) ON DELETE CASCADE,
  label        TEXT,
  range_spec   TEXT    NOT NULL,           -- 用户输入的范围原文
  sample_size  INTEGER,                    -- 实测码点总数
  missing_count INTEGER,
  fallback_count INTEGER,
  covered_count INTEGER,
  options_json TEXT,                       -- 像素大小、回退栈等检测参数
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_scans_font ON scans(font_id);

-- 每个码点的实测明细
CREATE TABLE IF NOT EXISTS scan_results (
  scan_id     INTEGER NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  codepoint   INTEGER NOT NULL,
  status      TEXT    NOT NULL,           -- covered | missing | fallback
  detected_font TEXT,                     -- 实测命中的字体族（fallback 时填写）
  cmap_covered INTEGER NOT NULL DEFAULT 0,-- 字体 cmap 是否声明该码点
  PRIMARY KEY (scan_id, codepoint)
);

CREATE INDEX IF NOT EXISTS idx_sr_scan ON scan_results(scan_id);
CREATE INDEX IF NOT EXISTS idx_sr_status ON scan_results(scan_id, status);
