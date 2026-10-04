// SLICE-156-6: unified-balance delegate surface.
//   POST /api/wallets/:addr/delegate        — register delegate intent
//     (wallet-sig proof of :addr owner). Onchain addDelegate still
//     needs the owner's kit signature — response carries verbatim
//     params for the handoff.
//   GET  /api/wallets/:addr/delegate        — owner views own records.
//   POST /api/wallets/:addr/delegate/revoke — mark revoked server-side
//     (stops spendAsDelegate immediately) + verbatim removeDelegate
//     params for the owner to clear onchain rights.
import { Hono } from "hono";
import type { Context } from "hono";
import { describeRoute } from "hono-openapi";
import { verifyWalletSigRequest } from "../middleware/agent-auth";
import type { AgentWalletStore } from "../lib/agent-wallet/registry";
import {
  validateDelegateInput,
  type DelegateSpendKit,
  type DelegateStore,
} from "../lib/agent-wallet/delegate";

export interface DelegateRoutesDeps {
  delegateStore: DelegateStore;
  /** Server delegate EOA (from ARC_DELEGATE_KEY). */
  delegateAddress: `0x${string}`;
  /** Agent wallet registry — requireRegistered check. */
  walletStore: AgentWalletStore;
  requireRegistered: boolean;
  /** Optional live kit — status view enriches records when present. */
  kit?: DelegateSpendKit;
}

/** Caller must prove ownership of the :addr wallet (EOA or ERC-1271). */
async function ownerOrNull(c: Context): Promise<string | null> {
  const addr = c.req.param("addr")?.toLowerCase();
  const wallet = c.req.header("x-wallet");
  if (!addr || !wallet || wallet.toLowerCase() !== addr) return null;
  const sig = await verifyWalletSigRequest({
    wallet,
    signature: c.req.header("x-sig"),
    timestamp: c.req.header("x-timestamp"),
    method: c.req.method,
    path: c.req.path,
  });
  return sig === "valid" ? addr : null;
}

export function createAgentWalletDelegateRoutes(
  deps: DelegateRoutesDeps,
): Hono {
  const routes = new Hono();

  routes.post(
    "/api/wallets/:addr/delegate",
    describeRoute({
      description:
        "Register server-delegate intent for a source chain — " +
        "wallet-sig proof; returns verbatim addDelegate params",
      responses: {
        201: { description: "{record, addDelegate}" },
        400: { description: "Invalid input" },
        401: { description: "Wallet signature required/invalid" },
        403: { description: "Wallet not registered" },
      },
    }),
    async (c) => {
      const owner = await ownerOrNull(c);
      if (!owner) return c.json({ error: "wallet signature required" }, 401);
      if (deps.requireRegistered && !(await deps.walletStore.get(owner))) {
        return c.json({ error: "wallet not registered" }, 403);
      }
      let body: { chain?: string; spendCapUsd?: number };
      try {
        body = await c.req.json();
      } catch {
        return c.json({ error: "invalid JSON body" }, 400);
      }
      let rec;
      try {
        rec = validateDelegateInput({
          ownerWallet: owner,
          delegate: deps.delegateAddress,
          chain: body.chain ?? "",
          spendCapUsd: Number(body.spendCapUsd),
        });
      } catch (e) {
        return c.json(
          { error: e instanceof Error ? e.message : String(e) },
          400,
        );
      }
      deps.delegateStore.put(rec);
      return c.json(
        {
          record: rec,
          addDelegate: {
            method: "kit.unifiedBalance.addDelegate",
            params: {
              from: { adapter: "<owner-adapter>", chain: rec.chain },
              delegateAddress: rec.delegate,
            },
            note:
              "Owner must sign addDelegate onchain per chain; spend " +
              "stays gated until getDelegateStatus returns 'ready'.",
          },
        },
        201,
      );
    },
  );

  routes.get(
    "/api/wallets/:addr/delegate",
    describeRoute({
      description:
        "List delegate records for the owner wallet (wallet-sig)",
      responses: {
        200: { description: "{delegates: DelegateRecord[]}" },
        401: { description: "Wallet signature required/invalid" },
      },
    }),
    async (c) => {
      const owner = await ownerOrNull(c);
      if (!owner) return c.json({ error: "wallet signature required" }, 401);
      const records = deps.delegateStore.list(owner);
      if (!deps.kit) return c.json({ delegates: records });
      const delegates = await Promise.all(
        records.map(async (r) => ({
          ...r,
          onchainStatus: await deps
            .kit!.getDelegateStatus({
              ownerWallet: r.ownerWallet,
              chain: r.chain,
              delegate: r.delegate,
            })
            .catch(() => "unknown" as const),
        })),
      );
      return c.json({ delegates });
    },
  );

  routes.post(
    "/api/wallets/:addr/delegate/revoke",
    describeRoute({
      description:
        "Revoke delegate server-side (immediate spend stop) + " +
        "verbatim removeDelegate params for onchain cleanup",
      responses: {
        200: { description: "{revoked, removeDelegate}" },
        401: { description: "Wallet signature required/invalid" },
        404: { description: "No active delegate on that chain" },
      },
    }),
    async (c) => {
      const owner = await ownerOrNull(c);
      if (!owner) return c.json({ error: "wallet signature required" }, 401);
      let body: { chain?: string };
      try {
        body = await c.req.json();
      } catch {
        return c.json({ error: "invalid JSON body" }, 400);
      }
      if (!body.chain) return c.json({ error: "chain required" }, 400);
      if (!deps.delegateStore.revoke(owner, body.chain)) {
        return c.json({ error: "no active delegate on that chain" }, 404);
      }
      return c.json({
        revoked: true,
        chain: body.chain,
        removeDelegate: {
          method: "kit.unifiedBalance.removeDelegate",
          params: {
            from: { adapter: "<owner-adapter>", chain: body.chain },
            delegateAddress: deps.delegateAddress,
          },
          note:
            "Server-side spends are already stopped; owner should " +
            "still sign removeDelegate to clear onchain rights.",
        },
      });
    },
  );

  return routes;
}
