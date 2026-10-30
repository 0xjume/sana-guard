FROM node:22-alpine AS builder

WORKDIR /app

RUN apk add --no-cache python3 make g++
RUN corepack enable && corepack prepare pnpm@9.15.1 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/relay/package.json ./apps/relay/
COPY packages ./packages

RUN pnpm install --frozen-lockfile

COPY apps/relay ./apps/relay

RUN pnpm --filter @sana-guard/relay build
# Standalone prod tree (resolves the .pnpm symlink layout). dist is
# gitignored, so copy it into the deploy output explicitly.
RUN pnpm --filter @sana-guard/relay deploy --prod /out \
  && rm -rf /out/dist \
  && cp -a /app/apps/relay/dist /out/dist

FROM node:22-alpine AS runner

WORKDIR /app

COPY --from=builder /out ./

ENV NODE_ENV=production
ENV TRUST_PROXY=true

EXPOSE 3000

CMD ["node", "dist/index.js"]
