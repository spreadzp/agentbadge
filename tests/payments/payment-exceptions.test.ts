/**
 * SLICE-222-4 — admin exceptions endpoint:
 * GET /api/v1/payments/exceptions.
 * Admin-gated, projected (no raw internals beyond exception details),
 * 501 when the persistence backend lacks the exceptions port.
 */
import { describe, expect, it } from "vitest";
import { createPaymentsReadRoutes } from "../../src/server/routes/payments/payments-read-routes";
import type { PaymentsCheckout } from "../../src/server/lib/payments-api";
import {
  createMemoryOperatorStore,
  seedOperator,
} from "../helpers/operators";

function fakeCheckout(exceptions: unknown[] | null) {
  return {
    listExceptions: async () => exceptions,
  } as unknown as PaymentsCheckout;
}

// 264-8: exceptions read rides an operator credential (read cap).
async function app(exceptions: unknown[] | null) {
  const opStore = createMemoryOperatorStore();
  const { key } = await seedOperator(opStore, "Reader", ["read"]);
  return {
    routes: createPaymentsReadRoutes(
      () => fakeCheckout(exceptions),
      opStore,
    ),
    opKey: key,
  };
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

  it("401 without an operator credential", async () => {
    const { routes } = await app([exceptionRow]);
    const res = await routes.request("/api/v1/payments/exceptions");
    expect(res.status).toBe(401);
  });

  it("200 with an operator credential — projected exception rows", async () => {
    const { routes, opKey } = await app([exceptionRow]);
    const res = await routes.request(
      "/api/v1/payments/exceptions",
      { headers: { "X-Admin-Key": opKey } },
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
    const opStore = createMemoryOperatorStore();
    const { key } = await seedOperator(opStore, "Reader", ["read"]);
    const routes = createPaymentsReadRoutes(() => checkout, opStore);
    const res = await routes.request(
      "/api/v1/payments/exceptions?status=OPEN&kind=UNDERPAID&limit=5",
      { headers: { Authorization: `Bearer ${key}` } },
    );
    expect(res.status).toBe(200);
    expect(calls[0]).toMatchObject({
      status: "OPEN",
      kind: "UNDERPAID",
      limit: 5,
    });
  });

  it("503 when exceptions port is absent", async () => {
    const { routes, opKey } = await app(null);
    const res = await routes.request("/api/v1/payments/exceptions", {
      headers: { "X-Admin-Key": opKey },
    });
    expect(res.status).toBe(503);
  });
});
