import { describe, expect, it } from "vitest";
import { Hono } from "hono";

import {
  addEvidence,
  createKnowledgeItem,
  createMemoryKnowledgeStores,
  recordGap,
} from "../src/server/lib/knowledge";
import { createAdminKnowledgeUi } from "../src/server/routes/admin-knowledge-ui";
import { approveTransition } from "./helpers/knowledge";
import {
  createMemoryOperatorStore,
  seedOperator,
} from "./helpers/operators";

/**
 * SLICE-229-9 DoD — operator SSR console (SLICE-264-6 auth model):
 * - items list renders, status filter works
 * - detail page renders only LEGAL transition buttons per status
 * - publish flow end-to-end through UI POSTs (draft→pending→verified
 *   →published) — SoD enforced by real credentials: submit/verify
 *   must ride DIFFERENT operator keys, not different self-asserted
 *   "operator" form fields
 * - gaps screen lists gaps + resolve-with-link works via form posts
 * - XSS: operator/agent-supplied text is escaped in pages
 * - 401 without credentials; cross-origin POST refused (B-3)
 */

const basic = (key: string) =>
  `Basic ${Buffer.from(`x:${key}`).toString("base64")}`;
const OP = "ops_test";

async function mkApp() {
  const store = createMemoryKnowledgeStores();
  const operatorStore = createMemoryOperatorStore();
  const alice = await seedOperator(operatorStore, "Alice");
  const bob = await seedOperator(operatorStore, "Bob");
  const app = new Hono();
  app.route("/", createAdminKnowledgeUi(store, operatorStore));
  return { app, store, alice, bob, A: basic(alice.key), B: basic(bob.key) };
}

const get = (app: Hono, AUTH: string, path: string) =>
  app.request(path, { headers: { authorization: AUTH } });

const post = (
  app: Hono,
  AUTH: string,
  path: string,
  body: Record<string, string>,
) =>
  app.request(path, {
    method: "POST",
    headers: {
      authorization: AUTH,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body).toString(),
  });

/** Arc R2 H-1 + R3: mutation posts need the render-minted hidden
 *  fields — token AND stale-page preconditions — exactly like a real
 *  browser submit. Lift every hidden input from the form whose action
 *  matches postPath (disambiguated by `to` when several share it). */
const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const hiddenFields = (formHtml: string) => {
  const out: Record<string, string> = {};
  for (const m of formHtml.matchAll(/<input\b[^>]*>/g)) {
    const tag = m[0];
    if (!/type="hidden"/.test(tag)) continue;
    const name = /name="([^"]+)"/.exec(tag)?.[1];
    const value = /value="([^"]*)"/.exec(tag)?.[1] ?? "";
    if (name) out[name] = value;
  }
  return out;
};
const postForm = async (
  app: Hono,
  AUTH: string,
  pagePath: string,
  postPath: string,
  body: Record<string, string>,
) => {
  const html = await (await get(app, AUTH, pagePath)).text();
  const forms = [
    ...html.matchAll(
      new RegExp(
        `<form\\b[^>]*action="${escRe(postPath)}"[^>]*>([\\s\\S]*?)</form>`,
        "g",
      ),
    ),
  ].map((m) => m[1]!);
  let form = forms[0];
  if (forms.length > 1 && body.to !== undefined) {
    form = forms.find((f) => f.includes(`value="${body.to}"`)) ?? forms[0];
  }
  if (!form) throw new Error(`no form posting to ${postPath} on ${pagePath}`);
  return post(app, AUTH, postPath, { ...hiddenFields(form), ...body });
};

