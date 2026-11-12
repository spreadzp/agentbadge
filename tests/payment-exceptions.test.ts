/**
 * SLICE-222-4 — admin exceptions endpoint:
 * GET /api/v1/payments/exceptions.
 * Admin-gated, projected (no raw internals beyond exception details),
 * 501 when the persistence backend lacks the exceptions port.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { createPaymentsReadRoutes } from "../src/server/routes/payments-read-routes";
import type { PaymentsCheckout } from "../src/server/lib/payments-api";

const ADMIN_KEY = "test-admin-key-2224";

function fakeCheckout(exceptions: unknown[] | null) {
  return {
    listExceptions: async () => exceptions,
  } as unknown as PaymentsCheckout;
}

function app(exceptions: unknown[] | null) {
  return createPaymentsReadRoutes(() => fakeCheckout(exceptions));
}

const exceptionRow = {
  id: "exc-att1-0xdead-UNDERPAID",
  paymentId: "pay1",
  attemptId: "att1",
  kind: "UNDERPAID",
  severity: "WARN",
  status: "OPEN",
  details: { txHash: "0xdead", amountUnits: "1" },
  createdAtMs: 1_700_000_000_000,
  resolvedAtMs: null,
  resolutionNote: null,
};

describe("GET /api/v1/payments/exceptions", () => {
  const prev = process.env.ADMIN_API_KEY;
  beforeEach(() => {
    process.env.ADMIN_API_KEY = ADMIN_KEY;
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.ADMIN_API_KEY;
    else process.env.ADMIN_API_KEY = prev;
  });

  it("401 without admin key", async () => {
    const res = await app([exceptionRow]).request(
      "/api/v1/payments/exceptions",
    );
    expect(res.status).toBe(401);
  });

  it("200 with admin key — projected exception rows", async () => {
    const res = await app([exceptionRow]).request(
      "/api/v1/payments/exceptions",
      { headers: { "X-Admin-Key": ADMIN_KEY } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.exceptions).toHaveLength(1);
    expect(body.exceptions[0].id).toBe(exceptionRow.id);
    expect(body.exceptions[0].kind).toBe("UNDERPAID");
    expect(body.exceptions[0].createdAt).toBe(
      new Date(exceptionRow.createdAtMs).toISOString(),
    );
  });

  it("accepts Bearer token + status/kind/limit filters pass-through", async () => {
    const calls: Record<string, unknown>[] = [];
    const checkout = {
      listExceptions: async (opts: Record<string, unknown>) => {
        calls.push(opts);
        return [];
      },
    } as unknown as PaymentsCheckout;
    const routes = createPaymentsReadRoutes(() => checkout);
    const res = await routes.request(
      "/api/v1/payments/exceptions?status=OPEN&kind=UNDERPAID&limit=5",
      { headers: { Authorization: `Bearer ${ADMIN_KEY}` } },
    );
    expect(res.status).toBe(200);
    expect(calls[0]).toMatchObject({
      status: "OPEN",
      kind: "UNDERPAID",
      limit: 5,
    });
  });

  it("503 when exceptions port is absent", async () => {
    const res = await app(null).request("/api/v1/payments/exceptions", {
      headers: { "X-Admin-Key": ADMIN_KEY },
    });
    expect(res.status).toBe(503);
  });
});
