/**
 * SLICE-154-3: external-job evaluation API — third-party ERC-8183 escrows.
 *
 *   POST   /api/eaas/contracts             — wallet-sig register + ABI probe
 *   GET    /api/eaas/contracts             — public allowlist listing
 *   DELETE /api/eaas/contracts/:address    — owner-only remove (wallet-sig)
 *   POST   /api/eaas/jobs/evaluate         — x402-gated settle + artifact
 *
 * Guard order on evaluate: validate (400) → rate-limit (429) →
 * allowlist (403) → idempotent replay (free) → payment → evaluate.
 * Onchain status != Submitted/expired → 409; estimateGas over
 * ARC_EAAS_GAS_CAP aborts → 502.
 *
 * SLICE-181-2: when deps.seamTwoPhase is wired the x402 path verifies
 * first and settles only after a successful evaluation — the refusal
 * paths above answer charged:false (and refund self-settled payments)
 * instead of keeping the fee (D-181-3). Atomic middleware fallback
 * remains when no seam is provided.
 */

import { Hono, type Context } from "hono";
import { describeRoute } from "hono-openapi";
import { isAddress } from "viem";
import { verifyWalletSigRequest } from "../middleware/agent-auth";
import type { PaymentMiddleware } from "./identity";
import {
  ContractRegistryError,
  type EaasContract,
  type EaasContractRegistry,
} from "../lib/eaas/contracts";
import type { EvaluateJobDeps } from "../lib/eaas/eval";
import type { EaasVariables } from "../lib/eaas/request";
import type { EaasQuotaDeps } from "../lib/eaas/subscription";
import type { EaasAsyncDeps } from "../lib/eaas/requests";
import type { EvalInput } from "../lib/eaas/eval-request";
import type { PaymentHandle } from "../lib/x402-settle-seam";
import { registerEvaluateRoute } from "./eaas-evaluate";

export interface EaasJobsVariables extends EaasVariables {
  evalInput?: EvalInput;
  /** SLICE-181-2: verified-not-settled payment on the two-phase path. */
  paymentHandle?: PaymentHandle;
}

export interface EaasJobsRoutesDeps extends EvaluateJobDeps {
  contracts: EaasContractRegistry;
  evalUsd: string;
  rateRpm: number;
  chainId: number;
  paymentForPrice: (priceUsd: string) => PaymentMiddleware;
  /** SLICE-181-2: verify-only payment seam — enables refuse-before-settle.
   *  Absent → legacy atomic paymentForPrice middleware (charged on 4xx). */
  seamTwoPhase?: (c: Context) => Promise<PaymentHandle | null>;
  /** SLICE-154-5: subscription quota gate — absent = x402-only. */
  quota?: EaasQuotaDeps;
  /** SLICE-154-6: async request delivery — absent = async:true rejected. */
  async_?: EaasAsyncDeps;
}

const dr = (summary: string) =>
  describeRoute({
    tags: ["EaaS Jobs"],
    summary,
    responses: { 200: { description: summary } },
  });

/** wallet-sig → signer wallet, or null. */
async function signerWallet(c: {
  req: {
    header(n: string): string | undefined;
    method: string;
    path: string;
  };
}): Promise<`0x${string}` | null> {
  const wallet = c.req.header("x-wallet");
  const ok = await verifyWalletSigRequest({
    wallet,
    signature: c.req.header("x-sig"),
    timestamp: c.req.header("x-timestamp"),
    method: c.req.method,
    path: c.req.path,
  });
  return ok === "valid" && wallet && isAddress(wallet)
    ? (wallet as `0x${string}`)
    : null;
}

export function createEaasJobsRoutes(
  deps: EaasJobsRoutesDeps,
): Hono<{ Variables: EaasJobsVariables }> {
  const routes = new Hono<{ Variables: EaasJobsVariables }>();

  /* ------------------------- contract registration ------------------------ */

  routes.post(
    "/api/eaas/contracts",
    dr("Register an external ERC-8183 escrow (wallet-sig; ABI probe)"),
    async (c) => {
      const owner = await signerWallet(c);
      if (!owner) return c.json({ error: "wallet signature required" }, 401);
      const body = (await c.req.json().catch(() => null)) as
        | Record<string, unknown>
        | null;
      if (!body) return c.json({ error: "invalid JSON body" }, 400);
      if (typeof body.address !== "string" || !isAddress(body.address)) {
        return c.json({ error: "address (0x…) required" }, 400);
      }
      const chainId =
        typeof body.chainId === "number" ? body.chainId : deps.chainId;
      try {
        const contract = await deps.contracts.register(
          {
            address: body.address,
            chainId,
            terms:
              typeof body.terms === "object" && body.terms !== null
                ? (body.terms as EaasContract["terms"])
                : undefined,
          },
          owner,
        );
        return c.json({ contract }, 201);
      } catch (e) {
        if (e instanceof ContractRegistryError) {
          const status =
            e.code === "probe-failed" ? 422 : e.code === "forbidden" ? 403 : 409;
          return c.json({ error: e.message }, status);
        }
        throw e;
      }
    },
  );

  routes.get("/api/eaas/contracts", dr("List allowlisted contracts"), (c) =>
    c.json({ contracts: deps.contracts.list() }),
  );

  routes.delete(
    "/api/eaas/contracts/:address",
    dr("Deactivate a contract (wallet-sig; owner only)"),
    async (c) => {
      const owner = await signerWallet(c);
      if (!owner) return c.json({ error: "wallet signature required" }, 401);
      const address = c.req.param("address");
      if (!isAddress(address)) return c.json({ error: "invalid address" }, 400);
      try {
        const removed = deps.contracts.remove(address, deps.chainId, owner);
        return c.json({ contract: removed });
      } catch (e) {
        if (e instanceof ContractRegistryError) {
          return c.json(
            { error: e.message },
            e.code === "forbidden" ? 403 : 404,
          );
        }
        throw e;
      }
    },
  );

  /* ------------------------------ job evaluate ---------------------------- */
  // Route lives in eaas-evaluate.ts (file-size cap; see header there).
  registerEvaluateRoute(routes, deps);

  return routes;
}
