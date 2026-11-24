import { describe, expect, it } from "vitest";
import { Hono } from "hono";

import {
  capabilityForSurface,
  getPrincipal,
  operatorAuth,
  operatorBrowserAuth,
  requireCapability,
} from "../../src/server/middleware/operatorAuth";
import {
  adminKeyPrefix,
  createMemoryOperatorStore,
  generateAdminKeyPlaintext,
  hashAdminKey,
  type OperatorStore,
} from "../../src/server/lib/operators";
import { generateReportId } from "../../src/agent-readiness/integrity/ulid";

/**
 * SLICE-264-2 contract test — operatorAuth credential → principal.
 *
 * The battery runs against the memory backend. PG parity is
 * structural, not re-asserted here: the middleware carries zero
 * backend branches — every verdict comes through the same
 * OperatorStore contract whose memory impl is proven
 * row-equivalent against docker PG by
 * packages/database/tests/admin-operators.test.ts (and the
 * server-side domain ops are a single shared impl). dev ≠
 * trust-all is therefore guaranteed at the store layer, not by
 * a middleware mode switch that could drift.
 *
 * D-264-Q19 auth-negative battery: missing / unknown / wrong /
 * prefix-colliding / revoked / disabled-operator keys all refuse
 * with the SAME 401 envelope; capability refusal is a typed 403
 * (C7 — capability read from the credential record only).
 */

const id = (p: string) => `${p}_${generateReportId()}`;

