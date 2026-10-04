// SLICE-155-6: spend audit surfaces.
//   GET /api/wallets/:address/audit    — owner/registrant/venue-admin,
//                                        ledger feed + alert events
//   GET /api/venue/instances/:id/spend — venue admin+, union across
//                                        venue wallets (cursor/filters)
//   GET /api/venue/instances/:id/spend/stats — totalUsd/byKind/byAgent
//                                        + capDenials7d
// Cursor = last seen entry id (opaque); limit ≤ 200 (default 50).

import { Hono, type Context } from "hono";
import { describeRoute } from "hono-openapi";

import { errorResponse } from "../lib/error-response";
import { ErrorCodes } from "../lib/error-codes";
import type { AgentWalletStore } from "../lib/agent-wallet/registry";
import type { SpendEntry, SpendLedger } from "../lib/agent-wallet/ledger";
import {
  aggregateSpend,
  type SpendAlertStore,
} from "../lib/agent-wallet/audit";
import { verifyWalletSigRequest } from "../middleware/agent-auth";
import { requireVenueAccess } from "../middleware/venue-auth";

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const MAX_LIMIT = 200;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export interface SpendAuditDeps {
  store: AgentWalletStore;
  ledger: SpendLedger;
  alerts: () => SpendAlertStore | null;
}

function entryView(e: SpendEntry) {
  return {
    id: e.id,
    wallet: e.wallet,
    amountUsd: e.amountUsd,
    kind: e.kind,
    refId: e.refId,
    state: e.state,
    txHash: e.txHash,
    at: e.at,
  };
}

interface FeedQuery {
  kind?: string;
  state?: string;
  since?: number;
  wallet?: string;
  limit: number;
  cursor?: string;
}

function parseQuery(c: { req: { query: (k: string) => string | undefined } }): FeedQuery {
  const rawLimit = Number(c.req.query("limit") ?? 50);
  return {
    kind: c.req.query("kind")?.trim() || undefined,
    state: c.req.query("state")?.trim() || undefined,
    since: Number(c.req.query("since")) || undefined,
    wallet: c.req.query("wallet")?.trim() || undefined,
    limit: Math.min(Math.max(rawLimit || 50, 1), MAX_LIMIT),
    cursor: c.req.query("cursor")?.trim() || undefined,
  };
}

function feed(entries: SpendEntry[], q: FeedQuery) {
  let out = entries.filter(
    (e) =>
      (!q.kind || e.kind === q.kind) &&
      (!q.state || e.state === q.state) &&
      (!q.since || e.at >= q.since) &&
      (!q.wallet || e.wallet.toLowerCase() === q.wallet.toLowerCase()),
  );
  out = [...out].sort((a, b) => b.at - a.at);
  if (q.cursor) {
    const idx = out.findIndex((e) => e.id === q.cursor);
    if (idx >= 0) out = out.slice(idx + 1);
  }
  const page = out.slice(0, q.limit);
  return {
    entries: page.map(entryView),
    nextCursor: out.length > q.limit ? page[page.length - 1].id : null,
  };
}

export function createSpendAuditRoutes(deps: SpendAuditDeps): Hono {
  const routes = new Hono();

  routes.get(
    "/api/wallets/:address/audit",
    describeRoute({
      description:
        "Spend audit feed for a wallet — ledger entries (kind/state/" +
        "since filters, cursor) + alert events; owner/registrant/" +
        "venue-admin signature required",
      responses: {
        200: { description: "{entries,nextCursor,alerts}" },
        401: { description: "Missing/invalid wallet signature" },
        403: { description: "Caller not owner/registrant/venue admin" },
        404: { description: "Wallet not registered" },
      },
    }),
    async (c) => {
      const addr = c.req.param("address");
      if (!ADDRESS_RE.test(addr)) {
        return errorResponse(c, 400, ErrorCodes.INVALID_INPUT,
          "invalid address");
      }
      const rec = await deps.store.get(addr);
      if (!rec || !rec.active) {
        return errorResponse(c, 404, ErrorCodes.RESOURCE_NOT_FOUND,
          "wallet not registered");
      }
      const walletHdr = c.req.header("x-wallet");
      const sig = await verifyWalletSigRequest({
        wallet: walletHdr,
        signature: c.req.header("x-sig"),
        timestamp: c.req.header("x-timestamp"),
        method: c.req.method,
        path: c.req.path,
      });
      const caller =
        sig === "valid" && walletHdr ? walletHdr.toLowerCase() : null;
      if (!caller) {
        return errorResponse(c, 401, ErrorCodes.WRONG_SIGNER,
          "valid X-Wallet/X-Sig/X-Timestamp required");
      }
      const allowed =
        caller === rec.address.toLowerCase() ||
        caller === rec.registeredBy ||
        (!!rec.venueId &&
          !(await requireVenueAccess(c, rec.venueId, "admin")
            instanceof Response));
      if (!allowed) {
        return errorResponse(c, 403, ErrorCodes.WRONG_SIGNER,
          "only wallet owner, registrant or venue admin can read audit");
      }
      const q = parseQuery(c);
      const result = feed(await deps.ledger.listByWallet(rec.address), q);
      const alerts = deps.alerts()?.list({
        wallet: rec.address,
        limit: 50,
      });
      return c.json({ ...result, alerts: alerts ?? [] });
    },
  );

  const venueSpend = async (
    c: Context,
    statsOnly: boolean,
  ): Promise<Response> => {
    const id = c.req.param("id");
    const access = await requireVenueAccess(c, id, "admin");
    if (access instanceof Response) return access;
    const wallets = (await deps.store.list(id)).filter((w) => w.active);
    const all = (
      await Promise.all(wallets.map((w) => deps.ledger.listByWallet(w.address)))
    ).flat();
    if (statsOnly) {
      const q = parseQuery(c);
      const scoped = all.filter(
        (e) => (!q.since || e.at >= q.since) && (!q.kind || e.kind === q.kind),
      );
      const stats = aggregateSpend(scoped);
      const capDenials7d =
        deps
          .alerts()
          ?.list({ type: "spend.cap_denied", since: Date.now() - WEEK_MS, limit: 1000 })
          .filter((e) => e.venueId === id).length ?? 0;
      return c.json({ venueId: id, ...stats, capDenials7d });
    }
    const q = parseQuery(c);
    const result = feed(all, q);
    const alerts = deps.alerts()?.list({ venueId: id, limit: 50 });
    return c.json({ venueId: id, ...result, alerts: alerts ?? [] });
  };

  routes.get(
    "/api/venue/instances/:id/spend",
    describeRoute({
      description:
        "Aggregated spend audit feed across a venue's agent wallets " +
        "(kind/state/since/wallet filters, cursor) + alert events",
      responses: {
        200: { description: "{venueId,entries,nextCursor,alerts}" },
        403: { description: "Not venue admin" },
        404: { description: "Venue not found" },
      },
    }),
    (c) => venueSpend(c, false),
  );

  routes.get(
    "/api/venue/instances/:id/spend/stats",
    describeRoute({
      description:
        "Venue spend stats — {totalUsd,byKind,byAgent,capDenials7d}; " +
        "optional ?since=&kind= scope",
      responses: {
        200: { description: "{venueId,totalUsd,byKind,byAgent,capDenials7d}" },
        403: { description: "Not venue admin" },
        404: { description: "Venue not found" },
      },
    }),
    (c) => venueSpend(c, true),
  );

  return routes;
}
