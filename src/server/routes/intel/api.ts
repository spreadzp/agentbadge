// EPIC-262 (SLICE-262-0a): /api/intel/* namespace — scaffold smoke endpoint.
import { Hono } from "hono";
import { INTEL_API_VERSION } from "../../lib/intel/keys";
import { INTEL_KEY_MISSING, type IntelRouteDeps } from "./index";

export function createIntelApiRoutes(deps: IntelRouteDeps): Hono {
  const app = new Hono();

  app.get("/status", (c) => {
    if (!deps.key) return c.json(INTEL_KEY_MISSING, 503);
    return c.json({
      service: "agent-surface-intel",
      status: "ok",
      version: INTEL_API_VERSION,
      key_id: deps.key.keyId,
    });
  });

  return app;
}
