FROM oven/bun:1 AS deps

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# ---

FROM oven/bun:1 AS builder

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run db:generate

# ---

FROM oven/bun:1-slim AS runner

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/drizzle ./drizzle
COPY src ./src
COPY package.json tsconfig.json ./

RUN mkdir -p data logs

EXPOSE 3000

ENTRYPOINT ["bun", "run", "src/index.ts"]
