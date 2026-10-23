# Stage 1: Build CSS (tailwindcss not needed in final image)
FROM oven/bun:1.3-slim AS css-builder
WORKDIR /build
COPY package.json bun.lock ./
# file: deps live outside this build context — deploy.sh vendors them into
# .docker-packages/. Retarget file: paths so bun copies them into
# node_modules; keeps dep resolution inside /build (fixes @noble/hashes
# self-reference crash seen with out-of-tree /packages symlinks).
COPY .docker-packages ./.docker-packages
RUN sed -i 's|file:\.\./\.\./packages/|file:./.docker-packages/|g' package.json bun.lock
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
# file: deps live outside this build context — deploy.sh vendors them into
# .docker-packages/. Retarget file: paths so bun copies them into
# node_modules; keeps dep resolution inside /app (fixes @noble/hashes
# self-reference crash seen with out-of-tree /packages symlinks).
COPY .docker-packages ./.docker-packages
RUN sed -i 's|file:\.\./\.\./packages/|file:./.docker-packages/|g' package.json bun.lock
# SLICE-169-9: @x402/hedera + @x402/hono are optionalDependencies — a diet
# image (Hedera chain off, PASSPORT_CHAIN_ENABLED unset) can drop
# ~357MB via: docker build --build-arg OMIT_OPTIONAL_DEPS=true .
# Warning: this also omits optional deps of other packages; only use for
# deployments that never enable chain features.
ARG OMIT_OPTIONAL_DEPS=false
RUN if [ "$OMIT_OPTIONAL_DEPS" = "true" ]; then \
      bun install --omit=dev --omit=optional; \
    else \
      bun install --production; \
    fi

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

EXPOSE 4021
CMD ["bun", "src/server/index.ts"]
