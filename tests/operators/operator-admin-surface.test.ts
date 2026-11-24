import { beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";

import { createAdminOperatorsApi } from "../../src/server/routes/admin-operators-api";
import { createAdminOperatorsUi } from "../../src/server/routes/admin-operators-ui";
import {
  adminKeyPrefix,
  applyOperatorSeed,
  createMemoryOperatorStore,
  generateAdminKeyPlaintext,
  hashAdminKey,
  type OperatorStore,
} from "../../src/server/lib/operators";
import { generateReportId } from "../../src/agent-readiness/integrity/ulid";
import { resetIdempotencyStore } from "../../src/server/lib/contract-guards";

/**
 * SLICE-264-4 contract test — operator admin surfaces.
 *
 * Memory backend only (operator-auth.test.ts precedent): the routes
 * carry zero backend branches — every verdict flows through the
 * OperatorStore contract proven row-equivalent on docker PG by the
 * package suite.
 *
 * DoD legs covered:
 *  - full cycle: create → issue → new key authenticates, old doesn't
 *  - C5: disable/revoke of the last access-bearing human → typed
 *    refusal on JSON (409 last_operator) AND UI (err flash)
 *  - plaintext hygiene: minted key appears once (JSON issue body /
 *    owner-bound reveal render), never in list JSON, keyHash fields,
 *    or a second page render
 *  - idempotency: replayed JSON write → stored duplicate response;
 *    replayed form token → honest flash
 */

const basic = (key: string) =>
  `Basic ${Buffer.from(`anyone:${key}`).toString("base64")}`;
const idem = () => ({ "idempotency-key": `k_${generateReportId()}` });

async function seedAdmin(store: OperatorStore) {
  const key = generateAdminKeyPlaintext();
  const r = await applyOperatorSeed(store, {
    displayName: "root-admin",
    key,
  });
  if (!r.ok || !r.seeded) throw new Error(`seed failed: ${JSON.stringify(r)}`);
  return { key, operatorId: r.operatorId };
}

function makeApp(store: OperatorStore): Hono {
  const app = new Hono();
  app.route("/", createAdminOperatorsApi(store));
  app.route("/", createAdminOperatorsUi(store));
  return app;
}

const postJson = (
  app: Hono,
  path: string,
  key: string,
  body: unknown = {},
) =>
  app.request(path, {
    method: "POST",
    headers: {
      "X-Admin-Key": key,
      "Content-Type": "application/json",
      ...idem(),
    },
    body: JSON.stringify(body),
  });

/** Render the console once and lift a fresh single-use formToken. */
async function mintToken(app: Hono, key: string): Promise<string> {
  const res = await app.request("/admin/operators", {
    headers: { Authorization: basic(key) },
  });
  expect(res.status).toBe(200);
  const m = /name="formToken" value="(ft_[^"]+)"/.exec(await res.text());
  if (!m) throw new Error("no formToken in console HTML");
  return m[1];
}

