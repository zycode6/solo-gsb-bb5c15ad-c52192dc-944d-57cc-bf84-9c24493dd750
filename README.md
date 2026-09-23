# 字体覆盖率实验台 · Font Coverage Bench

基于 **Node.js + SQLite + 原生前端（无框架）** 的字体覆盖率检测工具：
用户上传字体并输入 Unicode 范围，系统**在浏览器中按字形的实际渲染结果**
检测缺字（豆腐块 / 空白）与回退字体，按 Unicode 脚本（Script）分组展示缺口，
支持**两版字体对比**，并可导出 / 持久化 **JSON 检测报告**。

> 检测在访问者的浏览器内执行，因此「回退到哪个系统字体」的结论真实反映
> 该机器的字体环境；服务器只负责存储、cmap 解析与报告管理。

---

## 功能一览

| 能力 | 说明 |
| --- | --- |
| 字体上传 | TTF / OTF / TTC / WOFF / WOFF2（≤30MB），SHA-256 去重，fontkit 解析 name 表与 cmap |
| 范围输入 | `U+4E2D`、`U+4E00-U+9FFF`、`0x...` 前缀、预设块（basic-latin、cjk-unified、emoji 等 60+）、字面量 `测试，Hello！` |
| 真实渲染检测 | Canvas 位图指纹 + `.notdef` 豆腐块探针，三族 CSS 回退栈表决，逐码位判定 |
| 回退字体识别 | 候选系统字体探针位图比对，输出实际承担渲染的字体名（启发式） |
| cmap 快速模式 | 仅读取字体 cmap 声明，秒级预估大范围覆盖（不验证真实字形） |
| 脚本分组 | UAX #24 Script 属性（`\p{sc=...}`）分组，组内按缺口数排序、可折叠、可筛选 |
| 声明异常 | cmap 声明有码位但渲染为豆腐块 / 空白 / 回退 → 标记 discrepancy |
| 双字体对比 | A→B 修复 / 回归 / 回退变化统计，差异按脚本分组列出 |
| 报告库 | SQLite 持久化，列表查看、回看、删除，服务端原样导出 JSON |
| JSON 导出 | 检测完可直接下载，或从报告库下载已保存报告（含环境信息与检测时间） |

## 快速开始

### 方式一：Docker Compose（推荐）

```bash
docker compose up -d --build
# 打开浏览器
open http://localhost:3000      # macOS
# 或直接访问 http://localhost:3000
```

停止与数据：

```bash
docker compose down            # 停止（数据卷保留）
docker compose down -v         # 停止并删除数据（SQLite + 上传字体）
```

自定义端口：

```bash
PORT=8080 docker compose up -d --build
```

### 方式二：本地 Node 运行

要求 Node.js ≥ 20。better-sqlite3 为原生模块，首次安装需要可联网下载预编译
二进制（或本机具备 python3 / make / g++ 工具链）。

```bash
npm install
npm start                      # 默认 3000 端口
PORT=8080 npm start            # 自定义端口
```

打开 <http://localhost:3000>。

### 冒烟测试

```bash
npm run check                  # 范围解析 / 脚本分类 / cmap 压缩的纯逻辑测试
```

## 使用指南

### 1. 覆盖检测

1. **覆盖检测** 页上传字体（或选择已上传字体），查看 name 表与 cmap 统计。
2. 在范围框输入 Unicode 范围，或通过「快速插入预设」选块；多段用逗号分隔。
   - `basic-latin, cjk-unified, emoji`
   - `U+4E00-U+4FFF, U+3000-U+303F`
   - `测试，Hello！`（字面量；纯字母码位请写 `U+0041` 以免与字面量混淆）
3. 选择模式：
   - **真实渲染检测**（默认）：逐字形 Canvas 检测，约每秒 1k–5k 码位；
   - **仅 cmap 声明**：只读字体表，适合上万码位的快速预估。
