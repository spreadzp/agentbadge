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

COPY src ./src
COPY tests ./tests
COPY content ./content
COPY public ./public
COPY --from=css-builder /build/public/css/tailwind.css ./public/css/tailwind.css

EXPOSE 4021
CMD ["bun", "src/server/index.ts"]
