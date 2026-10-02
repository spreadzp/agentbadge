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
 * ARC_EAAS_GAS_CAP aborts → 502. The fee stays settled on those paths —
 * the service ran the check.
 */

import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { isAddress } from "viem";
import type { Hex } from "viem";
import { EvaluatorError, Erc8183Error } from "@agentbadge/circle-payments";
import { verifyWalletSigRequest } from "../middleware/agent-auth";
import type { PaymentMiddleware } from "./identity";
import {
  ContractRegistryError,
  type EaasContract,
  type EaasContractRegistry,
} from "../lib/eaas/contracts";
import {
  evalJobKey,
  evaluateExternalJob,
  GasCapError,
  type EvaluateJobDeps,
} from "../lib/eaas/eval";
import {
  consumerKey,
  createRateLimiter,
  HEX32_RE,
  type EaasVariables,
} from "../lib/eaas/request";

/** Parsed+validated evaluate request stashed for the post-payment handler. */
interface EvalInput {
  rec: EaasContract;
  jobId: bigint;
  policy?: string;
  expectedHash?: Hex;
  deliverableUri?: string;
}

interface EaasJobsVariables extends EaasVariables {
  evalInput?: EvalInput;
}

export interface EaasJobsRoutesDeps extends EvaluateJobDeps {
  contracts: EaasContractRegistry;
  evalUsd: string;
  rateRpm: number;
  chainId: number;
  paymentForPrice: (priceUsd: string) => PaymentMiddleware;
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

function bad(c: { json: (o: unknown, s: number) => Response }, e: string) {
  return c.json({ error: e }, 400);
}

/** Validate the evaluate body → EvalInput | Response(400). */
function validateEvaluate(
  body: unknown,
  c: { json: (o: unknown, s: number) => Response },
): { contract: string } & Omit<EvalInput, "rec"> | Response {
  if (typeof body !== "object" || body === null) {
    return bad(c, "invalid JSON body");
  }
  const b = body as Record<string, unknown>;
  if (typeof b.contract !== "string" || !isAddress(b.contract)) {
    return bad(c, "contract (0x…) required");
  }
  if (typeof b.jobId !== "string" && typeof b.jobId !== "number") {
    return bad(c, "jobId required");
  }
  let jobId: bigint;
  try {
    jobId = BigInt(b.jobId);
  } catch {
    return bad(c, "jobId must be an integer");
  }
  if (b.policy !== undefined && typeof b.policy !== "string") {
    return bad(c, "policy must be a POLICY_REGISTRY key");
  }
  if (b.expectedHash !== undefined) {
    if (typeof b.expectedHash !== "string" || !HEX32_RE.test(b.expectedHash)) {
      return bad(c, "expectedHash must be 0x + 64 hex");
    }
  }
  if (b.deliverableUri !== undefined && typeof b.deliverableUri !== "string") {
    return bad(c, "deliverableUri must be a string");
  }
  return {
    contract: b.contract,
    jobId,
    ...(typeof b.policy === "string" ? { policy: b.policy } : {}),
    ...(typeof b.expectedHash === "string"
      ? { expectedHash: b.expectedHash as Hex }
      : {}),
    ...(typeof b.deliverableUri === "string"
      ? { deliverableUri: b.deliverableUri }
      : {}),
  };
}

export function createEaasJobsRoutes(
  deps: EaasJobsRoutesDeps,
): Hono<{ Variables: EaasJobsVariables }> {
  const routes = new Hono<{ Variables: EaasJobsVariables }>();
  const limiter = createRateLimiter(deps.rateRpm);
  const evalPay = deps.paymentForPrice(deps.evalUsd);

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

  routes.post(
    "/api/eaas/jobs/evaluate",
    dr("Evaluate + settle an allowlisted ERC-8183 job (x402-gated)"),
    async (c, next) => {
      const body = await c.req.json().catch(() => null);
      const parsed = validateEvaluate(body, c);
      if (parsed instanceof Response) return parsed;

      // Rate limit before settle — never charge spam.
      if (!limiter.allow(consumerKey(c))) {
        return c.json({ error: "rate limit exceeded" }, 429);
      }

      // Allowlist guard (D7-154).
      const rec = deps.contracts.get(parsed.contract, deps.chainId);
      if (!rec || !rec.active) {
        return c.json({ error: "contract not in EaaS allowlist" }, 403);
      }

      // Idempotent replay — free, no second payment.
      const prior = deps.evalStore.get(
        evalJobKey(rec.chainId, rec.address, parsed.jobId.toString()),
      );
      if (prior) {
        const artifact = deps.verdictStore.get(prior.verdictId)?.artifact;
        return c.json({
          verdict: prior.verdict,
          artifact: artifact ?? null,
          duplicate: true,
          ...(prior.feedbackTx ? { feedbackTx: prior.feedbackTx } : {}),
        });
      }

      c.set("evalInput", { ...parsed, rec });
      return next();
    },
    evalPay,
    async (c) => {
      const input = c.get("evalInput") as EvalInput;
      const payment = c.get("payment");
      try {
        const result = await evaluateExternalJob(
          {
            contract: input.rec,
            jobId: input.jobId,
            policy: input.policy,
            expectedHash: input.expectedHash,
            deliverableUri: input.deliverableUri,
            consumerWallet: payment?.payer,
            paymentTx: payment?.transaction,
          },
          deps,
        );
        return c.json({
          verdict: result.verdict,
          artifact: result.artifact,
          ...(result.feedbackTx ? { feedbackTx: result.feedbackTx } : {}),
        });
      } catch (e) {
        if (e instanceof EvaluatorError) {
          return c.json({ error: e.message }, 409);
        }
        if (e instanceof GasCapError) {
          return c.json({ error: e.message }, 502);
        }
        if (e instanceof Erc8183Error) {
          return c.json({ error: `settlement failed: ${e.message}` }, 502);
        }
        throw e;
      }
    },
  );

  return routes;
}
