# syntax=docker/dockerfile:1
# 多阶段构建：deps → build → runner

FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat openssl

# ---------- deps ----------
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts

# ---------- build ----------
FROM base AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# 生产使用 PostgreSQL schema 生成客户端
RUN npx prisma generate --schema prisma/schema.prisma
# 构建环境无 .env，注入占位 DATABASE_URL 仅供 Prisma 客户端校验通过（构建期不实际连库）
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
ENV NEXT_TELEMETRY_DISABLED=1
# 注意：不要用 npm run build，其中的 dev schema generate 会覆盖上面的 postgres 客户端
RUN npx next build

# ---------- runner ----------
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup -S nodejs && adduser -S nextjs -G nodejs

COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
# Prisma 客户端与引擎（应用运行时用）
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=build /app/prisma ./prisma

# 全局安装 prisma CLI（npm 自动带全依赖闭包），供启动前执行数据库迁移
RUN npm install -g prisma@6.19.3 --no-audit --no-fund

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# 启动前执行数据库迁移
CMD ["sh", "-c", "prisma migrate deploy --schema prisma/schema.prisma && node server.js"]
