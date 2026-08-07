FROM oven/bun:1.2
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --production --frozen-lockfile

COPY src ./src
COPY content ./content
COPY public ./public
COPY tailwind.config.js ./
RUN bun install tailwindcss@3 && bun run build:css && bun remove tailwindcss

EXPOSE 4021
CMD ["bun", "src/server/index.ts"]
