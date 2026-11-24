/**
 * EPIC-229 (SLICE-229-9): operator SSR console —
 *   GET  /admin/knowledge           → items list (status filter)
 *   GET  /admin/knowledge/gaps      → gap backlog (triage actions)
 *   GET  /admin/knowledge/:id       → item detail + taxonomy forms
 *   POST /admin/knowledge/{create,:id/*,gaps/:id/*} → PRG mutations
 *
 * Browser auth: `operatorBrowserAuth` Basic — an opk_ credential
 * resolves the Principal (SLICE-264-6); the dual-auth window still
 * accepts the shared key as break_glass during migration. POSTs
 * require same-host Origin when present (B-3 lesson); mutations
 * call the domain lib directly and redirect 303 — the
 * /admin/api/knowledge/* JSON API stays the programmatic surface.
 * Mutations live in admin-knowledge-ui-mutations.ts (300-line guard).
 */

import { Hono } from "hono";
import type { Context } from "hono";

import {
  capabilityForSurface,
  operatorBrowserAuth,
  requireCapability,
} from "../middleware/operatorAuth";
import { errorResponse } from "../lib/error-response";
import { ErrorCodes } from "../lib/error-codes";
import type { OperatorStore } from "../lib/operators";
import { rejectCtrl } from "./admin-operator-guard";
import { wrapFragment } from "./ui/helpers";
import type { KnowledgeStore } from "../lib/knowledge/store";
import {
  allowedKnowledgeTransitions,
  listGaps,
  listKnowledgeCapabilities,
  relationsFor,
  listEvidence,
  evidenceFingerprint,
  supersededBy,
  KNOWLEDGE_GAP_STATUSES,
  KNOWLEDGE_STATUSES,
} from "../lib/knowledge";
import { knowledgeListPage } from "../../views/admin-knowledge/list";
import { knowledgeDetailPage } from "../../views/admin-knowledge/detail";
import { taxonomyFragment } from "../../views/admin-knowledge/detail-taxonomy";
import { knowledgeGapsPage } from "../../views/admin-knowledge/gaps";
import { registerKnowledgeUiMutations } from "./admin-knowledge-ui-mutations";
import { registerKnowledgeUiTaxonomyMutations } from "./admin-knowledge-ui-mutations-taxonomy";

const page = (c: Context, frag: string, title: string): Response =>
  c.html(
    wrapFragment(c, frag, title, {
      path: c.req.path,
      title: `Admin Knowledge — ${title}`,
      description: `Admin Knowledge — ${title}`,
    }),
    200,
    // Arc R3 nit: wrapFragment returns a bare fragment for HX-Request
    // vs a full page otherwise — Vary keeps shared caches honest even
    // though no-store already applies to this console.
    { "Cache-Control": "no-store", Vary: "HX-Request" },
  );

/** Arc R1 M11: flash text is server-generated, not user prose —
 *  cap it so a param can't smuggle a paragraph into a trusted
 *  admin banner (social-engineering surface). */
const flashCap = (s: string | undefined) =>
  s === undefined ? undefined : [...s].slice(0, 120).join("");

export const backWith = (
  base: string,
  flash: { ok?: string; err?: string },
): string => {
  const q = new URLSearchParams();
  if (flash.err) q.set("err", flashCap(flash.err) ?? "");
  else if (flash.ok) q.set("ok", flashCap(flash.ok) ?? "");
  const qs = q.toString();
  return `${base}${qs ? `?${qs}` : ""}`;
};

export function createAdminKnowledgeUi(
  store: KnowledgeStore,
  operatorStore: OperatorStore,
): Hono {
  const app = new Hono();
  const browserAuth = operatorBrowserAuth(operatorStore);
  app.use("/admin/knowledge", browserAuth);
  app.use("/admin/knowledge/*", browserAuth);
  // SLICE-264-6: capability gate — GET pages need "read", form
  // POSTs need "workflow" (capabilityForSurface method fallback).
  app.use("/admin/knowledge/*", async (c, next) => {
    const deny = requireCapability(
      c,
      capabilityForSurface(c.req.path, c.req.method),
    );
    if (deny) return deny;
    await next();
  });
  // B-3: browsers auto-attach cached Basic creds to cross-site form
  // POSTs — same-host Origin required when the header is present.
  app.use("/admin/knowledge/*", async (c, next) => {
    if (c.req.method !== "POST") return next();
    // Arc R1 M11: browsers always send Sec-Fetch-Site on cross-site
    // posts — reject explicitly; Origin stays the fallback for
    // clients that don't send it.
    const fetchSite = c.req.header("sec-fetch-site");
    // Arc R2 nit: "cross_origin" is not a real Sec-Fetch-Site value —
    // dead list entry removed; the fetch metadata vocabulary is
    // same-origin | same-site | cross-site | none.
    if (fetchSite === "cross-site") {
      return errorResponse(
        c,
        403,
        ErrorCodes.UNAUTHORIZED,
        "cross-site form post refused",
      );
    }
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
    // Arc R1 M8: unvalidated ?status= reached the PG driver → 500
    // on %00 etc. Same enum + "all" contract as the JSON API.
    if (
      status !== "all" &&
      !KNOWLEDGE_GAP_STATUSES.includes(status as never)
    ) {
      return errorResponse(c, 400, ErrorCodes.INVALID_INPUT, "bad status");
    }
    // Arc R3 M-9: ?offset= paging — a fixed limit-200 hid the tail
    // of a capped 2000-row backlog from triage entirely.
    // Arc R4 M-9: floor — ?offset=1.5 otherwise binds a non-integer
    // to the int4 param and 500s on PG.
    const offset = Math.max(
      0,
      Math.min(100000, Math.floor(Number(c.req.query("offset") ?? 0)) || 0),
    );
    const gaps = await listGaps(store, {
      status: status === "all" ? undefined : status,
      sort: "count",
      limit: 200,
      offset,
    });
    const items = await store.listItems({ limit: 200 });
    return page(
      c,
      knowledgeGapsPage({
        gaps,
        status,
        items,
        offset,
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
        evidenceFp: evidenceFingerprint(evidence),
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
          latestSeq: latest?.seq ?? null,
          editable: item.status === "DRAFT",
        }),
        flash: { ok: c.req.query("ok"), err: c.req.query("err") },
      }),
      item.slug,
    );
  });

  registerKnowledgeUiMutations(app, store);
  registerKnowledgeUiTaxonomyMutations(app, store);
  return app;
}