async function seedOperator(
  store: OperatorStore,
  capabilities: string[] = ["read", "workflow"],
  type = "human",
) {
  const op = await store.createOperator({
    id: id("op"),
    displayName: "Tester",
    principalType: type,
    capabilities,
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
  return { operator: op.operator, credential: cred.credential, key };
}

function makeApp(store: OperatorStore): Hono {
  const app = new Hono();
  app.use("/admin/*", operatorAuth(store));
  // principal + full record land in context for audit/capability use
  app.get("/admin/whoami", (c) => c.json(getPrincipal(c) ?? null));
  app.get("/admin/read-thing", (c) => {
    const deny = requireCapability(c, "read");
    return deny ?? c.json({ ok: true });
  });
  app.post("/admin/write-thing", (c) => {
    const deny = requireCapability(c, "workflow");
    return deny ?? c.json({ ok: true });
  });
  app.post("/admin/manage-operators", (c) => {
    const deny = requireCapability(c, "operator-admin");
    return deny ?? c.json({ ok: true });
  });
  return app;
}

const basic = (key: string) =>
  `Basic ${Buffer.from(`anyone:${key}`).toString("base64")}`;

describe("operatorAuth — credential → principal (memory backend)", () => {
  it("all three transports resolve to the same principal", async () => {
    const store = createMemoryOperatorStore();
    const { operator, key } = await seedOperator(store);
    const app = makeApp(store);
    const transports: Record<string, string>[] = [
      { "X-Admin-Key": key },
      { Authorization: `Bearer ${key}` },
      { Authorization: basic(key) },
    ];
    for (const headers of transports) {
      const res = await app.request("/admin/whoami", { headers });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({
        id: operator.id,
        principalType: "human",
        keyPrefix: adminKeyPrefix(key),
      });
    }
  });

  it("auth-negatives refuse with the IDENTICAL 401 envelope", async () => {
    const store = createMemoryOperatorStore();
    const { operator, credential, key } = await seedOperator(store);
    await seedOperator(store); // second human — C5 guard must not engage
    const app = makeApp(store);

    const cases: [string, Record<string, string>][] = [
      ["missing", {}],
      ["unknown key", { "X-Admin-Key": generateAdminKeyPlaintext() }],
      ["wrong shape", { "X-Admin-Key": "not-a-key" }],
      ["empty header", { "X-Admin-Key": "" }],
      ["bearer of unknown key", { Authorization: `Bearer ${generateAdminKeyPlaintext()}` }],
      ["basic wrong password", { Authorization: basic(generateAdminKeyPlaintext()) }],
    ];
    // prefix collision: same opk_<8> identification chars, different
    // secret — proves the compare is hash-only, no prefix early-exit
    const colliding =
      adminKeyPrefix(key) +
      generateAdminKeyPlaintext().slice(adminKeyPrefix(key).length);
    expect(colliding).not.toBe(key);
    cases.push(["prefix-colliding key", { "X-Admin-Key": colliding }]);

    const bodies: unknown[] = [];
    for (const [label, headers] of cases) {
      const res = await app.request("/admin/read-thing", { headers });
      expect(res.status, label).toBe(401);
      bodies.push(await res.json());
    }
    for (const body of bodies) {
      expect(body).toEqual({
        error: "Unauthorized",
        code: "UNAUTHORIZED",
      });
    }

    // revoked credential → identical refusal
    await store.revokeCredential(credential.id);
    const res = await app.request("/admin/read-thing", {
      headers: { "X-Admin-Key": key },
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: "Unauthorized",
      code: "UNAUTHORIZED",
    });

    // fresh credential on a now-DISABLED operator → identical refusal
    const seed = await seedOperator(store);
    await store.disableOperator(seed.operator.id);
    const res2 = await app.request("/admin/read-thing", {
      headers: { "X-Admin-Key": seed.key },
    });
    expect(res2.status).toBe(401);
    expect(await res2.json()).toEqual({
      error: "Unauthorized",
      code: "UNAUTHORIZED",
    });
    expect(operator.id).toMatch(/^op_/);
  });

  it("requireCapability — missing capability is typed 403, not 401", async () => {
    const store = createMemoryOperatorStore();
    // read-only operator
    const { key } = await seedOperator(store, ["read"]);
    const app = makeApp(store);
    const headers = { "X-Admin-Key": key };

    expect((await app.request("/admin/read-thing", { headers })).status).toBe(200);

    const write = await app.request("/admin/write-thing", {
      method: "POST",
      headers,
    });
    expect(write.status).toBe(403);
    expect(await write.json()).toEqual({
      error: "Missing capability: workflow",
      code: "INSUFFICIENT_CAPABILITY",
    });

    const manage = await app.request("/admin/manage-operators", {
      method: "POST",
      headers,
    });
    expect(manage.status).toBe(403);
    expect((await manage.json()).code).toBe("INSUFFICIENT_CAPABILITY");

    // a workflow-capable operator passes the same route
    const full = await seedOperator(store);
    expect(
      (
        await app.request("/admin/write-thing", {
          method: "POST",
          headers: { "X-Admin-Key": full.key },
        })
      ).status,
    ).toBe(200);
  });

  it("lastUsedAt — throttled best-effort touch, fire-and-forget", async () => {
    const store = createMemoryOperatorStore();
    const { credential, key } = await seedOperator(store);
    const app = makeApp(store);
    const headers = { "X-Admin-Key": key };
    const tick = () => new Promise((r) => setImmediate(r));

    // null → first request touches
    expect(credential.lastUsedAt).toBeNull();
    await app.request("/admin/whoami", { headers });
    await tick();
    const after1 = (await store.getOperatorByKeyHash(hashAdminKey(key)))!
      .credential.lastUsedAt;
    expect(after1).not.toBeNull();

    // inside the 5-min window → no second write
    await app.request("/admin/whoami", { headers });
    await tick();
    const after2 = (await store.getOperatorByKeyHash(hashAdminKey(key)))!
      .credential.lastUsedAt;
    expect(after2).toBe(after1);
  });

  it("x-operator-id presence is a typed 400 — it dies at the boundary (D-264-Q16)", async () => {
    const store = createMemoryOperatorStore();
    const { key } = await seedOperator(store);
    const app = makeApp(store);
    // valid credential + self-asserted header → 400, not silent ignore
    const res = await app.request("/admin/whoami", {
      headers: { "X-Admin-Key": key, "X-Operator-Id": "mallory" },
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error:
        "x-operator-id is not accepted — identity comes from the credential",
      code: "OPERATOR_HEADER_REJECTED",
    });
    // even anonymous + header → still 400 (rule is presence, not auth state)
    const anon = await app.request("/admin/whoami", {
      headers: { "X-Operator-Id": "mallory" },
    });
    expect(anon.status).toBe(400);
  });

  it("store failure is a typed 500, never a folded 401", async () => {
    const broken = {
      getOperatorByKeyHash: () => {
        throw new Error("pg down");
      },
    } as unknown as OperatorStore;
    const app = new Hono();
    app.use("/admin/*", operatorAuth(broken));
    app.get("/admin/whoami", (c) => c.json(getPrincipal(c) ?? null));
    const res = await app.request("/admin/whoami", {
      headers: { "X-Admin-Key": generateAdminKeyPlaintext() },
    });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: "Operator store unavailable",
      code: "INTERNAL_ERROR",
    });
  });

  it("no resolved operator → requireCapability answers 401, not 403", async () => {
    const app = new Hono();
    app.get("/open", (c) => {
      const deny = requireCapability(c, "read");
      return deny ?? c.json({ ok: true });
    });
    const res = await app.request("/open");
    expect(res.status).toBe(401);
  });

  it("operatorBrowserAuth adds WWW-Authenticate on 401 only", async () => {
    const store = createMemoryOperatorStore();
    const { key } = await seedOperator(store);
    const app = new Hono();
    app.use("/admin/*", operatorBrowserAuth(store));
    app.get("/admin/page", (c) => c.text("secret"));

    const denied = await app.request("/admin/page");
    expect(denied.status).toBe(401);
    // distinct realm ("operators") — creds must not transpose across
    // the old "admin" surface in the browser cache
    expect(denied.headers.get("WWW-Authenticate")).toBe(
      'Basic realm="operators"',
    );

    const allowed = await app.request("/admin/page", {
      headers: { Authorization: basic(key) },
    });
    expect(allowed.status).toBe(200);
    expect(await allowed.text()).toBe("secret");
  });
});

describe("CAPABILITY_BY_SURFACE — O-264-8 mapping", () => {
  it("classifies by prefix override, then method fallback", () => {
    // operator-admin prefixes win over any verb
    expect(capabilityForSurface("/admin/api/operators", "GET")).toBe(
      "operator-admin",
    );
    expect(
      capabilityForSurface("/admin/operators/new", "POST"),
    ).toBe("operator-admin");
    // segment boundary — /admin/operatorsX is NOT an operators surface
    expect(capabilityForSurface("/admin/operatorsX", "GET")).toBe("read");
    // unmapped surfaces: read-only verbs → read, mutations → workflow
    expect(capabilityForSurface("/admin/api/knowledge/gaps", "GET")).toBe(
      "read",
    );
    expect(capabilityForSurface("/admin/finance/refunds", "HEAD")).toBe(
      "read",
    );
    expect(
      capabilityForSurface("/admin/api/knowledge/gaps", "POST"),
    ).toBe("workflow");
    expect(capabilityForSurface("/admin/rebuild-cache", "POST")).toBe(
      "workflow",
    );
  });
});
