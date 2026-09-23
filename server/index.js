/**
 * 字体覆盖率实验台 —— HTTP 服务入口。
 * 启动：node server/index.js（默认 3000 端口，可用 PORT 覆盖）。
 */
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { router as fontsRouter } from './routes/fonts.js';
import { router as reportsRouter } from './routes/reports.js';
import { DATA_DIR, UPLOAD_DIR } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT) || 3000;

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '30mb' }));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'font-coverage-bench', time: new Date().toISOString() });
});

app.use('/api/fonts', fontsRouter);
app.use('/api/reports', reportsRouter);

// 前端静态资源与共享 ESM 模块
app.use('/shared', express.static(path.join(ROOT, 'shared'), {
  setHeaders(res) {
    res.setHeader('Cache-Control', 'no-cache');
  },
}));
app.use(express.static(path.join(ROOT, 'public'), {
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
  },
}));

// SPA 兜底
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(ROOT, 'public', 'index.html'));
});

// 统一错误处理
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[error]', err);
  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    error: err.expose ? err.message : (status >= 500 ? '服务器内部错误' : err.message),
  });
});

app.listen(PORT, () => {
  console.log('──────────────────────────────────────────────');
  console.log('  字体覆盖率实验台 (Font Coverage Bench)');
  console.log(`  监听地址 : http://localhost:${PORT}`);
  console.log(`  数据目录 : ${DATA_DIR}`);
  console.log(`  字体目录 : ${UPLOAD_DIR}`);
  console.log('──────────────────────────────────────────────');
});
