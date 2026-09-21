// EPIC-140 (SLICE-140-7): static-file middleware + OpenAPI/Swagger wiring
// extracted from index.ts.
// wireStaticOps: favicon/verification/manifest/security.txt + /icons|css|images|js
// wireOpenApi: openAPIRouteHandler introspects app at call time — MUST be called
// after ALL routes are mounted (last wire call before onError).

import type { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { openAPIRouteHandler } from "hono-openapi";
import { swaggerUI } from "@hono/swagger-ui";
import { stringify as yamlStringify } from "yaml";
import { openApiConfig } from "../openapi";

export function wireStaticOps(app: Hono): void {
  // Serve static files from public/ (favicon, icons, logo, CSS, Google verification)
  app.use("/favicon.ico", (c, next) => {
    c.header("Cache-Control", "public, max-age=86400");
    return next();
  }, serveStatic({ root: "./public", path: "/favicon.ico" }));
  app.use("/favicon.svg", (c, next) => {
    c.header("Cache-Control", "public, max-age=86400");
    c.header("Content-Type", "image/svg+xml");
    return next();
  }, serveStatic({ root: "./public", path: "/favicon.svg" }));
  app.use("/google23c66f9606672661.html", serveStatic({ root: "./public", path: "/google23c66f9606672661.html" }));
  app.use("/manifest.json", (c) => {
    c.header("Cache-Control", "public, max-age=86400");
    return serveStatic({ root: "./public", path: "/manifest.json" })(c, () => Promise.resolve());
  });
  app.use("/.well-known/security.txt", (c) => {
    c.header("Cache-Control", "public, max-age=86400");
    return serveStatic({ root: "./public", path: "/.well-known/security.txt" })(c, () => Promise.resolve());
  });
  app.use("/6abf90e7f0354fb09ac01108f46a17e7.txt", serveStatic({ root: "./public", path: "/6abf90e7f0354fb09ac01108f46a17e7.txt" }));

  app.use("/icons/*", (c, next) => {
    c.header("Cache-Control", "public, max-age=31536000, immutable");
    return next();
  }, serveStatic({ root: "./public" }));
  app.use("/css/*", (c, next) => {
    c.header("Cache-Control", "public, max-age=31536000, immutable");
    return next();
  }, serveStatic({ root: "./public" }));
  app.use("/images/*", (c, next) => {
    c.header("Cache-Control", "public, max-age=31536000, immutable");
    return next();
  }, serveStatic({ root: "./public" }));
  app.use("/js/*", (c, next) => {
    c.header("Cache-Control", "public, max-age=31536000, immutable");
    return next();
  }, serveStatic({ root: "./public" }));
}

// OpenAPI spec + Swagger UI — openAPIRouteHandler(app) introspects the app at
// call time, so this MUST run after every route mount (last wire before onError).
export function wireOpenApi(app: Hono): void {
  const openApiSpecHandler = openAPIRouteHandler(app, {
    documentation: openApiConfig,
    exclude: ["/docs", "/api/specs", "/openapi.json", "/openapi.yaml", "/swagger.json", "/ui", /^\/ui\//, "/metrics", "/api/telemetry"],
    excludeMethods: ["OPTIONS"],
  });
  app.get("/api/specs", openApiSpecHandler);
  // Standard OpenAPI discovery paths (SLICE-47-9)
  app.get("/openapi.json", openApiSpecHandler);
  app.get("/swagger.json", openApiSpecHandler);
  // SLICE-121-3: YAML endpoint for AI-agents that prefer YAML
  app.get("/openapi.yaml", async (_c) => {
    const specRes = await app.request("/openapi.json");
    const json = await specRes.json();
    const yamlStr = yamlStringify(json);
    return new Response(yamlStr, {
      headers: {
        "Content-Type": "application/yaml; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
      },
    });
  });
  app.get("/docs", swaggerUI({ url: "/api/specs" }));
}
