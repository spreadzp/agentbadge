/**
 * SLICE-91-14: Test app builder for WebMCP E2E tests.
 *
 * Builds a Hono app with only the routes needed for WebMCP E2E tests,
 * avoiding the Bun.serve() side effect in src/server/index.ts.
 */
import { Hono } from "hono";
import { hackathonRoutes } from "../../src/server/routes/hackathon";
import { webmcpApiRoutes } from "../../src/server/routes/webmcp-api";
import { wellKnownRoutes } from "../../src/server/routes/well-known";
import { corsMiddleware } from "../../src/server/middleware/cors";

export function makeWebMCPTestApp(): Hono {
  const app = new Hono();
  app.use(corsMiddleware());
  app.route("/", hackathonRoutes);
  app.route("/api", webmcpApiRoutes);
  app.route("/", wellKnownRoutes);
  return app;
}
