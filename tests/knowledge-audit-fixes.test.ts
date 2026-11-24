import { describe, expect, it } from "vitest";
import { Hono } from "hono";

import {
  createKnowledgeItem,
  createMemoryKnowledgeStores,
} from "../src/server/lib/knowledge";
import { createAdminKnowledgeRoutes } from "../src/server/routes/admin-knowledge-api";
import { resetIdempotencyStore } from "../src/server/lib/contract-guards";
import {
  createMemoryOperatorStore,
  seedOperator,
} from "./helpers/operators";

/**
 * SLICE-229-11 regression — hermes verify r1 findings (SLICE-264-6
 * re-expression):
 * - H-1 then: x-operator-id was REQUIRED for attribution.
 * - H-1 now: the header is a typed 400 at the operatorAuth boundary
 *   (D-264-Q16) — actor attribution is the credential's principal.id
 *   and can never be self-asserted again.
 * - M-1: NUL/control chars in stored text fields → typed 400,
 *   never a 500 (PG driver can't encode NUL).
 */

let idem = 0;
const key = () => `kn-fix-${Date.now()}-${++idem}`;

async function mkApp() {
  resetIdempotencyStore();
  const store = createMemoryKnowledgeStores();
  const operatorStore = createMemoryOperatorStore();
  const alice = await seedOperator(operatorStore, "Alice");
  const app = new Hono();
  app.route("/", createAdminKnowledgeRoutes({ store, operatorStore }));
  return { app, store, alice, AUTH: { "x-admin-key": alice.key } };
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

describe("264-6: x-operator-id dies at the boundary", () => {
  it("create/transition/capability/relation/evidence/gap → 400 on header presence", async () => {
    const { app, store, AUTH } = await mkApp();
    const create = await post(
      app,
      "/admin/api/knowledge/items",
      { ...AUTH, "x-operator-id": "ops_test", "idempotency-key": key() },
      { kind: "FAQ", title: "t", body: "b" },
    );
    expect(create.status).toBe(400);
    expect((await create.json()).code).toBe("OPERATOR_HEADER_REJECTED");
    expect(await store.listItems({})).toHaveLength(0);

    const item = await createKnowledgeItem(
      store,
      { kind: "GUIDE", slug: "fix-target", title: "t", body: "b" },
      "ops",
    );
    if (!item.ok) throw new Error("seed failed");
    const vid = item.item.latestVersionId ?? "";

    const withHeader = { ...AUTH, "x-operator-id": "ops_test" };
    const cases: [string, unknown][] = [
      [`/admin/api/knowledge/items/${item.item.id}/transition`, { to: "PENDING" }],
      ["/admin/api/knowledge/relations", { fromItemId: item.item.id, toItemId: item.item.id, type: "RELATED_TO" }],
      [`/admin/api/knowledge/versions/${vid}/evidence`, { type: "EXTERNAL_URL", uri: "https://x.test" }],
      ["/admin/api/knowledge/capabilities", { name: "cap.x", kind: "MANUAL" }],
      [`/admin/api/knowledge/items/${item.item.id}/capabilities`, { capabilityId: "kc_x" }],
      ["/admin/api/knowledge/gaps/kg_x/triage", {}],
    ];
    for (const [path, body] of cases) {
      const r = await post(
        app,
        path,
        { ...withHeader, "idempotency-key": key() },
        body,
      );
      expect(r.status).toBe(400);
      expect((await r.json()).code).toBe("OPERATOR_HEADER_REJECTED");
    }
    expect((await store.getItem(item.item.id))?.status).toBe("DRAFT");
  });

  it("mutations succeed on the credential alone — actor = operator id", async () => {
    const { app, alice, AUTH } = await mkApp();
    const r = await post(
      app,
      "/admin/api/knowledge/items",
      { ...AUTH, "idempotency-key": key() },
      { kind: "FAQ", title: "op ok", body: "b" },
    );
    expect(r.status).toBe(201);
    const created = await r.json();
    const events = created.item;
    expect(events.createdBy ?? "").not.toBe("admin");
    expect(created.item.createdBy).toBe(alice.operatorId);
  });
});

describe("229-11: NUL/control chars rejected, never 500", () => {
  it("title/body/summary with NUL → 400 at the route", async () => {
    const { app, store, AUTH } = await mkApp();
    for (const field of ["title", "body", "summary"] as const) {
      const payload: Record<string, string> = {
        kind: "GUIDE", slug: `nul-${field}`, title: "t", body: "b", summary: "s",
      };
      payload[field] = `pre\u0000post`;
      const r = await post(
        app,
        "/admin/api/knowledge/items",
        { ...AUTH, "idempotency-key": key() },
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

/**
 * 229-12 prod-verify BUG-1 regression — read-path twin of M-1:
 * NUL/C0 in :id/:vid/?uri/?q params and id-typed body fields →
 * typed 400, never the unauthenticated 500 the PG driver threw.
 */
describe("229-12: read-path NUL/control chars → 400", () => {
  it("path params :id/:vid/:gapId → 400", async () => {
    const { app, AUTH } = await mkApp();
    const gets = [
      "/admin/api/knowledge/items/%00",
      "/admin/api/knowledge/items/abc%00def",
      "/admin/api/knowledge/items/%00/relations",
      "/admin/api/knowledge/items/%00/transitions",
      "/admin/api/knowledge/versions/%00/evidence",
      "/admin/api/knowledge/evidence/citing?uri=%00",
    ];
    for (const path of gets) {
      const r = await app.request(path, { headers: AUTH });
      expect(r.status).toBe(400);
      expect((await r.json()).code).toBe("INVALID_INPUT");
    }
  });

  it("mutation path params + id body fields → 400", async () => {
    const { app, AUTH } = await mkApp();
    const h = { ...AUTH, "idempotency-key": key() };
    const cases: [string, unknown][] = [
      ["/admin/api/knowledge/items/pre\u0000post/transition", { to: "PENDING" }],
      ["/admin/api/knowledge/items/pre\u0000post/capabilities", { capabilityId: "kc_x" }],
      ["/admin/api/knowledge/versions/kv_\u0000/evidence", { type: "EXTERNAL_URL", uri: "https://x.test" }],
      ["/admin/api/knowledge/gaps/kg_\u0000/triage", {}],
      ["/admin/api/knowledge/relations", { fromItemId: "ki_\u0000", toItemId: "ki_y", type: "RELATED_TO" }],
      ["/admin/api/knowledge/relations/remove", { relationId: "krel_\u0000" }],
      ["/admin/api/knowledge/evidence/remove", { evidenceId: "kev_\u0000" }],
    ];
    for (const [path, body] of cases) {
      const r = await post(app, path, h, body);
      expect(r.status).toBe(400);
    }
  });

  it("transition reason with NUL → 400, item untouched", async () => {
    const { app, store, AUTH } = await mkApp();
    const item = await createKnowledgeItem(
      store,
      { kind: "GUIDE", slug: "ctrl-op", title: "t", body: "b" },
      "ops",
    );
    if (!item.ok) throw new Error("seed failed");
    const h = { ...AUTH, "idempotency-key": key() };
    const r = await post(
      app,
      `/admin/api/knowledge/items/${item.item.id}/transition`,
      h,
      { to: "PENDING", reason: "r\u0000eason" },
    );
    expect(r.status).toBe(400);
    expect((await store.getItem(item.item.id))?.status).toBe("DRAFT");
  });
});
