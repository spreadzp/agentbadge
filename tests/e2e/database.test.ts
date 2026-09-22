import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetConfigCache } from "../../src/config/env";
import { resetDatabaseForTests } from "../../src/server/lib/database";
import { opsRoutes } from "../../src/server/routes/ops";
import { setupMockEnv } from "./helpers";

/**
 * SLICE-143-6: database feature gate on the real health route.
 * opsRoutes is mounted directly (makeTestApp stubs /health itself).
 */
describe("database health gate (EPIC-143)", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    setupMockEnv();
    delete process.env.DATABASE_ENABLED;
    delete process.env.DATABASE_URL;
    resetConfigCache();
    resetDatabaseForTests();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetConfigCache();
    resetDatabaseForTests();
  });

  const app = () => {
    const a = new Hono();
    a.route("/", opsRoutes);
    return a;
  };

  it("DATABASE_ENABLED unset → db: disabled, zero behavior change", async () => {
    const res = await app().request("/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("healthy");
    expect(body.db).toBe("disabled");
    // existing fields untouched (toolsCount is 0 here — tools register in
    // index.ts, not when opsRoutes mounts standalone)
    expect(typeof body.mcp.toolsCount).toBe("number");
    expect(body.payments).toBeDefined();
  });

  it("DATABASE_ENABLED=false → db: disabled", async () => {
    process.env.DATABASE_ENABLED = "false";
    const res = await app().request("/health");
    const body = await res.json();
    expect(body.db).toBe("disabled");
  });

  it("DATABASE_ENABLED=true + unreachable URL → db: down (no crash)", async () => {
    process.env.DATABASE_ENABLED = "true";
    process.env.DATABASE_URL =
      "postgres://postgres:postgres@localhost:59999/nope";
    const res = await app().request("/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.db).toBe("down");
  });

  it("DATABASE_ENABLED=true + live PG → db: up", async () => {
    if (!process.env.DATABASE_URL_LIVE) return; // opt-in: set to local docker PG
    process.env.DATABASE_ENABLED = "true";
    process.env.DATABASE_URL = process.env.DATABASE_URL_LIVE;
    const res = await app().request("/health");
    const body = await res.json();
    expect(body.db).toBe("up");
  });
});
