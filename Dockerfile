FROM oven/bun:1.2
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --production --frozen-lockfile

COPY src ./src
COPY public ./public

EXPOSE 4021
CMD ["bun", "src/server/index.ts"]
