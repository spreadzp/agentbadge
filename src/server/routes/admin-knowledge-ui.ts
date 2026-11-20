/**
 * EPIC-229 (SLICE-229-9): operator SSR console —
 *   GET  /admin/knowledge           → items list (status filter)
 *   GET  /admin/knowledge/gaps      → gap backlog (triage actions)
 *   GET  /admin/knowledge/:id       → item detail + taxonomy forms
 *   POST /admin/knowledge/{create,:id/*,gaps/:id/*} → PRG mutations
 *
 * Browser auth: `adminBrowserAuth` Basic (ADMIN_API_KEY) — same as
 * /admin/interactions. POSTs require same-host Origin when present
 * (B-3 lesson); mutations call the domain lib directly and redirect
 * 303 — the /admin/api/knowledge/* JSON API stays the programmatic
 * surface. Mutations live in admin-knowledge-ui-mutations.ts
 * (300-line guard).
 */

import { Hono } from "hono";
import type { Context } from "hono";

import { adminBrowserAuth } from "../middleware/adminAuth";
import { errorResponse } from "../lib/error-response";
import { ErrorCodes } from "../lib/error-codes";
import { rejectCtrl } from "./admin-operator-guard";
import { wrapFragment } from "./ui/helpers";
import type { KnowledgeStore } from "../lib/knowledge/store";
import {
  allowedKnowledgeTransitions,
  listGaps,
  listKnowledgeCapabilities,
  relationsFor,
  listEvidence,
  supersededBy,
  KNOWLEDGE_STATUSES,
} from "../lib/knowledge";
import { knowledgeListPage } from "../../views/admin-knowledge/list";
import { knowledgeDetailPage } from "../../views/admin-knowledge/detail";
import { taxonomyFragment } from "../../views/admin-knowledge/detail-taxonomy";
import { knowledgeGapsPage } from "../../views/admin-knowledge/gaps";
import { registerKnowledgeUiMutations } from "./admin-knowledge-ui-mutations";

const page = (c: Context, frag: string, title: string): Response =>
  c.html(
    wrapFragment(c, frag, title, {
      path: c.req.path,
      title: `Admin Knowledge — ${title}`,
      description: `Admin Knowledge — ${title}`,
    }),
    200,
    { "Cache-Control": "no-store" },
  );

export const backWith = (
  base: string,
  flash: { ok?: string; err?: string },
): string => {
  const q = new URLSearchParams();
  if (flash.err) q.set("err", flash.err);
  else if (flash.ok) q.set("ok", flash.ok);
  const qs = q.toString();
  return `${base}${qs ? `?${qs}` : ""}`;
};

export function createAdminKnowledgeUi(store: KnowledgeStore): Hono {
  const app = new Hono();
  app.use("/admin/knowledge", adminBrowserAuth);
  app.use("/admin/knowledge/*", adminBrowserAuth);
  // B-3: browsers auto-attach cached Basic creds to cross-site form
  // POSTs — same-host Origin required when the header is present.
  app.use("/admin/knowledge/*", async (c, next) => {
    if (c.req.method !== "POST") return next();
    const origin = c.req.header("origin");
    if (!origin) return next();
    try {
      if (new URL(origin).host === new URL(c.req.url).host) return next();
    } catch {
      /* malformed origin → reject below */
    }
    return errorResponse(
      c,
      403,
      ErrorCodes.UNAUTHORIZED,
      "cross-origin form post refused",
    );
  });

  app.get("/admin/knowledge", async (c) => {
    const status = c.req.query("status") ?? "all";
    if (status !== "all" && !KNOWLEDGE_STATUSES.includes(status as never)) {
      return errorResponse(c, 400, ErrorCodes.INVALID_INPUT, "bad status");
    }
    const rows = await store.listItems({
      status: status === "all" ? undefined : status,
      limit: 200,
    });
    const withMeta = await Promise.all(
      rows.map(async (item) => {
        const [versions, latest] = await Promise.all([
          store.listVersions(item.id),
          item.latestVersionId
            ? store.getVersion(item.latestVersionId)
            : Promise.resolve(null),
        ]);
        return { item, title: latest?.title ?? null, versions: versions.length };
      }),
    );
    return page(
      c,
      knowledgeListPage({
        rows: withMeta,
        status,
        flash: { ok: c.req.query("ok"), err: c.req.query("err") },
      }),
      "Items",
    );
  });

  app.get("/admin/knowledge/gaps", async (c) => {
    const status = c.req.query("status") ?? "OPEN";
    const gaps = await listGaps(store, {
      status: status === "all" ? undefined : status,
      sort: "count",
      limit: 200,
    });
    const items = await store.listItems({ limit: 200 });
    return page(
      c,
      knowledgeGapsPage({
        gaps,
        status,
        items,
        flash: { ok: c.req.query("ok"), err: c.req.query("err") },
      }),
      "Gaps",
    );
  });

  app.get("/admin/knowledge/:id", async (c) => {
    const id = c.req.param("id") ?? "";
    const ctrlBad = rejectCtrl(c, id);
    if (ctrlBad) return ctrlBad;
    const item = await store.getItem(id);
    if (!item) {
      return errorResponse(c, 404, ErrorCodes.RESOURCE_NOT_FOUND, "no such item");
    }
    const [versions, events, caps, rels, sup, allCaps, allItems] =
      await Promise.all([
        store.listVersions(id),
        store.listStatusEvents(id),
        store.capabilitiesForItem(id),
        relationsFor(store, id),
        supersededBy(store, id),
        listKnowledgeCapabilities(store, {}),
        store.listItems({ limit: 200 }),
      ]);
    const [latest, published, evidence] = await Promise.all([
      item.latestVersionId ? store.getVersion(item.latestVersionId) : null,
      item.publishedVersionId
        ? store.getVersion(item.publishedVersionId)
        : null,
      item.latestVersionId ? listEvidence(store, item.latestVersionId) : [],
    ]);
    return page(
      c,
      knowledgeDetailPage({
        item,
        latest,
        published,
        versions: [...versions].sort((a, b) => b.seq - a.seq),
        events: [...events].reverse(),
        allowedTransitions: [...allowedKnowledgeTransitions(item.status)],
        taxonomy: taxonomyFragment({
          item,
          capabilities: caps,
          allCapabilities: allCaps,
          relations: rels,
          items: allItems,
          evidence,
          supersededBySlug: sup?.slug ?? null,
          latestTitle: latest?.title ?? "",
          latestBody: latest?.body ?? "",
          latestSummary: latest?.summary ?? null,
          editable: item.status === "DRAFT",
        }),
        flash: { ok: c.req.query("ok"), err: c.req.query("err") },
      }),
      item.slug,
    );
  });

  registerKnowledgeUiMutations(app, store);
  return app;
}
