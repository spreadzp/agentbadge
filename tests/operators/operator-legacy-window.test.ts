import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";

import {
  getPrincipal,
  operatorAuth,
  requireCapability,
} from "../../src/server/middleware/operatorAuth";
import {
  legacyAuthUsed,
  legacyWindowState,
} from "../../src/server/middleware/operator-legacy";
import {
  adminKeyPrefix,
  createMemoryOperatorStore,
  generateAdminKeyPlaintext,
  hashAdminKey,
  type OperatorStore,
} from "../../src/server/lib/operators";
import { createMemoryKnowledgeStores } from "../../src/server/lib/knowledge";
import { createAdminKnowledgeRoutes } from "../../src/server/routes/admin-knowledge-api";
import { resetIdempotencyStore } from "../../src/server/lib/contract-guards";
import { generateReportId } from "../../src/agent-readiness/integrity/ulid";

/**
 * SLICE-264-5 contract test — dual-auth window.
 *
 * DoD mapping:
 *  - window OPEN: shared key authenticates as the MARKED break_glass
 *    principal (never a personal identity), per-surface metric moves
 *  - window CLOSED + break-glass off: shared key → identical 401
 *  - window CLOSED + break-glass on: shared key authenticates,
 *    mode label flips to break_glass (alert-on-use is the log warn —
 *    the metric label is its durable half)
 *  - malformed ADMIN_LEGACY_KEY_UNTIL → fail-CLOSED, never
 *    silently open
 * Boundary: the synthetic operator carries read+workflow — the shared
 * key must NEVER satisfy operator-admin (SLICE-264-4 invariant).
 */

const LEGACY_KEY = "shared-admin-key-for-tests";
const id = (p: string) => `${p}_${generateReportId()}`;

