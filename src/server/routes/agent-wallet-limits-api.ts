// SLICE-155-3: limits mirror + OTP handoff command.
//  GET  /api/wallets/:address/limits — envelope caps+usage next to the
//   Circle policy mirror (CLI read, no OTP; 60s cache). chain≠"ARC" →
//   circle: "mainnet-only"; CLI missing → "unavailable".
//  POST /api/wallets/:address/limits/command — body caps → verbatim
//   `circle wallet limit set …` command for the OWNER to run in their
//   own terminal (OTP goes to their email — we never see it). Pure
//   transform: registered-wallet check + monotonic validation, no sig.

import { Hono } from "hono";
import { describeRoute } from "hono-openapi";

import { errorResponse } from "../lib/error-response";
import { ErrorCodes } from "../lib/error-codes";
import { verifyWalletSigRequest } from "../middleware/agent-auth";
import { requireVenueAccess } from "../middleware/venue-auth";
import type { AgentWalletStore } from "../lib/agent-wallet/registry";
import { validateCaps } from "../lib/agent-wallet/envelope";
import { windowUsage, WINDOW_SEC, type SpendLedger } from "../lib/agent-wallet/ledger";
import type { CircleCliClient, PolicyCaps } from "@agentbadge/circle-payments";
import { CliUnavailableError } from "@agentbadge/circle-payments";

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const CACHE_TTL_MS = 60_000;
/** Circle policy mirror lives on Arc mainnet ("ARC"). */
const MAINNET_CHAIN = "ARC";

export interface AgentWalletLimitsDeps {
  store: AgentWalletStore;
  ledger: SpendLedger;
  cli?: CircleCliClient;
  chain: string;
}

export type CircleLimitsView =
  | PolicyCaps
  | "unavailable"
  | "mainnet-only";

interface CacheEntry {
  value: CircleLimitsView;
  at: number;
}

async function circleLimits(
  deps: AgentWalletLimitsDeps,
  address: string,
  cache: Map<string, CacheEntry>,
): Promise<CircleLimitsView> {
  if (deps.chain !== MAINNET_CHAIN) return "mainnet-only";
  const cached = cache.get(address);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;
  let value: CircleLimitsView = "unavailable";
  if (deps.cli) {
    try {
      value = await deps.cli.limits(address, deps.chain);
    } catch (err) {
      if (!(err instanceof CliUnavailableError)) throw err;
      value = "unavailable";
    }
  }
  cache.set(address, { value, at: Date.now() });
  return value;
}

