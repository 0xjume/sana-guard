FROM node:22-alpine AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.1 --activate

COPY package.json pnpm-lock.yaml* ./
COPY apps/relay/package.json ./apps/relay/
COPY packages ./packages

RUN pnpm install --frozen-lockfile

COPY apps/relay ./apps/relay

WORKDIR /app/apps/relay
RUN pnpm build

FROM node:22-alpine AS runner

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.1 --activate

COPY --from=builder /app/apps/relay/package.json ./
COPY --from=builder /app/apps/relay/dist ./dist
COPY --from=builder /app/apps/relay/node_modules ./node_modules

ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "dist/index.js"]