4. 点 **开始检测**。结果包含：
   - 覆盖率、已覆盖 / 回退 / 豆腐块 / 空白 / 声明异常数量；
   - 主要回退字体排行；
   - 按脚本分组的缺口网格（hover 单元格查看码位、状态、回退来源），
     支持「全部缺口 / 仅回退 / 仅缺字 / 仅声明异常」筛选；
5. 可 **导出 JSON**（立即下载）或 **保存到报告库**。

### 2. 双字体对比

在 **双字体对比** 页选择字体 A（基线）与 B（新版本），输入同一范围后开始。
输出：B 修复数、B 回归数、回退字体变化数、两版均覆盖 / 均缺失，
并按脚本列出每个差异码位在两版下的状态；同样支持导出与保存。

### 3. 报告库

**报告库** 页列出所有已保存报告，支持在线回看完整结果、下载 JSON、删除。
删除字体不会删除报告，但会解除报告与字体的关联（报告内嵌字体快照）。

## 检测原理

```
                 ┌──────────────────────────── 浏览器（真实环境） ───────────────────────────┐
 上传字体 ──► FontFace(fcb-font-N)                                                              │
                 对每个码位 cp 在 3 个字体栈离屏 Canvas 绘制：                                    │
                   "fcb-font-N", serif   |   "fcb-font-N", sans-serif   |   "fcb-font-N", mono  │
                   serif（纯系统栈）     |   sans-serif                |   monospace            │
                 提取位图指纹（墨点数 + FNV-1a 像素哈希）                                        │
                                                                                                │
 缺字判定：     用未分配码位 U+FFFF / U+0378 得到各栈 .notdef「豆腐块」指纹，                    │
                字形指纹 == 豆腐块指纹 → missing-tofu；无任何墨迹 → missing-blank                │
 回退判定：     被测字体栈与纯系统栈位图一致 → fallback，再用候选字体栈探针                      │
                （"Noto Sans CJK SC", sans-serif 等）逐组比对，识别具体字体名                   │
 覆盖判定：     加入被测字体后位图与系统栈不同 → covered                                         │
 声明异常：     服务端 cmap 声明含 cp，但渲染状态非 covered → discrepancy                        │
                 └──────────────────────────────────────────────────────────────────────────┘
 服务端：        fontkit 读 cmap（区间压缩存 SQLite），提供字体 / 报告 API 与 JSON 导出
```

**局限与注意事项**（报告 JSON 的 `caveats` 字段中也会记录）：

- 回退字体名是**启发式位图比对**：候选清单内置跨平台常见字体
  （Noto / DejaVu / 文泉驿 / PingFang / 微软雅黑 / Segoe UI Emoji 等），
  不在清单内或字形过于相似的字体可能识别为通用族（如 `sans-serif`）。
- 判定依赖本机字体：同一字体在不同操作系统 / 浏览器上的缺字与回退结果
  可能不同——这正是报告内嵌 `environment`（UA、平台、语言、DPR）的原因。
- 彩色 emoji 以「非白像素」计墨迹；COLR/CPAL 与位图 emoji 均可识别，
  但字形度量差异较大时指纹哈希偶尔碰撞（同时比较了墨点数，概率极低）。
- 空格、ZWJ、变体选择符等按设计留白的码位：cmap 声明即视为覆盖。
- TTC 字体服务端解析第 0 个 face；浏览器渲染以容器内默认 face 为准。

## JSON 报告结构

覆盖报告（`reportType: "font-coverage"`）：

