# 字体覆盖率实验台 · Font Coverage Bench

上传字体、指定 Unicode 范围，在**浏览器中按字形实际渲染结果**检测缺字与回退字体，按书写系统（script）分组展示缺口，支持两版字体对比与 JSON 报告导出。

- **后端**：Node.js + Express + better-sqlite3，fontkit 解析 cmap 与字体元数据
- **前端**：原生 HTML / CSS / JavaScript，零构建、零框架；Canvas 2D 实测渲染
- **存储**：SQLite（字体、cmap、扫描、明细）+ 本地文件卷（字体原件）

## 它解决什么问题

字体的 cmap 表只“声明”支持哪些码点，但真实情况更复杂：

- cmap 映射到 `.notdef` 或空白字形（声明有、渲染无）；
- 码点不在 cmap 中，浏览器却通过**回退字体**渲染了出来（声明无、实际可见）；
- 不同平台/浏览器的回退链不同，实际命中的字体也不同。

本工具以**用户浏览器的真实渲染**为准，配合 cmap 双向对照，给出每个码点的实测状态。

## 快速开始

### Docker Compose（推荐）

```bash
docker compose up -d --build
# 打开浏览器
# http://localhost:3000
```

数据持久化在宿主机 `./data`（SQLite 数据库 + 上传的字体文件）。停止：`docker compose down`。

### 本地 Node 运行

需要 Node.js ≥ 18。better-sqlite3 会优先下载预编译二进制；网络受限时需具备 `python3 / make / g++` 从源码编译。

```bash
npm install
npm start
# http://localhost:3000
```

## 使用流程

1. **上传字体**：`.ttf / .otf / .woff / .woff2 / .ttc`（TTC 取首个成员，sha256 自动去重）。
2. **选择字体与参数**：
   - 检测字号（默认 28px）；
   - 是否与 cmap 声明对照（标出“声明有/实测无”的冲突字形）；
   - 点「探测系统可用字体」检测本机安装了哪些候选回退字体。
3. **输入 Unicode 范围**，支持的写法可混用（逗号/分号/空格分隔，`#` 后为注释）：

   | 写法 | 含义 |
   |---|---|
   | `U+4E00–U+9FFF` | 码点区间（连字符 `- – — ~` 均可） |
   | `U+0041` / `0x41` / `41` | 单个码点 |
   | `你好hello€` | 直接贴入文本，逐字检测 |
   | `Latin` / `CJK` / `Arabic` / `Emoji` | 脚本名（别名：中文、汉字、kana、korean…） |
   | `"CJK Unified Ideographs"` | Unicode 区块名（支持包含匹配） |

   先点「预览范围」查看码点总数与按脚本的分布，再开始检测。
4. **查看结果**：实时进度与计数；按脚本 → 区块两级分组，
   - 🟢 绿 = 目标字体覆盖；🟡 黄 = 回退字体渲染（悬停看实际命中的字体族）；🔴 红 = 缺失；
   - 紫色 `!` 角标 = cmap 声明覆盖但实测未由该字体渲染。
5. **保存 / 导出**：把本次扫描存入历史，导出结构化 JSON 报告（含每个缺口码点、分组统计、cmap 对照）。
6. **版本对比**：在「④ 历史记录」中保留两版字体的扫描后，于「③ 版本对比」选择 before / after，
   查看改善（缺字/回退 → 覆盖）、退化（覆盖 → 缺失）以及**回退字体发生变化**的码点，可导出对比 JSON。

## 检测原理（启发式，以浏览器为准）

检测在本地 Canvas 中完成，不上传码点渲染内容：

1. 用 `FontFace` 动态加载上传字体，赋予唯一内部族名；
2. 对每个码点用 5 个字体栈渲染并提取**字形指纹**（16×16 墨框归一化位图 + 墨迹像素数 + advance width + 外接框）：
   - 目标字体 + serif / sans-serif 参考栈；
   - 不含目标字体的 serif / sans-serif / monospace 参考栈；
3. 以 3 个 Unicode **永久未分配码点**（必走 `.notdef`）建立每栈的缺字指纹基线；
4. 判定规则：
   - 目标栈非 `.notdef` 且与无目标栈渲染不同 → **covered**；
   - 目标栈非空非 `.notdef` 且码点在 cmap 中 → **covered**（覆盖多字体同形场景，如 `+ - =` 在 sans/serif 间像素一致）；
   - 所有栈均为 `.notdef` → **missing**；
   - 所有栈像素一致且 cmap 未声明（非标准缺字框 / PUA 空白槽）→ **missing**；
   - 其余 → **fallback**，再用候选字体逐个构造字体栈比对指纹，定位实际提供字形的字体族。

> **已知局限**：这是基于像素指纹的启发式检测，并非浏览器内部 shaping 信息。极少数情况下（目标字体与回退字体字形完全同形同度量、彩色 Emoji 的抗锯齿微差）可能误判；结果以当前浏览器/OS 的字体环境为准。组合记号、变体选择符等独立不可见码点按 cmap 归属分类并标记 `blank`。

## API 摘要

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/fonts` | 上传字体（multipart 字段 `font`），解析元数据与 cmap |
| GET | `/api/fonts` / `/api/fonts/:id` | 字体列表 / 详情 |
| GET | `/api/fonts/:id/cmap` | cmap 全量码点 |
| GET | `/api/fonts/:id/raw` | 字体原件（供 `@font-face`） |
| DELETE | `/api/fonts/:id` | 删除字体（级联删除扫描） |
| POST | `/api/ranges/preview` | 范围解析与按脚本分布预览 |
| POST | `/api/scans` | 浏览器回传实测结果并入库 |
| GET | `/api/scans` / `/api/scans/:id` | 扫描列表 / 明细 |
| GET | `/api/compare/:a/:b` | 两次扫描对比（改善 / 退化 / 回退变化） |
| GET | `/api/reports/scans/:id.json` | 导出扫描 JSON 报告 |
| GET | `/api/reports/compare/:a/:b.json` | 导出对比 JSON 报告 |

## 目录结构

```
server/            Express 服务：上传、fontkit 解析、SQLite、报告
  index.js         HTTP API
  font-inspect.js  fontkit 元数据 / cmap 提取
  db.js            SQLite 初始化
  schema.sql       表结构
shared/            前后端共用（UMD，零依赖）
  unicode-blocks.js Unicode 区块 → 脚本分组
  range-parser.js  范围语法解析与展开
public/            原生前端
  index.html / styles.css
  detect.js        Canvas 字形指纹检测引擎
  app.js           页面逻辑
test/              node-canvas 无头验证（见下）
```

## 无头验证

仓库附带一个基于 node-canvas 的引擎验证（需要系统字体，非生产依赖）：

```bash
npm install --no-save --legacy-peer-deps canvas@2
node test/headless-detect.js
```

它用 FontConfig 实际渲染 DejaVu Sans，校验 covered / fallback / missing 三类判定与 cmap 真值一致。

## 配置（环境变量）

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `3000` | 监听端口 |
| `DATA_DIR` | `./data` | SQLite 与上传目录根 |
| `MAX_UPLOAD_MB` | `64` | 单字体大小上限 |
| `MAX_RESULT_ROWS` | `120000` | 单次扫描码点上限 |

## License

MIT
