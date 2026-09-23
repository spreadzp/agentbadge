# Stage 1: Build CSS (tailwindcss not needed in final image)
FROM oven/bun:1.3-slim AS css-builder
WORKDIR /build
COPY package.json bun.lock ./
RUN bun install tailwindcss@3 @tailwindcss/typography
COPY tailwind.config.cjs ./
RUN mkdir -p src/views src/server/routes
COPY src/input.css ./src/
COPY src/views ./src/views
COPY src/server/routes ./src/server/routes
COPY public ./public
RUN bun run build:css

# Stage 2: Final production image
FROM oven/bun:1.3-slim
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --production

ARG APP_VERSION
ARG GIT_COMMIT
ARG BUILD_DATE
ENV APP_VERSION=${APP_VERSION}
ENV SOURCE_COMMIT=${GIT_COMMIT}
ENV BUILD_DATE=${BUILD_DATE}

COPY src ./src
COPY tests ./tests
COPY content ./content
COPY public ./public
COPY --from=css-builder /build/public/css/tailwind.css ./public/css/tailwind.css

# Override @agentbadge/keeperhub with local build (fix: input vs inputs param)
COPY keeperhub-dist ./node_modules/@agentbadge/keeperhub/dist

# Override @agentbadge/hedera-core with local build (SLICE-127-24: KeeperHub + Attestcoin tools)
COPY hedera-core-dist ./node_modules/@agentbadge/hedera-core/dist
# Override @agentbadge/database with local build (EPIC-145: scanResult/chatSubscription stores — npm 0.1.1 is stale)
COPY database-dist ./node_modules/@agentbadge/database/dist
# Override @agentbadge/cache with local build (EPIC-144: incr + UpstashCache — npm 0.1.1 is stale)
COPY cache-dist ./node_modules/@agentbadge/cache/dist

EXPOSE 4021
CMD ["bun", "src/server/index.ts"]
