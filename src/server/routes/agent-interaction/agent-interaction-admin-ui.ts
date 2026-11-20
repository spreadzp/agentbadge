/**
 * EPIC-228 (SLICE-228-5, D-228-6, O-228-3): admin SSR console —
 *   GET  /admin/interactions          → Inbox (status pills + pager)
 *   GET  /admin/interactions/:id      → Request Detail + forms
 *   POST /admin/interactions/:id/{classify,respond,reject}
 *        → form-encoded PRG back to the detail page
 *
 * Browser auth (O-228-3): `adminBrowserAuth` — HTTP Basic prompt,
 * password = ADMIN_API_KEY (no cookies/sessions added). Form
 * mutations call the domain lib directly and redirect 303 — the
 * JSON API at /api/admin/interactions/* stays the programmatic
 * surface for the same operations.
 */

import { Hono } from "hono";
import type { Context } from "hono";

import { adminBrowserAuth } from "../../middleware/adminAuth";
import { errorResponse } from "../../lib/error-response";
import { ErrorCodes } from "../../lib/error-codes";
import { wrapFragment } from "../ui/helpers";
import type { RequestInboxStores } from "../../lib/request-inbox/store";
import {
  statusOfState,
  type InteractionStatus,
} from "../../lib/request-inbox/interaction-types";
import type { InboxRequestRecord } from "../../lib/request-inbox/types";
import {
  classify,
  internalHistory,
  reject,
  respond,
} from "../../lib/agent-interaction";
import { inboxPage } from "../../../views/admin-interactions/inbox";
import { detailPage } from "../../../views/admin-interactions/detail";

const STATUSES = new Set([
  "PENDING_REVIEW",
  "IN_REVIEW",
  "ANSWERED",
  "REJECTED",
]);

const excerptOf = (r: InboxRequestRecord): string => {
  const p = r.payload;
  if (p && typeof p === "object") {
    const t = (p as Record<string, unknown>).text;
    if (typeof t === "string") return t.slice(0, 200);
  }
  return "";
};

const page = (c: Context, frag: string, title: string): Response =>
  c.html(
    wrapFragment(c, frag, title, {
      path: c.req.path,
      title: `Admin Interactions — ${title}`,
      description: `Admin Interactions — ${title}`,
    }),
    200,
    { "Cache-Control": "no-store" },
  );

const backToDetail = (id: string, flash: { ok?: string; err?: string }) => {
  const q = new URLSearchParams();
  if (flash.err) q.set("err", flash.err);
  else if (flash.ok) q.set("ok", flash.ok);
  const qs = q.toString();
  return `/admin/interactions/${id}${qs ? `?${qs}` : ""}`;
};

const csvToList = (v: unknown): string[] | undefined =>
  typeof v === "string"
    ? v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;

export interface AgentInteractionAdminUiDeps {
  stores: RequestInboxStores;
}

