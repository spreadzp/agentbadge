/**
 * SLICE-234-37: /events route contract.
 *
 * Prod evidence: GET /events → 500 INTERNAL_ERROR "Base event indexer
 * not started" — indexer only runs under CHAIN_MODE=base, prod is
 * hedera mode, so every call 500'd. Now: honest 503
 * events_indexer_disabled retryable:false.
 */

import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { eventsRoutes } from "../../src/server/routes/observability/events";

describe("GET /events (SLICE-234-37)", () => {
  it("indexer not started (hedera mode) → 503 events_indexer_disabled", async () => {
    const app = new Hono();
    app.route("/", eventsRoutes);

    const res = await app.request("/events");

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe("events_indexer_disabled");
    expect(body.retryable).toBe(false);
  });
});