const metricValue = async (
  surface: string,
  mode: string,
): Promise<number> => {
  const snap = await legacyAuthUsed.get();
  const row = snap.values.find(
    (v) => v.labels.surface === surface && v.labels.mode === mode,
  );
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

describe("dual-auth window — legacy shared key (SLICE-264-5)", () => {
  const saved = new Map<string, string | undefined>();
  const setEnv = (k: string, v: string | undefined) => {
    if (!saved.has(k)) saved.set(k, process.env[k]);
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  };

  beforeEach(() => {
    setEnv("ADMIN_API_KEY", LEGACY_KEY);
  });
  afterEach(() => {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    saved.clear();
  });

  it("window OPEN: shared key → marked break_glass principal, metric per surface", async () => {
    const until = new Date(Date.now() + 3600_000).toISOString();
    setEnv("ADMIN_LEGACY_KEY_UNTIL", until);
    setEnv("ADMIN_BREAK_GLASS_ENABLED", undefined);
    const store = createMemoryOperatorStore();
    const app = makeApp(store);
    const before = await metricValue("/admin/whoami", "window");

    const res = await app.request("/admin/whoami", {
      headers: { "X-Admin-Key": LEGACY_KEY },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: "legacy_admin",
      principalType: "break_glass",
      keyPrefix: "legacy",
    });
    expect(await metricValue("/admin/whoami", "window")).toBe(before + 1);

    // read/workflow-capable …
    // …but operator-admin is NOT conferred — the shared key never
    // mints operator credentials, even inside the window.
    const manage = await app.request("/admin/manage-operators", {
      method: "POST",
      headers: { "X-Admin-Key": LEGACY_KEY },
    });
    expect(manage.status).toBe(403);
    expect((await manage.json()).code).toBe("INSUFFICIENT_CAPABILITY");

    // a real opk_ credential keeps its own identity — the window is
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

  it("window CLOSED + break-glass OFF: shared key → identical 401 envelope", async () => {
    setEnv("ADMIN_LEGACY_KEY_UNTIL", undefined);
    setEnv("ADMIN_BREAK_GLASS_ENABLED", undefined);
    const store = createMemoryOperatorStore();
    await seedOperator(store); // store non-empty — refusal isn't about emptiness
    const app = makeApp(store);

    const res = await app.request("/admin/whoami", {
      headers: { "X-Admin-Key": LEGACY_KEY },
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: "Unauthorized",
      code: "UNAUTHORIZED",
    });
  });

  it("window CLOSED + break-glass ON: shared key authenticates, mode=break_glass", async () => {
    setEnv("ADMIN_LEGACY_KEY_UNTIL", new Date(0).toISOString()); // past
    setEnv("ADMIN_BREAK_GLASS_ENABLED", "true");
    const store = createMemoryOperatorStore();
    const app = makeApp(store);
    const before = await metricValue("/admin/whoami", "break_glass");

    const res = await app.request("/admin/whoami", {
      headers: { "X-Admin-Key": LEGACY_KEY },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: "legacy_admin",
      principalType: "break_glass",
      keyPrefix: "legacy",
    });
    expect(await metricValue("/admin/whoami", "break_glass")).toBe(
      before + 1,
    );
  });

  it("malformed deadline fails CLOSED — a typo must not widen the window", async () => {
    setEnv("ADMIN_LEGACY_KEY_UNTIL", "next-friday-ish");
    setEnv("ADMIN_BREAK_GLASS_ENABLED", undefined);
    const store = createMemoryOperatorStore();
    const app = makeApp(store);

    expect(legacyWindowState()).toEqual({
      state: "closed",
      why: "malformed",
    });
    const res = await app.request("/admin/whoami", {
      headers: { "X-Admin-Key": LEGACY_KEY },
    });
    expect(res.status).toBe(401);
  });

  it("offset-less deadline fails CLOSED — server-local parsing would silently widen the window", async () => {
    // "2026-12-15T00:00:00" parses as SERVER-LOCAL time — fail-open
    // on any host west of Greenwich. Zone designator is mandatory.
    setEnv("ADMIN_LEGACY_KEY_UNTIL", "2999-01-01T00:00:00");
    setEnv("ADMIN_BREAK_GLASS_ENABLED", undefined);
    expect(legacyWindowState()).toEqual({
      state: "closed",
      why: "malformed",
    });
    // explicit offsets DO open — the strictness is about ambiguity,
    // not about requiring Z specifically
    setEnv("ADMIN_LEGACY_KEY_UNTIL", "2999-01-01T00:00:00+05:00");
    expect(legacyWindowState().state).toBe("open");
  });

  it("ADMIN_API_KEY unset → shared-key path refuses (no legacy at all)", async () => {
    setEnv("ADMIN_API_KEY", undefined);
    setEnv("ADMIN_LEGACY_KEY_UNTIL", new Date(Date.now() + 3600_000).toISOString());
    const store = createMemoryOperatorStore();
    const app = makeApp(store);
    const res = await app.request("/admin/whoami", {
      headers: { "X-Admin-Key": LEGACY_KEY },
    });
    expect(res.status).toBe(401);
  });

  it("a credential row keyed to the shared key can never exist (store-HIT shadow path closed)", async () => {
    setEnv("ADMIN_LEGACY_KEY_UNTIL", undefined);
    setEnv("ADMIN_BREAK_GLASS_ENABLED", undefined);
    const store = createMemoryOperatorStore();
    const { operator } = await seedOperator(store);
    // seeding/issuing a credential whose hash IS sha256(ADMIN_API_KEY)
    // would let the shared key ride the store-hit path as a personal
    // identity — no break_glass marking, no deadline. Store refuses.
    const res = await store.issueCredential({
      id: id("opc"),
      operatorId: operator.id,
      keyHash: hashAdminKey(LEGACY_KEY),
      keyPrefix: "opk_shared00",
    });
    expect(res).toEqual({ ok: false, reason: "key_is_shared_secret" });
  });

  it("window state classifier — unset/past/future/malformed", () => {
    const now = new Date("2026-12-01T00:00:00.000Z");
    setEnv("ADMIN_LEGACY_KEY_UNTIL", undefined);
    expect(legacyWindowState(now)).toEqual({
      state: "closed",
      why: "unset",
    });
    setEnv("ADMIN_LEGACY_KEY_UNTIL", "");
    expect(legacyWindowState(now)).toEqual({
      state: "closed",
      why: "unset",
    });
    setEnv("ADMIN_LEGACY_KEY_UNTIL", "2026-11-01T00:00:00.000Z");
    expect(legacyWindowState(now)).toEqual({
      state: "closed",
      why: "past",
    });
    setEnv("ADMIN_LEGACY_KEY_UNTIL", "garbage");
    expect(legacyWindowState(now)).toEqual({
      state: "closed",
      why: "malformed",
    });
    setEnv("ADMIN_LEGACY_KEY_UNTIL", "2026-12-15T00:00:00.000Z");
    expect(legacyWindowState(now)).toEqual({
      state: "open",
      until: "2026-12-15T00:00:00.000Z",
    });
  });

  it("DoD integration: legacy key inside the window attributes legacy_admin/break_glass on a real surface", async () => {
    // The window's whole point: migrated surfaces keep working for
    // legacy callers, but every write is honestly attributed to the
    // break_glass principal — never a personal identity.
    setEnv("ADMIN_LEGACY_KEY_UNTIL", new Date(Date.now() + 3600_000).toISOString());
    setEnv("ADMIN_BREAK_GLASS_ENABLED", undefined);
    resetIdempotencyStore();
    const store = createMemoryKnowledgeStores();
    const operatorStore = createMemoryOperatorStore();
    const app = new Hono();
    app.route("/", createAdminKnowledgeRoutes({ store, operatorStore }));

    const res = await app.request("/admin/api/knowledge/items", {
      method: "POST",
      headers: {
        "x-admin-key": LEGACY_KEY,
        "content-type": "application/json",
        "idempotency-key": `leg-${Date.now()}`,
      },
      body: JSON.stringify({ kind: "FAQ", title: "t", body: "b" }),
    });
    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created.item.createdBy).toBe("legacy_admin");
    // …and the legacy caller still can't reach operator-admin
    // (capability boundary stands even inside the window).
  });

  it("wrong key in an open window still refuses — the window accepts the SHARED key only", async () => {
    setEnv("ADMIN_LEGACY_KEY_UNTIL", new Date(Date.now() + 3600_000).toISOString());
    setEnv("ADMIN_BREAK_GLASS_ENABLED", undefined);
    const store = createMemoryOperatorStore();
    const app = makeApp(store);
    const res = await app.request("/admin/whoami", {
      headers: { "X-Admin-Key": "not-the-shared-key" },
    });
    expect(res.status).toBe(401);
    // and a real opk_ still authenticates while the window is open
    const { key } = await seedOperator(store);
    const ok = await app.request("/admin/whoami", {
      headers: { "X-Admin-Key": key },
    });
    expect(ok.status).toBe(200);
  });
});
