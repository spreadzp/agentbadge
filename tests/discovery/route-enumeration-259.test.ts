import { describe, it, expect } from "vitest";
import { enumeratePublicRoutes } from "../../src/server/lib/agent-discovery/sources";

// SLICE-259-34 (F1/G1/G2): the generated Public API section must list
// only fetchable agent-facing routes — no ops/admin leakage, no
// wildcard/param templates, and no phantom GET labels produced by
// x402-paywall middleware registered as ALL entries.

function appWith(routes: Array<[string, string]>) {
  return { routes: routes.map(([method, path]) => ({ method, path })) };
}

describe("SLICE-259-34: enumeratePublicRoutes", () => {
  it("drops ALL middleware shadows when a real method exists at the path", () => {
    const out = enumeratePublicRoutes(
      appWith([
        ["POST", "/api/total-scan"],
        ["ALL", "/api/total-scan"], // x402 paywall — was phantom "GET /api/total-scan"
        ["POST", "/api/eaas/subscribe"],
        ["ALL", "/api/eaas/subscribe"],
      ]),
    );
    expect(out).toContain("POST /api/total-scan");
    expect(out).toContain("POST /api/eaas/subscribe");
    expect(out.some((r) => r.startsWith("GET /api/total-scan"))).toBe(false);
    expect(out.some((r) => r.startsWith("GET /api/eaas/subscribe"))).toBe(false);
  });

  it("keeps ALL-only paths as GET (they answer every method)", () => {
    const out = enumeratePublicRoutes(
      appWith([["ALL", "/api/passport/request"]]),
    );
    expect(out).toEqual(["GET /api/passport/request"]);
  });

  it("omits wildcard and :param template paths — OpenAPI owns templates", () => {
    const out = enumeratePublicRoutes(
      appWith([
        ["GET", "/api/board/cards"],
        ["GET", "/api/board/cards/:id"],
        ["ALL", "/api/v1/*"],
        ["ALL", "/api/payment/*"],
        ["GET", "/api/agent/:did/card"],
      ]),
    );
    expect(out).toEqual(["GET /api/board/cards"]);
  });

  it("excludes operator/scoped prefixes", () => {
    const out = enumeratePublicRoutes(
      appWith([
        ["GET", "/api/ops/requests"],
        ["GET", "/api/ledger/revenue"],
        ["GET", "/api/venue/instances"],
        ["GET", "/api/venue/indexer/health"],
        ["GET", "/api/wallets/audit"],
        ["GET", "/api/payments/health"],
        ["GET", "/api/intel/dashboard"],
        ["GET", "/api/gec/callback"],
        ["POST", "/api/indexnow"],
        ["POST", "/api/keeperhub/audit/webhook"],
        ["GET", "/api/v1/entitlements"],
        ["GET", "/api/v1/payments/exceptions"],
        ["GET", "/api/health"],
        ["GET", "/api/board/cards"],
      ]),
    );
    expect(out).toEqual(["GET /api/board/cards", "GET /api/health"]);
  });

  it("keeps /.well-known/ manifests", () => {
    const out = enumeratePublicRoutes(
      appWith([["GET", "/.well-known/agent-card.json"]]),
    );
    expect(out).toEqual(["GET /.well-known/agent-card.json"]);
  });
});