```json
{
  "reportType": "font-coverage",
  "schemaVersion": 1,
  "title": "DejaVu Sans 覆盖检测 2026-09-23",
  "generatedAt": "2026-09-23T02:00:00.000Z",
  "elapsedMs": 1834,
  "environment": { "userAgent": "...", "platform": "...", "testedFont": { "...": "..." } },
  "font": { "id": 1, "fullName": "DejaVu Sans", "cmapTotal": 5918 },
  "request": { "mode": "render", "rangeInput": "basic-latin, cjk-unified",
               "segments": [[32,126],[19968,40959]], "count": 21087 },
  "summary": {
    "total": 21087, "covered": 3120, "fallback": 88,
    "missingTofu": 17879, "missingBlank": 0, "discrepancy": 2, "rate": 14.80,
    "fallbackFonts": [ { "family": "Noto Sans CJK SC", "count": 88 } ]
  },
  "groups": [
    { "script": "Hani", "scriptName": "汉字", "total": 20992, "covered": 2013,
      "gap": 18979, "entries": [
        { "cp": 24109, "ch": "形", "hex": "U+5E26", "status": "missing-tofu",
          "declared": false, "generic": "sans-serif",
          "fallbackFont": "Noto Sans CJK SC", "discrepancy": null } ] }
  ],
  "caveats": [ "..." ]
}
```

对比报告（`reportType: "font-comparison"`）另含 `fontA / fontB`、
`summaryA / summaryB`、`delta { improved, regressed, changed, fallbackChanged,
bothCovered, bothMissing }` 以及只包含差异码位的 `groups[].entries
{ cp, ch, hex, a, b, fallbackA, fallbackB }`。

## 架构与目录

```
├── server/
│   ├── index.js          Express 入口（API + 静态资源）
│   ├── db.js             better-sqlite3 初始化、表结构、预处理语句
│   ├── font-parser.js    fontkit：魔数识别 / name 表 / cmap 区间压缩
│   └── routes/
│       ├── fonts.js      上传(multer) / 列表 / 下载 / 删除 / SHA-256 去重
│       └── reports.js    报告保存 / 查询 / 删除 / JSON 导出
├── shared/               前后端共用的纯 ESM
│   ├── ranges.js         范围解析（预设 / U+ / 字面量）、区间合并
│   └── scripts.js        UAX #24 脚本分类（\p{sc=...}，含中文展示名）
├── public/
│   ├── index.html
│   ├── css/styles.css
│   └── js/
│       ├── api.js        fetch 封装、JSON 下载
│       ├── detector.js   ★ Canvas 渲染检测引擎（指纹/豆腐块/回退识别/对比）
│       └── app.js        视图、编排、分组渲染、报告库
├── scripts/smoke.js      纯逻辑冒烟测试
├── Dockerfile            node:20-bookworm-slim + Noto CJK/Emoji 参考字体
└── docker-compose.yml    数据卷 /data（SQLite 与字体文件持久化）
```

### HTTP API 摘要

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查 |
| GET/POST | `/api/fonts` | 列表 / 上传（multipart 字段 `font`，重复文件返回 `deduped:true`） |
| GET/DELETE | `/api/fonts/:id` | 详情 / 删除 |
| GET | `/api/fonts/:id/file` | 下载原始字体（供 FontFace 加载） |
| GET/POST | `/api/reports` | 列表（概要）/ 保存完整文档 |
| GET/DELETE | `/api/reports/:id` | 完整报告 / 删除 |
| GET | `/api/reports/:id/export` | 以附件下载 JSON |

### 数据存储

- SQLite：`data/app.db`（Docker 内为 `/data/db/app.db`），WAL 模式。
- 字体文件：`uploads/`（Docker 内 `/data/fonts/`），以时间戳 + 哈希命名。
- 可用环境变量覆盖：`PORT`、`DATA_DIR`、`UPLOAD_DIR`。

## 开发说明

- 纯 ESM（`"type": "module"`），前端直接以原生 ES Module 加载，无需打包步骤。
- 所有渲染检测逻辑集中在 `public/js/detector.js`，不依赖任何第三方库，
  可在浏览器 DevTools 中直接断点调试；修改范围解析后运行 `npm run check`。
- 新增候选回退字体：编辑 `public/js/detector.js` 的 `CANDIDATES`。
- 新增范围预设：编辑 `shared/ranges.js` 的 `PRESETS`（前端下拉自动同步）。
