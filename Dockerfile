# 字体覆盖率实验台 —— 运行镜像
# better-sqlite3 含原生模块：优先使用官方预编译二进制，
# 若预编译不可用则由 build-deps 现场编译。
FROM node:20-bookworm-slim

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data/db \
    UPLOAD_DIR=/data/fonts

# sqlite 原生模块构建后备工具链 + 运行时所需的字体探测参考字体
# fonts-noto-cjk / fonts-noto-color-emoji 让容器内浏览器场景外的回退探测更完整
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ \
      fonts-dejavu-core fonts-noto-cjk fonts-noto-color-emoji \
      fonts-liberation fontconfig \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 先装依赖（利用层缓存）
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund || npm install --omit=dev --no-audit --no-fund

# 应用代码
COPY server ./server
COPY shared ./shared
COPY public ./public

# 持久化卷（SQLite + 上传字体）
RUN mkdir -p /data/db /data/fonts && chown -R node:node /data /app
USER node
VOLUME ["/data"]

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
