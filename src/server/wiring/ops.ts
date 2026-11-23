// EPIC-140 (SLICE-140-7): static-file middleware + OpenAPI/Swagger wiring
// extracted from index.ts.
// wireStaticOps: favicon/verification/manifest/security.txt + /icons|css|images|js
// wireOpenApi: openAPIRouteHandler introspects app at call time — MUST be called
// after ALL routes are mounted (last wire call before onError).

import type { Context, Hono } from "hono";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import { generateSpecs, type GenerateSpecOptions } from "hono-openapi";
import { swaggerUI } from "@hono/swagger-ui";
import { stringify as yamlStringify } from "yaml";
import { openApiConfig } from "../openapi";
import { srcAttribution } from "../middleware/src-attribution";

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
  // /.well-known/security.txt is generated at boot by discoveryManifestRoutes
  // (SLICE-178-2) — fresh Expires on every deploy, no static file.
  app.use("/6abf90e7f0354fb09ac01108f46a17e7.txt", serveStatic({ root: "./public", path: "/6abf90e7f0354fb09ac01108f46a17e7.txt" }));
  // SLICE-252-10: agent-facing test kit for the request inbox.
  app.use("/agent-test-kit.md", (c, next) => {
    c.header("Cache-Control", "public, max-age=3600");
    c.header("Content-Type", "text/markdown; charset=utf-8");
    return next();
  }, serveStatic({ root: "./public", path: "/agent-test-kit.md" }));

  app.use("/icons/*", (c, next) => {
    c.header("Cache-Control", "public, max-age=31536000, immutable");
    return next();
  }, serveStatic({ root: "./public" }));
  app.use("/css/*", (c, next) => {
    c.header("Cache-Control", "public, max-age=31536000, immutable");
    return next();
  }, serveStatic({ root: "./public" }));
  app.use("/images/*", async (c, next) => {
    // Legacy crawlers replay .jpeg/.png URLs that were replaced by .webp —
    // 301 to the webp twin when the requested file is gone but the webp exists.
    const p = c.req.path;
    if (/\.(jpe?g|png)$/i.test(p) && !existsSync(join("./public", p))) {
      const webp = p.replace(/\.(jpe?g|png)$/i, ".webp");
      if (existsSync(join("./public", webp))) return c.redirect(webp, 301);
    }
    c.header("Cache-Control", "public, max-age=31536000, immutable");
    return next();
  }, serveStatic({ root: "./public" }));
  app.use("/js/*", (c, next) => {
    c.header("Cache-Control", "public, max-age=31536000, immutable");
    return next();
  }, serveStatic({ root: "./public" }));
  // Article evidence (run transcripts, test/source snapshots) — not immutable,
  // evidence files may be corrected after publication.
  app.use("/evidence/*", (c, next) => {
    c.header("Cache-Control", "public, max-age=3600");
    return next();
  }, serveStatic({ root: "./public" }));
  // Published signer sets (e.g. verdict-signers.json {current,next}) — short
  // cache so key rotations propagate quickly.
  app.use("/keys/*", (c, next) => {
    c.header("Cache-Control", "public, max-age=300");
    return next();
  }, serveStatic({ root: "./public" }));
  // SLICE-258-6: x402 payout proof (draft-x402payto1) — short cache,
  // proof rotates on issued-date/payTo change.
  app.use("/.well-known/x402-payto.json", (c, next) => {
    c.header("Cache-Control", "public, max-age=300");
    return serveStatic({
      root: "./public",
      path: "/.well-known/x402-payto.json",
    })(c, next);
  });
}

// OpenAPI spec + Swagger UI — openAPIRouteHandler(app) introspects the app at
// call time, so this MUST run after every route mount (last wire before onError).
export function wireOpenApi(app: Hono): void {
  const specOptions: Partial<GenerateSpecOptions> = {
    documentation:
      openApiConfig as unknown as GenerateSpecOptions["documentation"],
    // SLICE-259-37: operator/admin and debug surfaces are runtime-gated but
    // must not be enumerated in the public spec — an agent reading /api/specs
    // gets the callable public contract, not the internal attack map.
    exclude: [
      "/docs", "/api/specs", "/openapi.json", "/openapi.yaml", "/swagger.json",
      "/ui", /^\/ui\//, "/metrics", "/api/telemetry",
      /^\/admin(\/|$)/,
      /^\/api\/admin(\/|$)/,
      /^\/api\/v\d+\/admin(\/|$)/,
      /^\/a2a\/ext\/debug(\/|$)/,
      /^\/market\/v\/[^/]+\/admin$/,
      /^\/api\/venue\/instances\/[^/]+\/admin$/,
    ],
    excludeMethods: ["OPTIONS"],
  };
  // SLICE-206-12: ?src= attribution on machine spec endpoints.
  app.use("/api/specs", srcAttribution());
  app.use("/openapi.json", srcAttribution());
  app.use("/openapi.yaml", srcAttribution());
  app.use("/swagger.json", srcAttribution());

  // SLICE-259-37: the spec is generated by introspecting the route table —
  // stable per process, so memoize body+weak ETag once. Agent fleets pull
  // the 270KB document repeatedly; If-None-Match must answer 304 for free.
  let specJsonCache: { body: string; etag: string } | null = null;
  const serveSpecJson = async (c: Context) => {
    if (!specJsonCache) {
      const spec = await generateSpecs(app, specOptions, c);
      const body = JSON.stringify(spec);
      specJsonCache = {
        body,
        etag: `W/"${createHash("sha256").update(body).digest("hex").slice(0, 16)}"`,
      };
    }
    if (c.req.header("if-none-match") === specJsonCache.etag) {
      return c.body(null, 304);
    }
    return c.body(specJsonCache.body, 200, {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=3600",
      ETag: specJsonCache.etag,
    });
  };

  app.get("/api/specs", serveSpecJson);
  // Standard OpenAPI discovery paths (SLICE-47-9)
  app.get("/openapi.json", serveSpecJson);
  app.get("/swagger.json", serveSpecJson);
  // SLICE-121-3: YAML endpoint for AI-agents that prefer YAML
  let specYamlCache: { body: string; etag: string } | null = null;
  app.get("/openapi.yaml", async (c) => {
    if (!specYamlCache) {
      const specRes = await app.request("/openapi.json");
      const json = await specRes.json();
      const body = yamlStringify(json);
      specYamlCache = {
        body,
        etag: `W/"${createHash("sha256").update(body).digest("hex").slice(0, 16)}"`,
      };
    }
    if (c.req.header("if-none-match") === specYamlCache.etag) {
      return c.body(null, 304);
    }
    return c.body(specYamlCache.body, 200, {
      "Content-Type": "application/yaml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
      ETag: specYamlCache.etag,
    });
  });
  app.get("/docs", swaggerUI({ url: "/api/specs" }));
}
