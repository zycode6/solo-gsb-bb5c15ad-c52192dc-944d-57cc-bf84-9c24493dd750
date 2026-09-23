# ---- 构建阶段：编译 better-sqlite3 原生模块 ----
FROM node:20-bookworm-slim AS builder

# better-sqlite3 优先使用预编译二进制；若无对应预编译则从源码构建
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 先拷依赖清单，利用层缓存
COPY package.json package-lock.json* ./
# better-sqlite3 优先下载预编译二进制；GitHub 不可达时从源码构建
# （SQLite amalgamation 已包含在 npm 包内，只需 npm registry 可达）
RUN npm ci --omit=dev --no-audit --no-fund 2>/dev/null \
  || npm install --omit=dev --no-audit --no-fund --build-from-source

# ---- 运行阶段 ----
FROM node:20-bookworm-slim

# 运行时无需字体即可服务（检测发生在用户浏览器端）；
# 安装少量基础字体仅为排错时提供参考
RUN apt-get update && apt-get install -y --no-install-recommends \
    fonts-dejavu-core fontconfig \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --create-home --uid 10001 appuser

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY package.json ./
COPY server ./server
COPY shared ./shared
COPY public ./public

RUN mkdir -p /app/data/uploads && chown -R appuser:appuser /app/data
USER appuser

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/app/data \
    MAX_UPLOAD_MB=64

EXPOSE 3000
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/fonts',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "server/index.js"]