describe("admin knowledge UI (SLICE-229-9)", () => {
  it("401 without credentials; cross-origin POST refused", async () => {
    const { app, A } = await mkApp();
    expect((await app.request("/admin/knowledge")).status).toBe(401);
    const xpost = await app.request("/admin/knowledge/create", {
      method: "POST",
      headers: {
        authorization: A,
        origin: "https://evil.example",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: "title=x&body=y&kind=GUIDE",
    });
    expect(xpost.status).toBe(403);
  });

  it("create → publish flow via UI; only legal buttons render", async () => {
    const { app, A, B } = await mkApp();
    const create = await postForm(
      app, A, "/admin/knowledge", "/admin/knowledge/create", {
        title: "UI flow doc",
        body: "ui flow body",
        kind: "GUIDE",
        slug: "ui-flow",
      },
    );
    expect(create.status).toBe(303);
    const loc = create.headers.get("location") ?? "";
    const id = loc.split("/admin/knowledge/")[1]?.split("?")[0] ?? "";
    expect(id).toMatch(/^ki_/);

    // DRAFT detail: submit+withdraw buttons, NO publish/verify.
    let page = await (await get(app, A, loc.split("?")[0]!)).text();
    expect(page).toContain("Submit for review");
    expect(page).toContain("Withdraw");
    expect(page).not.toContain("Publish");
    expect(page).not.toContain("Verify");

    // Arc R2 H-2: evidence is editable in DRAFT only — the set the
    // submitter declares freezes when the item enters PENDING, so a
    // verifier always reviews exactly what was submitted.
    const ev = await postForm(
      app, A, `/admin/knowledge/${id}`, `/admin/knowledge/${id}/evidence/add`, {
        type: "INTERNAL_DOC",
        uri: "internal://runbook/ui-flow",
      },
    );
    expect(ev.status).toBe(303);

    const sub = await postForm(
      app, A, `/admin/knowledge/${id}`, `/admin/knowledge/${id}/transition`, {
        to: "PENDING",
      },
    );
    expect(sub.status).toBe(303);
    page = await (await get(app, A, `/admin/knowledge/${id}`)).text();
    expect(page).toContain("Verify");
    // PENDING detail must NOT offer the evidence form any more.
    expect(page).not.toContain("evidence/add");
    // SoD is real now: verify rides a DIFFERENT credential than
    // the submitter's — self-asserted "operator" fields are gone.
    const ver = await postForm(
      app, B, `/admin/knowledge/${id}`, `/admin/knowledge/${id}/transition`, {
        to: "VERIFIED",
      },
    );
    expect(ver.status).toBe(303);
    page = await (await get(app, A, `/admin/knowledge/${id}`)).text();
    expect(page).toContain("Publish");

    const pub = await postForm(
      app, A, `/admin/knowledge/${id}`, `/admin/knowledge/${id}/transition`, {
        to: "PUBLISHED",
      },
    );
    expect(pub.status).toBe(303);
    page = await (await get(app, A, `/admin/knowledge/${id}`)).text();
    expect(page).toContain(">PUBLISHED<");
    // PUBLISHED → only Withdraw remains.
    expect(page).toContain("Withdraw");
    expect(page).not.toContain("Submit for review");

    // List page shows the item under PUBLISHED filter.
    const list = await (
      await get(app, A, "/admin/knowledge?status=PUBLISHED")
    ).text();
    expect(list).toContain("ui-flow");
    expect(list).toContain("UI flow doc");
  });

  it("illegal transition via UI → flash error, status unchanged", async () => {
    const { app, store, A } = await mkApp();
    const c = await createKnowledgeItem(
      store, { kind: "GUIDE", slug: "bad-trans", title: "t", body: "b" }, OP,
    );
    if (!c.ok) throw new Error("create failed");
    const r = await postForm(
      app,
      A,
      `/admin/knowledge/${c.item.id}`,
      `/admin/knowledge/${c.item.id}/transition`,
      { to: "PUBLISHED" }, // DRAFT→PUBLISHED illegal
    );
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toContain("err=");
    const item = await store.getItem(c.item.id);
    expect(item?.status).toBe("DRAFT");
  });

  it("gaps screen: gap listed, triage + resolve-with-link via posts", async () => {
    const { app, store, A } = await mkApp();
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
      await approveTransition(store, c.item.id, to, actor);
    }

    let page = await (await get(app, A, "/admin/knowledge/gaps")).text();
    expect(page).toContain("what is the fee schedule");
    expect(page).toContain("triage");

    await postForm(
      app,
      A,
      "/admin/knowledge/gaps",
      `/admin/knowledge/gaps/${g.gap!.id}/triage`,
      {},
    );
    page = await (await get(app, A, "/admin/knowledge/gaps?status=TRIAGED")).text();
    expect(page).toContain("resolve");

    const r = await postForm(
      app,
      A,
      "/admin/knowledge/gaps?status=TRIAGED",
      `/admin/knowledge/gaps/${g.gap!.id}/resolve`,
      { linkedItemId: c.item.id },
    );
    expect(r.status).toBe(303);
    const gap = await store.getGap(g.gap!.id);
    expect(gap?.status).toBe("RESOLVED");
    expect(gap?.linkedItemId).toBe(c.item.id);
  });

  it("XSS: injected markup in title is escaped in list+detail", async () => {
    const { app, store, A } = await mkApp();
    const evil = `<img src=x onerror=alert(1)>`;
    const c = await createKnowledgeItem(
      store, { kind: "GUIDE", slug: "xss-item", title: evil, body: "b" }, OP,
    );
    if (!c.ok) throw new Error("create failed");
    for (const path of ["/admin/knowledge", `/admin/knowledge/${c.item.id}`]) {
      const page = await (await get(app, A, path)).text();
      expect(page).not.toContain(evil);
      expect(page).toContain("&lt;img");
    }
  });
});
