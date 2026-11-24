import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";

import {
  getPrincipal,
  operatorAuth,
  requireCapability,
} from "../../src/server/middleware/operatorAuth";
import { breakGlassAuthUsed } from "../../src/server/middleware/operator-breakglass";
import {
  adminKeyPrefix,
  createMemoryOperatorStore,
  generateAdminKeyPlaintext,
  hashAdminKey,
  type OperatorStore,
} from "../../src/server/lib/operators";
import {
  createMemoryKnowledgeStores,
  evidenceFingerprint,
} from "../../src/server/lib/knowledge";
import { createAdminKnowledgeRoutes } from "../../src/server/routes/admin-knowledge-api";
import { resetIdempotencyStore } from "../../src/server/lib/contract-guards";
import { generateReportId } from "../../src/agent-readiness/integrity/ulid";

/**
 * SLICE-264-9 contract test — break-glass.
 *
 * The dual-auth window (264-5) is deleted; the shared ADMIN_API_KEY
 * lives ONLY under ADMIN_BREAK_GLASS_ENABLED:
 *  - flag OFF (or absent): shared key → identical 401 envelope
 *  - flag ON: shared key → MARKED break_glass principal (never a
 *    personal identity), warn alert + per-surface metric on every use
 *  - ADMIN_API_KEY unset: flag alone grants nothing
 * Boundary: the synthetic operator carries read+workflow — the shared
 * key must NEVER satisfy operator-admin (SLICE-264-4 invariant).
 */

const SHARED_KEY = "shared-admin-key-for-tests";
const id = (p: string) => `${p}_${generateReportId()}`;

const metricValue = async (surface: string): Promise<number> => {
  const snap = await breakGlassAuthUsed.get();
  const row = snap.values.find((v) => v.labels.surface === surface);
  return row?.value ?? 0;
};

async function seedOperator(store: OperatorStore) {
  const op = await store.createOperator({
    id: id("op"),
    displayName: "Tester",
    principalType: "human",
    capabilities: ["read", "workflow", "operator-admin"],
  });
  if (!op.ok) throw new Error(`seed failed: ${op.reason}`);
  const key = generateAdminKeyPlaintext();
  const cred = await store.issueCredential({
    id: id("opc"),
    operatorId: op.operator.id,
    keyHash: hashAdminKey(key),
    keyPrefix: adminKeyPrefix(key),
  });
  if (!cred.ok) throw new Error(`seed failed: ${cred.reason}`);
  return { operator: op.operator, key };
}

function makeApp(store: OperatorStore): Hono {
  const app = new Hono();
  app.use("/admin/*", operatorAuth(store));
  app.get("/admin/whoami", (c) => c.json(getPrincipal(c) ?? null));
  app.post("/admin/manage-operators", (c) => {
    const deny = requireCapability(c, "operator-admin");
    return deny ?? c.json({ ok: true });
  });
  return app;
}