export function createAgentWalletLimitsRoutes(
  deps: AgentWalletLimitsDeps,
): Hono {
  const routes = new Hono();
  const cache = new Map<string, CacheEntry>();

  routes.get(
    "/api/wallets/:address/limits",
    describeRoute({
      description:
        "Envelope caps + usage alongside Circle policy mirror — circle:" +
        " PolicyCaps | 'unavailable' | 'mainnet-only'",
      responses: {
        200: { description: "{envelope:{caps,usage}, circle}" },
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
      const caps = rec.envelope;
      const usage: Record<
        string,
        { used: number; cap?: number; resetAt?: number }
      > = {};
      const windows: Array<[string, number | undefined, number]> = [
        ["daily", caps.dailyUsd, WINDOW_SEC.daily],
        ["weekly", caps.weeklyUsd, WINDOW_SEC.weekly],
        ["monthly", caps.monthlyUsd, WINDOW_SEC.monthly],
      ];
      for (const [name, cap, windowSec] of windows) {
        const { used, oldestAt } = await windowUsage(
          deps.ledger, rec.address, windowSec,
        );
        usage[name] = {
          used,
          ...(cap !== undefined ? { cap } : {}),
          ...(oldestAt !== undefined
            ? { resetAt: Math.floor((oldestAt + windowSec * 1000) / 1000) }
            : {}),
        };
      }
      if (caps.perTxUsd !== undefined) {
        usage.perTx = { used: 0, cap: caps.perTxUsd };
      }
      const circle = await circleLimits(deps, rec.address, cache);
      return c.json({ address: rec.address, envelope: { caps, usage }, circle });
    },
  );

  routes.post(
    "/api/wallets/:address/limits/command",
    describeRoute({
      description:
        "Build verbatim `circle wallet limit set` command — owner runs " +
        "it in their own terminal (OTP never touches the platform)",
      responses: {
        200: { description: "{command, chain, note}" },
        400: { description: "Non-monotonic or invalid caps" },
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
      let caps;
      try {
        caps = validateCaps(await c.req.json());
      } catch (err) {
        return errorResponse(c, 400, ErrorCodes.INVALID_INPUT,
          err instanceof Error ? err.message : "invalid caps");
      }
      const { perTxUsd: perTx, dailyUsd: daily,
        weeklyUsd: weekly, monthlyUsd: monthly } = caps;
      const parts = [
        "circle wallet limit set",
        `--address ${rec.address}`,
        `--chain ${deps.chain}`,
        "--policy-type stablecoin",
      ];
      if (perTx !== undefined) parts.push(`--per-tx ${perTx}`);
      if (daily !== undefined) parts.push(`--daily ${daily}`);
      if (weekly !== undefined) parts.push(`--weekly ${weekly}`);
      if (monthly !== undefined) parts.push(`--monthly ${monthly}`);
      return c.json({
        command: parts.join(" \\\n  "),
        commandLine: parts.join(" "),
        chain: deps.chain,
        note:
          "Run in your own terminal. Circle will email an OTP to the " +
          "wallet owner — never share it, never enter it here.",
      });
    },
  );

  // SLICE-155-4: spend receipt — ledger entries for the wallet.
  // Auth: sig from the wallet itself, its registrant, or venue admin.
  routes.get(
    "/api/wallets/:address/spend",
    describeRoute({
      description:
        "Spend ledger for the wallet — kind+refId+txHash per entry " +
        "(owner/registrant/venue-admin sig required)",
      responses: {
        200: { description: "{address, spend:[entry], totals}" },
        401: { description: "Signature required" },
        403: { description: "Not owner / registrant / venue admin" },
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
      const caller = await sigWallet(c);
      if (!caller) {
        return errorResponse(c, 401, ErrorCodes.WRONG_SIGNER,
          "valid X-Wallet/X-Sig/X-Timestamp required");
      }
      const allowed =
        caller === rec.address.toLowerCase() ||
        caller === rec.registeredBy ||
        (!!rec.venueId &&
          !(await requireVenueAccess(c, rec.venueId, "admin") instanceof
            Response));
      if (!allowed) {
        return errorResponse(c, 403, ErrorCodes.WRONG_SIGNER,
          "only wallet owner, registrant or venue admin can read spend");
      }
      const spend = await deps.ledger.listByWallet(rec.address);
      const state = c.req.query("state");
      const entries = (
        state ? spend.filter((e) => e.state === state) : spend
      ).map((e) => ({
        id: e.id,
        amountUsd: e.amountUsd,
        kind: e.kind,
        refId: e.refId,
        state: e.state,
        txHash: e.txHash,
        at: e.at,
      }));
      const settled = entries
        .filter((e) => e.state === "settled")
        .reduce((s, e) => s + e.amountUsd, 0);
      return c.json({
        address: rec.address,
        spend: entries,
        totals: { settledUsd: Math.round(settled * 1e6) / 1e6 },
      });
    },
  );

  return routes;
}

/** Wallet-sig check — returns caller wallet or null (no error body). */
async function sigWallet(c: {
  req: {
    header: (n: string) => string | undefined;
    method: string;
    path: string;
  };
}): Promise<string | null> {
  const wallet = c.req.header("x-wallet");
  const sig = await verifyWalletSigRequest({
    wallet,
    signature: c.req.header("x-sig"),
    timestamp: c.req.header("x-timestamp"),
    method: c.req.method,
    path: c.req.path,
  });
  return sig === "valid" && wallet ? wallet.toLowerCase() : null;
}
