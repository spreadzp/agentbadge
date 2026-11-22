import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Hono } from "hono";

import {
  addEvidence,
  createKnowledgeItem,
  createMemoryKnowledgeStores,
  recordGap,
  transitionKnowledgeItem,
} from "../src/server/lib/knowledge";
import { createAdminKnowledgeUi } from "../src/server/routes/admin-knowledge-ui";

/**
 * SLICE-229-9 DoD — operator SSR console:
 * - items list renders, status filter works
 * - detail page renders only LEGAL transition buttons per status
 * - publish flow end-to-end through UI POSTs (draft→pending→verified
 *   →published), statuses visible in pages
 * - gaps screen lists gaps + resolve-with-link works via form posts
 * - XSS: operator/agent-supplied text is escaped in pages
 * - 401 without credentials; cross-origin POST refused (B-3)
 */

const KEY = "test-admin-key";
const AUTH = `Basic ${Buffer.from(`x:${KEY}`).toString("base64")}`;
const OP = "ops_test";

function mkApp() {
  const store = createMemoryKnowledgeStores();
  const app = new Hono();
  app.route("/", createAdminKnowledgeUi(store));
  return { app, store };
}

const get = (app: Hono, path: string) =>
  app.request(path, { headers: { authorization: AUTH } });

const post = (app: Hono, path: string, body: Record<string, string>) =>
  app.request(path, {
    method: "POST",
    headers: {
      authorization: AUTH,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body).toString(),
  });

beforeAll(() => {
  process.env.ADMIN_API_KEY = KEY;
});
afterAll(() => {
  delete process.env.ADMIN_API_KEY;
});

describe("admin knowledge UI (SLICE-229-9)", () => {
  it("401 without credentials; cross-origin POST refused", async () => {
    const { app } = mkApp();
    expect((await app.request("/admin/knowledge")).status).toBe(401);
    const xpost = await app.request("/admin/knowledge/create", {
      method: "POST",
      headers: {
        authorization: AUTH,
        origin: "https://evil.example",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: "title=x&body=y&kind=GUIDE",
    });
    expect(xpost.status).toBe(403);
  });

  it("create → publish flow via UI; only legal buttons render", async () => {
    const { app } = mkApp();
    const create = await post(app, "/admin/knowledge/create", {
      title: "UI flow doc",
      body: "ui flow body",
      kind: "GUIDE",
      slug: "ui-flow",
    });
    expect(create.status).toBe(303);
    const loc = create.headers.get("location") ?? "";
    const id = loc.split("/admin/knowledge/")[1]?.split("?")[0] ?? "";
    expect(id).toMatch(/^ki_/);

    // DRAFT detail: submit+withdraw buttons, NO publish/verify.
    let page = await (await get(app, loc.split("?")[0]!)).text();
    expect(page).toContain("Submit for review");
    expect(page).toContain("Withdraw");
    expect(page).not.toContain("Publish");
    expect(page).not.toContain("Verify");

    const sub = await post(app, `/admin/knowledge/${id}/transition`, {
      to: "PENDING",
      operator: "ui-op",
    });
    expect(sub.status).toBe(303);
    page = await (await get(app, `/admin/knowledge/${id}`)).text();
    expect(page).toContain("Verify");

    // Arc R1 H4: verify refuses without evidence — attach via the
    // console form (editable while PENDING), then verify as a
    // DIFFERENT operator (separation of duties).
    const ev = await post(app, `/admin/knowledge/${id}/evidence/add`, {
      type: "INTERNAL_DOC",
      uri: "internal://runbook/ui-flow",
      operator: "ui-op",
    });
    expect(ev.status).toBe(303);
    const ver = await post(app, `/admin/knowledge/${id}/transition`, {
      to: "VERIFIED",
      operator: "ui-review",
    });
    expect(ver.status).toBe(303);
    page = await (await get(app, `/admin/knowledge/${id}`)).text();
    expect(page).toContain("Publish");

    const pub = await post(app, `/admin/knowledge/${id}/transition`, {
      to: "PUBLISHED",
      operator: "ui-op",
    });
    expect(pub.status).toBe(303);
    page = await (await get(app, `/admin/knowledge/${id}`)).text();
    expect(page).toContain(">PUBLISHED<");
    // PUBLISHED → only Withdraw remains.
    expect(page).toContain("Withdraw");
    expect(page).not.toContain("Submit for review");

    // List page shows the item under PUBLISHED filter.
    const list = await (
      await get(app, "/admin/knowledge?status=PUBLISHED")
    ).text();
    expect(list).toContain("ui-flow");
    expect(list).toContain("UI flow doc");
  });

  it("illegal transition via UI → flash error, status unchanged", async () => {
    const { app, store } = mkApp();
    const c = await createKnowledgeItem(
      store, { kind: "GUIDE", slug: "bad-trans", title: "t", body: "b" }, OP,
    );
    if (!c.ok) throw new Error("create failed");
    const r = await post(
      app,
      `/admin/knowledge/${c.item.id}/transition`,
      { to: "PUBLISHED" }, // DRAFT→PUBLISHED illegal
    );
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toContain("err=");
    const item = await store.getItem(c.item.id);
    expect(item?.status).toBe("DRAFT");
  });

  it("gaps screen: gap listed, triage + resolve-with-link via posts", async () => {
    const { app, store } = mkApp();
    const g = await recordGap(store, {
      query: "what is the fee schedule", source: "COMPOSER_REFUSAL",
    });
    if (!g.ok) throw new Error("gap failed");
    const c = await createKnowledgeItem(
      store, { kind: "FAQ", slug: "fee-schedule", title: "t", body: "b" }, OP,
    );
    if (!c.ok) throw new Error("create failed");
    // Arc R1 M7: RESOLVED requires the linked item PUBLISHED.
    await addEvidence(store, c.version.id, {
      type: "INTERNAL_DOC", uri: "internal://runbook/fee", addedBy: OP,
    });
    for (const [to, actor] of [
      ["PENDING", OP], ["VERIFIED", "ops_review"], ["PUBLISHED", OP],
    ] as const) {
      await transitionKnowledgeItem(store, c.item.id, to, actor);
    }

    let page = await (await get(app, "/admin/knowledge/gaps")).text();
    expect(page).toContain("what is the fee schedule");
    expect(page).toContain("triage");

    await post(app, `/admin/knowledge/gaps/${g.gap.id}/triage`, {});
    page = await (await get(app, "/admin/knowledge/gaps?status=TRIAGED")).text();
    expect(page).toContain("resolve");

    const r = await post(app, `/admin/knowledge/gaps/${g.gap.id}/resolve`, {
      linkedItemId: c.item.id,
    });
    expect(r.status).toBe(303);
    const gap = await store.getGap(g.gap.id);
    expect(gap?.status).toBe("RESOLVED");
    expect(gap?.linkedItemId).toBe(c.item.id);
  });

  it("XSS: injected markup in title is escaped in list+detail", async () => {
    const { app, store } = mkApp();
    const evil = `<img src=x onerror=alert(1)>`;
    const c = await createKnowledgeItem(
      store, { kind: "GUIDE", slug: "xss-item", title: evil, body: "b" }, OP,
    );
    if (!c.ok) throw new Error("create failed");
    for (const path of ["/admin/knowledge", `/admin/knowledge/${c.item.id}`]) {
      const page = await (await get(app, path)).text();
      expect(page).not.toContain(evil);
      expect(page).toContain("&lt;img");
    }
  });
});