const postForm = (
  app: Hono,
  path: string,
  key: string,
  fields: Record<string, string>,
) =>
  app.request(path, {
    method: "POST",
    headers: {
      Authorization: basic(key),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(fields).toString(),
  });

beforeEach(() => resetIdempotencyStore());

describe("operator admin — JSON API", () => {
  it("full cycle: create → issue → new key authenticates; revoke kills it", async () => {
    const store = createMemoryOperatorStore();
    const { key: rootKey } = await seedAdmin(store);
    const app = makeApp(store);

    // create
    const created = await postJson(app, "/admin/api/operators", rootKey, {
      displayName: "alice",
      principalType: "human",
      capabilities: ["read", "operator-admin"],
    });
    expect(created.status).toBe(200);
    const { operator } = await created.json();
    expect(operator.id).toMatch(/^op_/);
    expect(operator.displayName).toBe("alice");
    expect(operator.credentials).toBeUndefined(); // none issued yet

    // issue → plaintext ONCE
    const issued = await postJson(
      app, `/admin/api/operators/${operator.id}/credentials`, rootKey,
    );
    expect(issued.status).toBe(200);
    const { key: aliceKey, credential } = await issued.json();
    expect(aliceKey).toMatch(/^opk_/);
    expect(credential.keyPrefix).toBe(adminKeyPrefix(aliceKey));
    expect(credential).not.toHaveProperty("keyHash");

    // new key logs in — alice holds operator-admin
    const list = await app.request("/admin/api/operators", {
      headers: { Authorization: basic(aliceKey) },
    });
    expect(list.status).toBe(200);
    const { operators } = await list.json();
    const raw = JSON.stringify(operators);
    // plaintext hygiene: list meta never carries keyHash or the key
    expect(raw).not.toContain(aliceKey);
    expect(raw).not.toContain(hashAdminKey(aliceKey));
    expect(raw).toContain(adminKeyPrefix(aliceKey).slice(0, 8));

    // revoke (root still exists → alice isn't the last bearer)
    const revoked = await postJson(
      app,
      `/admin/api/operators/${operator.id}/credentials/${credential.id}/revoke`,
      rootKey,
    );
    expect(revoked.status).toBe(200);
    const dead = await app.request("/admin/api/operators", {
      headers: { Authorization: basic(aliceKey) },
    });
    expect(dead.status).toBe(401);
  });

  it("rotate returns the new key once; the old key dies", async () => {
    const store = createMemoryOperatorStore();
    const { key: rootKey } = await seedAdmin(store);
    const app = makeApp(store);
    const op = (await store.listOperators())[0];
    const cred = (await store.listCredentialsForOperator(op.id))[0];

    const r = await postJson(
      app,
      `/admin/api/operators/${op.id}/credentials/${cred.id}/rotate`,
      rootKey,
    );
    expect(r.status).toBe(200);
    const { key: newKey, credential, revoked } = await r.json();
    expect(newKey).not.toBe(rootKey);
    expect(revoked.status).toBe("revoked");
    // old key dead, new key alive
    expect(
      (await app.request("/admin/api/operators", {
        headers: { "X-Admin-Key": rootKey },
      })).status,
    ).toBe(401);
    expect(
      (await app.request("/admin/api/operators", {
        headers: { "X-Admin-Key": newKey },
      })).status,
    ).toBe(200);
    expect(credential.operatorId ?? op.id).toBe(op.id);
  });

  it("C5: disabling/revoking the LAST access-bearing human → typed 409", async () => {
    const store = createMemoryOperatorStore();
    const { key: rootKey, operatorId } = await seedAdmin(store);
    const app = makeApp(store);
    const cred = (await store.listCredentialsForOperator(operatorId))[0];

    // sole bearer — both refuse honestly
    const dis = await postJson(
      app, `/admin/api/operators/${operatorId}/disable`, rootKey,
    );
    expect(dis.status).toBe(409);
    expect((await dis.json()).error.code).toBe("last_operator");

    const rev = await postJson(
      app,
      `/admin/api/operators/${operatorId}/credentials/${cred.id}/revoke`,
      rootKey,
    );
    expect(rev.status).toBe(409);
    expect((await rev.json()).error.code).toBe("last_operator");

    // a cred-LESS second human does not free the guard (access ≠ rows)
    await postJson(app, "/admin/api/operators", rootKey, {
      displayName: "empty-shell", principalType: "human",
    });
    expect(
      (await postJson(
        app, `/admin/api/operators/${operatorId}/disable`, rootKey,
      )).status,
    ).toBe(409);
  });

  it("capability gate: read-only cred gets 403, anon gets byte-identical 401", async () => {
    const store = createMemoryOperatorStore();
    const { key: rootKey } = await seedAdmin(store);
    const app = makeApp(store);
    // service cred with read only
    const svc = await store.createOperator({
      id: `op_${generateReportId()}`, displayName: "reader-a",
      principalType: "service", capabilities: ["read"],
    });
    if (!svc.ok) throw new Error("seed");
    const svcKey = generateAdminKeyPlaintext();
    await store.issueCredential({
      id: `opc_${generateReportId()}`, operatorId: svc.operator.id,
      keyHash: hashAdminKey(svcKey), keyPrefix: adminKeyPrefix(svcKey),
    });

    const denied = await app.request("/admin/api/operators", {
      headers: { "X-Admin-Key": svcKey },
    });
    expect(denied.status).toBe(403);
    expect((await denied.json()).code).toBe("INSUFFICIENT_CAPABILITY");

    const anon = await app.request("/admin/api/operators");
    expect(anon.status).toBe(401);
    expect(await anon.json()).toEqual({
      error: "Unauthorized", code: "UNAUTHORIZED",
    });

    // idempotency replay: same key + same body → stored response
    const body = { displayName: "replay-me", principalType: "service" };
    const headers = {
      "X-Admin-Key": rootKey,
      "Content-Type": "application/json",
      "idempotency-key": `k_replay_${generateReportId()}`,
    };
    const first = await app.request("/admin/api/operators", {
      method: "POST", headers, body: JSON.stringify(body),
    });
    const second = await app.request("/admin/api/operators", {
      method: "POST", headers, body: JSON.stringify(body),
    });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const b2 = await second.json();
    expect(b2.duplicate).toBe(true);
    expect(
      (await store.listOperators()).filter(
        (o) => o.displayName === "replay-me",
      ).length,
    ).toBe(1);
    // same key + different body → honest 409
    const conflict = await app.request("/admin/api/operators", {
      method: "POST", headers,
      body: JSON.stringify({ ...body, displayName: "other-name" }),
    });
    expect(conflict.status).toBe(409);
  });
});

describe("operator admin — SSR console", () => {
  it("issue → ?reveal shows the key ONCE (owner-bound), then never again", async () => {
    const store = createMemoryOperatorStore();
    const { key: rootKey } = await seedAdmin(store);
    const app = makeApp(store);

    // create a second operator via the form
    const token = await mintToken(app, rootKey);
    const created = await postForm(app, "/admin/operators/create", rootKey, {
      formToken: token,
      displayName: "bob",
      principalType: "human",
      cap_read: "on",
      "cap_operator-admin": "on",
    });
    expect(created.status).toBe(303);
    const bob = (await store.listOperators()).find(
      (o) => o.displayName === "bob",
    )!;

    // replayed form → spent token, domain never runs twice
    const replay = await postForm(app, "/admin/operators/create", rootKey, {
      formToken: token,
      displayName: "bob2",
      principalType: "human",
    });
    expect(replay.status).toBe(303);
    expect(replay.headers.get("location")).toContain(
      "err=form_expired_or_duplicate",
    );
    expect(
      (await store.listOperators()).filter((o) => o.displayName === "bob2"),
    ).toHaveLength(0);

    // issue via the form → 303 ?reveal=<opaque>
    const t2 = await mintToken(app, rootKey);
    const issued = await postForm(
      app, `/admin/operators/${bob.id}/credentials`, rootKey,
      { formToken: t2 },
    );
    expect(issued.status).toBe(303);
    const loc = issued.headers.get("location")!;
    expect(loc).toMatch(/reveal=kr_/);
    // the URL carries a TOKEN, not the key
    expect(loc).not.toContain("opk_");

    // first render → plaintext visible exactly once
    const page1 = await app.request(loc, {
      headers: { Authorization: basic(rootKey) },
    });
    const html1 = await page1.text();
    const keyInHtml = html1.match(/opk_[A-Za-z0-9_-]{20,}/)?.[0];
    expect(keyInHtml).toBeTruthy();

    // second render of the SAME url → slot consumed, key gone
    const page2 = await app.request(loc, {
      headers: { Authorization: basic(rootKey) },
    });
    expect(await page2.text()).not.toContain(keyInHtml!);

    // bob's fresh key authenticates on the console itself
    expect(
      (await app.request("/admin/operators", {
        headers: { Authorization: basic(keyInHtml!) },
      })).status,
    ).toBe(200);
  });

  it("C5 surfaces as an err flash; disable/enable round-trips", async () => {
    const store = createMemoryOperatorStore();
    const { key: rootKey, operatorId } = await seedAdmin(store);
    const app = makeApp(store);

    // root is the sole bearer — disable refused honestly
    const t = await mintToken(app, rootKey);
    const refused = await postForm(
      app, `/admin/operators/${operatorId}/disable`, rootKey,
      { formToken: t },
    );
    expect(refused.status).toBe(303);
    expect(refused.headers.get("location")).toContain("err=last_operator");

    // seed a second bearer (WITH operator-admin — it must drive the
    // console after root is disabled), then disable round-trips
    await postJson(app, "/admin/api/operators", rootKey, {
      displayName: "second", principalType: "human",
      capabilities: ["read", "operator-admin"],
    });
    const second = (await store.listOperators()).find(
      (o) => o.displayName === "second",
    )!;
    const issue2 = await postJson(
      app, `/admin/api/operators/${second.id}/credentials`, rootKey,
    );
    const { key: secondKey } = await issue2.json();
    const t2 = await mintToken(app, rootKey);
    const dis = await postForm(
      app, `/admin/operators/${operatorId}/disable`, rootKey,
      { formToken: t2 },
    );
    expect(dis.headers.get("location")).toContain(`ok=disabled_${operatorId}`);
    // root's key is dead now — SECOND drives the re-enable
    expect(
      (await app.request("/admin/operators", {
        headers: { Authorization: basic(rootKey) },
      })).status,
    ).toBe(401);

    const t3 = await mintToken(app, secondKey);
    const en = await postForm(
      app, `/admin/operators/${operatorId}/enable`, secondKey,
      { formToken: t3 },
    );
    expect(en.headers.get("location")).toContain("ok=");
    expect((await store.getOperator(operatorId))!.status).toBe("active");
  });

  it("browser boundary: anon → 401 + challenge; service w/o cap → 403", async () => {
    const store = createMemoryOperatorStore();
    const { key: rootKey } = await seedAdmin(store);
    const app = makeApp(store);

    const anon = await app.request("/admin/operators");
    expect(anon.status).toBe(401);
    expect(anon.headers.get("WWW-Authenticate")).toContain("Basic");

    const svc = await store.createOperator({
      id: `op_${generateReportId()}`, displayName: "reader-b",
      principalType: "service", capabilities: ["read"],
    });
    if (!svc.ok) throw new Error("seed");
    const svcKey = generateAdminKeyPlaintext();
    await store.issueCredential({
      id: `opc_${generateReportId()}`, operatorId: svc.operator.id,
      keyHash: hashAdminKey(svcKey), keyPrefix: adminKeyPrefix(svcKey),
    });
    expect(
      (await app.request("/admin/operators", {
        headers: { "X-Admin-Key": svcKey },
      })).status,
    ).toBe(403);

    // console renders with the seeded operator listed
    const page = await app.request("/admin/operators", {
      headers: { Authorization: basic(rootKey) },
    });
    const html = await page.text();
    expect(html).toContain("root-admin");
    expect(html).toContain("op_");
    expect(html).not.toContain(rootKey); // plaintext never in a render
  });
});
