/**
 * SLICE-98-2: Local fixture server — plays a target API for runtime tests
 *
 * Serves: llms.txt, agents.txt, well-known, OpenAPI (with deliberate
 * declared-vs-observed mismatches), read endpoint, safe-invalid endpoint.
 * Mismatches are toggleable via scenarios config.
 *
 * Deterministic, no external calls.
 */

import { Hono } from "hono";
import { serve } from "@hono/node-server";

export interface ScenarioConfig {
  authMismatch?: boolean; // OAuth2 declared / API-key actual (default: true)
  rateLimitMismatch?: boolean; // 429 declared with Retry-After / actual without (default: true)
}

export interface FixtureServerOptions {
  port?: number;
  scenarios?: ScenarioConfig;
}

export interface RuntimeTargetServer {
  start: () => Promise<string>;
  stop: () => Promise<void>;
  port: number;
}

export function createRuntimeTargetServer(
  opts: FixtureServerOptions = {},
): RuntimeTargetServer {
  const scenarios: ScenarioConfig = {
    authMismatch: opts.scenarios?.authMismatch ?? true,
    rateLimitMismatch: opts.scenarios?.rateLimitMismatch ?? true,
  };

  const app = new Hono();
  let actualPort = opts.port ?? 0;
  let server: ReturnType<typeof serve> | null = null;

  // llms.txt
  app.get("/llms.txt", (c) => {
    c.header("content-type", "text/plain");
    return c.text(
      "# AgentBadge\n\n## OpenAPI\n- /openapi.json\n\n## Agent Guide\n- /agent-guide.json\n",
    );
  });

  // agents.txt
  app.get("/agents.txt", (c) => {
    c.header("content-type", "text/plain");
    return c.text(
      "# agents.txt\n\nagent-name: AgentBadge Test API\napi-docs: /openapi.json\n",
    );
  });

  // well-known agent entry
  app.get("/.well-known/ai-plugin.json", (c) => {
    return c.json({
      schema_version: "1.0",
      api: "openapi",
      api_url: "/openapi.json",
      name: "AgentBadge Test API",
    });
  });

  // OpenAPI spec — declares OAuth2 (mismatch if authMismatch=true)
  app.get("/openapi.json", (c) => {
    const securitySchemes = scenarios.authMismatch
      ? {
          oauth2: {
            type: "oauth2" as const,
            flows: {
              clientCredentials: {
                tokenUrl: "/oauth/token",
                scopes: { read: "read access" },
              },
            },
          },
        }
      : {
          apiKey: {
            type: "apiKey" as const,
            in: "header" as const,
            name: "X-Api-Key",
          },
        };

    return c.json({
      openapi: "3.0.0",
      info: { title: "AgentBadge Test API", version: "1.0.0" },
      paths: {
        "/api/v1/status": {
          get: {
            summary: "Get status",
            responses: { "200": { description: "OK" } },
          },
        },
        "/api/v1/protected": {
          get: {
            summary: "Protected endpoint",
            security: scenarios.authMismatch ? [{ oauth2: ["read"] }] : [{ apiKey: [] }],
            responses: {
              "200": { description: "OK" },
              "401": { description: "Unauthorized" },
            },
          },
        },
        "/api/v1/rate-limited": {
          get: {
            summary: "Rate limited endpoint",
            responses: {
              "429": {
                description: "Rate limited",
                // Declared with Retry-After (mismatch if rateLimitMismatch=true)
                headers: scenarios.rateLimitMismatch
                  ? { "Retry-After": { schema: { type: "integer" } } }
                  : {},
              },
            },
          },
        },
      },
      components: { securitySchemes },
    });
  });

  // agent-guide.json
  app.get("/agent-guide.json", (c) => {
    return c.json({
      schema_version: "1.0",
      api_name: "AgentBadge Test API",
      base_url: "http://localhost",
      auth: scenarios.authMismatch
        ? { type: "oauth2", token_url: "/oauth/token" }
        : { type: "api_key", header: "X-Api-Key" },
    });
  });

  // Read endpoint — returns 200 with rate-limit headers
  app.get("/api/v1/status", (c) => {
    c.header("x-ratelimit-limit", "100");
    c.header("x-ratelimit-remaining", "99");
    return c.json({ status: "ok", timestamp: "2026-01-01T00:00:00Z" });
  });

  // Protected endpoint — mismatch scenario
  app.get("/api/v1/protected", (c) => {
    if (scenarios.authMismatch) {
      // Actual auth is API-key, but OpenAPI declares OAuth2
      const apiKey = c.req.header("x-api-key");
      if (!apiKey) {
        c.header("www-authenticate", 'ApiKey realm="api"');
        return c.json({ error: "unauthorized" }, 401);
      }
      return c.json({ data: "protected-content" });
    }
    // No mismatch: accept any auth
    const apiKey = c.req.header("x-api-key");
    if (!apiKey) {
      return c.json({ error: "unauthorized" }, 401);
    }
    return c.json({ data: "protected-content" });
  });

  // Rate-limited endpoint — mismatch scenario
  app.get("/api/v1/rate-limited", (c) => {
    if (scenarios.rateLimitMismatch) {
      // Actual: 429 WITHOUT Retry-After (OpenAPI declares it with Retry-After)
      return c.json({ error: "rate_limited" }, 429);
    }
    // No mismatch: 429 WITH Retry-After
    c.header("retry-after", "60");
    return c.json({ error: "rate_limited" }, 429);
  });

  // Safe-invalid endpoint — always 404
  app.get("/api/v1/nonexistent", (c) => {
    return c.json({ error: "not_found" }, 404);
  });

  return {
    get port() {
      return actualPort;
    },
    async start() {
      return new Promise<string>((resolve) => {
        server = serve(
          {
            fetch: app.fetch,
            port: opts.port ?? 0,
          },
          (info) => {
            actualPort = info.port;
            resolve(`http://localhost:${info.port}`);
          },
        );
      });
    },
    async stop() {
      return new Promise<void>((resolve) => {
        if (server) {
          server.close(() => resolve());
        } else {
          resolve();
        }
      });
    },
  };
}