describe("break-glass — shared key under flag only (SLICE-264-9)", () => {
  const saved = new Map<string, string | undefined>();
  const setEnv = (k: string, v: string | undefined) => {
    if (!saved.has(k)) saved.set(k, process.env[k]);
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  };

  beforeEach(() => {
    setEnv("ADMIN_API_KEY", SHARED_KEY);
    setEnv("ADMIN_BREAK_GLASS_ENABLED", undefined);
  });
  afterEach(() => {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    saved.clear();
  });

  it("flag OFF: shared key → identical 401 envelope", async () => {
    const store = createMemoryOperatorStore();
    await seedOperator(store); // store non-empty — refusal isn't about emptiness
    const app = makeApp(store);

    const res = await app.request("/admin/whoami", {
      headers: { "X-Admin-Key": SHARED_KEY },
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: "Unauthorized",
      code: "UNAUTHORIZED",
    });
  });

  it("flag ON: shared key → marked break_glass principal, metric + alert per surface", async () => {
    setEnv("ADMIN_BREAK_GLASS_ENABLED", "true");
    const store = createMemoryOperatorStore();
    const app = makeApp(store);
    const before = await metricValue("/admin/whoami");

    const res = await app.request("/admin/whoami", {
      headers: { "X-Admin-Key": SHARED_KEY },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: "break_glass",
      principalType: "break_glass",
      keyPrefix: "break_glass",
    });
    expect(await metricValue("/admin/whoami")).toBe(before + 1);

    // read/workflow-capable …
    // …but operator-admin is NOT conferred — the shared key never
    // mints operator credentials.
    const manage = await app.request("/admin/manage-operators", {
      method: "POST",
      headers: { "X-Admin-Key": SHARED_KEY },
    });
    expect(manage.status).toBe(403);
    expect((await manage.json()).code).toBe("INSUFFICIENT_CAPABILITY");

    // a real opk_ credential keeps its own identity — break-glass is
    // a miss-path only, never a shadow over real credentials
    const { operator, key } = await seedOperator(store);
    const whoami = await app.request("/admin/whoami", {
      headers: { "X-Admin-Key": key },
    });
    expect(await whoami.json()).toEqual({
      id: operator.id,
      principalType: "human",
      keyPrefix: adminKeyPrefix(key),
    });
  });

  it("flag non-true values still refuse — exactly 'true' arms the path", async () => {
    setEnv("ADMIN_BREAK_GLASS_ENABLED", "1");
    const store = createMemoryOperatorStore();
    const app = makeApp(store);
    const res = await app.request("/admin/whoami", {
      headers: { "X-Admin-Key": SHARED_KEY },
    });
    expect(res.status).toBe(401);
  });

  it("ADMIN_API_KEY unset → flag alone grants nothing", async () => {
    setEnv("ADMIN_API_KEY", undefined);
    setEnv("ADMIN_BREAK_GLASS_ENABLED", "true");
    const store = createMemoryOperatorStore();
    const app = makeApp(store);
    const res = await app.request("/admin/whoami", {
      headers: { "X-Admin-Key": SHARED_KEY },
    });
    expect(res.status).toBe(401);
  });

  it("wrong key under an armed flag still refuses — break-glass accepts the SHARED key only", async () => {
    setEnv("ADMIN_BREAK_GLASS_ENABLED", "true");
    const store = createMemoryOperatorStore();
    const app = makeApp(store);
    const res = await app.request("/admin/whoami", {
      headers: { "X-Admin-Key": "not-the-shared-key" },
    });
    expect(res.status).toBe(401);
    // and a real opk_ still authenticates
    const { key } = await seedOperator(store);
    const ok = await app.request("/admin/whoami", {
      headers: { "X-Admin-Key": key },
    });
    expect(ok.status).toBe(200);
  });

  it("a credential row keyed to the shared key can never exist (store-HIT shadow path closed)", async () => {
    const store = createMemoryOperatorStore();
    const { operator } = await seedOperator(store);
    // seeding/issuing a credential whose hash IS sha256(ADMIN_API_KEY)
    // would let the shared key ride the store-hit path as a personal
    // identity — no break_glass marking. Store refuses.
    const res = await store.issueCredential({
      id: id("opc"),
      operatorId: operator.id,
      keyHash: hashAdminKey(SHARED_KEY),
      keyPrefix: "opk_shared00",
    });
    expect(res).toEqual({ ok: false, reason: "key_is_shared_secret" });
  });

  it("DoD integration: break-glass attributes break_glass on a real surface", async () => {
    setEnv("ADMIN_BREAK_GLASS_ENABLED", "true");
    resetIdempotencyStore();
    const store = createMemoryKnowledgeStores();
    const operatorStore = createMemoryOperatorStore();
    const app = new Hono();
    app.route("/", createAdminKnowledgeRoutes({ store, operatorStore }));

    const res = await app.request("/admin/api/knowledge/items", {
      method: "POST",
      headers: {
        "x-admin-key": SHARED_KEY,
        "content-type": "application/json",
        "idempotency-key": `bg-${Date.now()}`,
      },
      body: JSON.stringify({ kind: "FAQ", title: "t", body: "b" }),
    });
    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created.item.createdBy).toBe("break_glass");
  });

  it("DoD: the shared principal can't self-approve — the collapse makes SoD REAL, not cosmetic", async () => {
    // Every break-glass caller IS break_glass — create/submit work,
    // but verify of its own submit is a hard SEPARATION_OF_DUTIES.
    // Approval needs a personal credential.
    setEnv("ADMIN_BREAK_GLASS_ENABLED", "true");
    resetIdempotencyStore();
    const store = createMemoryKnowledgeStores();
    const operatorStore = createMemoryOperatorStore();
    const app = new Hono();
    app.route("/", createAdminKnowledgeRoutes({ store, operatorStore }));
    let seq = 0;
    const headers = () => ({
      "x-admin-key": SHARED_KEY,
      "content-type": "application/json",
      "idempotency-key": `bg-sod-${Date.now()}-${++seq}`,
    });

    const created = await app.request("/admin/api/knowledge/items", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ kind: "FAQ", title: "t", body: "b" }),
    });
    expect(created.status).toBe(201);
    const { item, version } = await created.json();
    // Evidence gate (Arc R1 H4) must be satisfied before verify.
    const ev = await app.request(
      `/admin/api/knowledge/versions/${version.id}/evidence`,
      {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          type: "INTERNAL_DOC",
          uri: "internal://runbook/bg-sod",
        }),
      },
    );
    expect(ev.status).toBe(200);
    const submit = await app.request(
      `/admin/api/knowledge/items/${item.id}/transition`,
      {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ to: "PENDING" }),
      },
    );
    expect(submit.status).toBe(200);
    const cur = await store.getItem(item.id);
    const evRows = cur?.latestVersionId
      ? await store.listEvidence(cur.latestVersionId)
      : [];
    const verify = await app.request(
      `/admin/api/knowledge/items/${item.id}/transition`,
      {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          to: "VERIFIED",
          expectedVersionId: cur?.latestVersionId ?? undefined,
          expectedEvidence: evidenceFingerprint(evRows),
        }),
      },
    );
    expect(verify.status).toBe(403);
    expect((await verify.json()).error.code).toBe("SEPARATION_OF_DUTIES");
    // …but a personal credential CAN approve the bg-submitted item.
    const { key } = await seedOperator(operatorStore);
    const approve = await app.request(
      `/admin/api/knowledge/items/${item.id}/transition`,
      {
        method: "POST",
        headers: {
          "x-admin-key": key,
          "content-type": "application/json",
          "idempotency-key": `bg-sod-${Date.now()}-op`,
        },
        body: JSON.stringify({
          to: "VERIFIED",
          expectedVersionId: cur?.latestVersionId ?? undefined,
          expectedEvidence: evidenceFingerprint(evRows),
        }),
      },
    );
    expect(approve.status).toBe(200);
  });
});
