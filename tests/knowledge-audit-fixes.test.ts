import { beforeAll, describe, expect, it } from "vitest";
import { Hono } from "hono";

import {
  createKnowledgeItem,
  createMemoryKnowledgeStores,
} from "../src/server/lib/knowledge";
import { createAdminKnowledgeRoutes } from "../src/server/routes/admin-knowledge-api";
import { resetIdempotencyStore } from "../src/server/lib/contract-guards";

/**
 * SLICE-229-11 regression — hermes verify r1 findings:
 * - H-1: every mutating /admin/api/knowledge/* POST requires
 *   x-operator-id → typed 400, actor attribution never "admin".
 * - M-1: NUL/control chars in stored text fields → typed 400,
 *   never a 500 (PG driver can't encode NUL).
 */

const ADMIN = { "x-admin-key": "test-admin-key" };
const OPH = { ...ADMIN, "x-operator-id": "ops_test" };
let idem = 0;
const key = () => `kn-fix-${Date.now()}-${++idem}`;

function mkApp() {
  process.env.ADMIN_API_KEY = "test-admin-key";
  resetIdempotencyStore();
  const store = createMemoryKnowledgeStores();
  const app = new Hono();
  app.route("/", createAdminKnowledgeRoutes({ store }));
  return { app, store };
}

const post = (
  app: Hono,
  path: string,
  headers: Record<string, string>,
  body?: unknown,
) =>
  app.request(path, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });

beforeAll(() => {
  process.env.ADMIN_API_KEY = "test-admin-key";
});

describe("229-11: x-operator-id required on mutations", () => {
  it("create/transition/capability/relation/evidence/gap → 400 without header", async () => {
    const { app, store } = mkApp();
    const create = await post(
      app,
      "/admin/api/knowledge/items",
      { ...ADMIN, "idempotency-key": key() },
      { kind: "FAQ", title: "t", body: "b" },
    );
    expect(create.status).toBe(400);
    expect(await store.listItems({})).toHaveLength(0);

    const item = await createKnowledgeItem(
      store,
      { kind: "GUIDE", slug: "fix-target", title: "t", body: "b" },
      "ops",
    );
    if (!item.ok) throw new Error("seed failed");
    const vid = item.item.latestVersionId ?? "";

    const noOp = { ...ADMIN };
    const cases: [string, unknown][] = [
      [`/admin/api/knowledge/items/${item.item.id}/transition`, { to: "PENDING" }],
      ["/admin/api/knowledge/relations", { fromItemId: item.item.id, toItemId: item.item.id, type: "RELATED_TO" }],
      [`/admin/api/knowledge/versions/${vid}/evidence`, { type: "EXTERNAL_URL", uri: "https://x.test" }],
      ["/admin/api/knowledge/capabilities", { name: "cap.x", kind: "MANUAL" }],
      [`/admin/api/knowledge/items/${item.item.id}/capabilities`, { capabilityId: "kc_x" }],
      ["/admin/api/knowledge/gaps/kg_x/triage", {}],
    ];
    for (const [path, body] of cases) {
      const r = await post(app, path, { ...noOp, "idempotency-key": key() }, body);
      expect(r.status).toBe(400);
      expect((await r.json()).code).toBe("MISSING_FIELDS");
    }
    expect((await store.getItem(item.item.id))?.status).toBe("DRAFT");
  });

  it("same mutations succeed WITH x-operator-id", async () => {
    const { app } = mkApp();
    const r = await post(
      app,
      "/admin/api/knowledge/items",
      { ...OPH, "idempotency-key": key() },
      { kind: "FAQ", title: "op ok", body: "b" },
    );
    expect(r.status).toBe(201);
  });
});

describe("229-11: NUL/control chars rejected, never 500", () => {
  it("title/body/summary with NUL → 400 at the route", async () => {
    const { app, store } = mkApp();
    for (const field of ["title", "body", "summary"] as const) {
      const payload: Record<string, string> = {
        kind: "GUIDE", slug: `nul-${field}`, title: "t", body: "b", summary: "s",
      };
      payload[field] = `pre\u0000post`;
      const r = await post(
        app,
        "/admin/api/knowledge/items",
        { ...OPH, "idempotency-key": key() },
        payload,
      );
      expect(r.status).toBe(400);
    }
    expect(await store.listItems({})).toHaveLength(0);
  });

  it("lib-level: createKnowledgeItem honest {ok:false}, no throw", async () => {
    const store = createMemoryKnowledgeStores();
    const r = await createKnowledgeItem(
      store,
      { kind: "GUIDE", slug: "nul-lib", title: "a\u0000b", body: "ok" },
      "ops",
    );
    expect(r.ok).toBe(false);
  });
});