export function createAgentInteractionAdminUi(
  deps: AgentInteractionAdminUiDeps,
): Hono {
  const app = new Hono();
  const { stores } = deps;
  app.use("/admin/interactions", adminBrowserAuth);
  app.use("/admin/interactions/*", adminBrowserAuth);

  app.get("/admin/interactions", async (c) => {
    const statusParam = c.req.query("status") ?? "PENDING_REVIEW";
    let status: InteractionStatus | undefined;
    if (statusParam !== "all") {
      if (!STATUSES.has(statusParam)) {
        return errorResponse(c, 400, ErrorCodes.INVALID_INPUT, "bad status");
      }
      status = statusParam as InteractionStatus;
    }
    const cursorRaw = c.req.query("cursor");
    const beforeMs = cursorRaw ? Number(cursorRaw) : undefined;
    const rows = await stores.interactions.listQueue({
      status,
      limit: 51,
      beforeMs: Number.isFinite(beforeMs) ? beforeMs : undefined,
    });
    const page50 = rows.slice(0, 50);
    return page(
      c,
      inboxPage({
        items: page50.map((r) => ({ record: r, excerpt: excerptOf(r) })),
        status: statusParam,
        nextCursor:
          rows.length > 50 ? String(page50[page50.length - 1].createdAtMs) : null,
      }),
      "Inbox",
    );
  });

  app.get("/admin/interactions/:id", async (c) => {
    const id = c.req.param("id");
    const h = await internalHistory(stores, id);
    if (!h) {
      return errorResponse(c, 404, ErrorCodes.REQUEST_NOT_FOUND, "no such request");
    }
    const thread = h.request.sessionId
      ? await stores.interactions.listBySession(h.request.sessionId)
      : [];
    const session = h.request.sessionId
      ? await stores.interactions.getSession(h.request.sessionId)
      : null;
    return page(
      c,
      detailPage({
        request: h.request,
        classification: h.classification,
        responses: h.responses,
        events: h.events,
        thread: thread.map((t) => ({
          id: t.id,
          status: statusOfState(t.state),
          kind: t.kind,
          excerpt: excerptOf(t),
          createdAtMs: t.createdAtMs,
        })),
        sessionRequestCount: session?.requestCount ?? null,
        flash: {
          ok: c.req.query("ok"),
          err: c.req.query("err"),
        },
      }),
      h.request.id,
    );
  });

  // ── Form mutations (PRG) — operator label is a required form field
  //    (the browser-flow equivalent of the API's X-Operator-Id claim).

  app.post("/admin/interactions/:id/classify", async (c) => {
    const id = c.req.param("id");
    const b = await c.req.parseBody();
    const operator =
      typeof b.operator === "string" ? b.operator.trim() : "";
    if (!operator) {
      return c.redirect(backToDetail(id, { err: "operator label required" }), 303);
    }
    const r = await classify(
      stores,
      id,
      {
        intent: b.intent ? String(b.intent) : undefined,
        signalType: b.signalType ? String(b.signalType) : undefined,
        outcome: b.outcome ? String(b.outcome) : undefined,
        knowledgeGap: b.knowledgeGap === "1" ? true : undefined,
        topics: csvToList(b.topics),
        entities: csvToList(b.entities),
        demandSignals: csvToList(b.demandSignals),
      },
      operator,
    );
    if (!r.ok) {
      return c.redirect(
        backToDetail(id, {
          err: r.error === "not_found" ? "request not found" : r.error,
        }),
        303,
      );
    }
    return c.redirect(backToDetail(id, { ok: "classified" }), 303);
  });

  app.post("/admin/interactions/:id/respond", async (c) => {
    const id = c.req.param("id");
    const b = await c.req.parseBody();
    const operator =
      typeof b.operator === "string" ? b.operator.trim() : "";
    if (!operator) {
      return c.redirect(backToDetail(id, { err: "operator label required" }), 303);
    }
    const r = await respond(stores, id, operator, b.body);
    if (!r.ok) {
      const msg =
        "reason" in r
          ? r.reason === "missing"
            ? "request not found"
            : "request already terminal — nothing written"
          : r.error;
      return c.redirect(backToDetail(id, { err: msg }), 303);
    }
    return c.redirect(backToDetail(id, { ok: "answer sent" }), 303);
  });

  app.post("/admin/interactions/:id/reject", async (c) => {
    const id = c.req.param("id");
    const b = await c.req.parseBody();
    const operator =
      typeof b.operator === "string" ? b.operator.trim() : "";
    if (!operator) {
      return c.redirect(backToDetail(id, { err: "operator label required" }), 303);
    }
    const r = await reject(stores, id, operator, b.reason);
    if (!r.ok) {
      const msg =
        "reason" in r
          ? r.reason === "missing"
            ? "request not found"
            : "request already terminal — nothing written"
          : r.error;
      return c.redirect(backToDetail(id, { err: msg }), 303);
    }
    return c.redirect(backToDetail(id, { ok: "rejected" }), 303);
  });

  return app;
}
