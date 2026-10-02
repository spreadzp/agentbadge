/**
 * SLICE-154-2: Standalone verdict API — pay-per-verdict через x402.
 *
 * POST /api/eaas/verdicts — x402-gated. Pipeline (order matters):
 *   1. validate body          → 400 без списания (битый запрос не оплачивается)
 *   2. rate limit             → 429 до settle (платный спам не сжигает compute)
 *   3. payment middleware     → 402 → settle (per-policy цена)
 *   4. issueVerdict           → signed artifact + persist
 *   Policy throw → reject verdict "evaluation-error:<code>" (fail-closed,
 *   платёж честно засеттлен — услуга «проверили, не прошло» оказана).
 *
 * GET /api/eaas/verdicts/:verdictId         — public artifact, free.
 * GET /api/eaas/verdicts/:verdictId/verify  — {valid, signer, chainId}, free.
 *   (артфакт самодостаточен: оффлайн-verify = ethers verifyTypedData over
 *    VERDICT_DOMAIN + VERDICT_TYPES, см. lib/eaas/verdict.ts)
 */

import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import type { Hex } from "viem";
import type { PolicyFn } from "../lib/eaas/policies";
import type { VerdictStoreBackend } from "../lib/eaas/store";
import {
  verifyVerdictSignature,
  type VerdictSigner,
} from "../lib/eaas/verdict";
import {
  issueVerdict,
  type EaasServiceDeps,
} from "../lib/eaas/index";
import {
  bad,
  consumerKey,
  createRateLimiter,
  EXPENSIVE_POLICIES,
  HEX32_RE,
  parseBody,
  type EaasVariables,
  type ParsedVerdictRequest,
} from "../lib/eaas/request";
import type { PaymentMiddleware } from "./identity";

export interface EaasRoutesDeps {
  /** Explicit-price payment middleware factory (CirclePaymentsRuntime.paymentForPrice). */
  paymentForPrice: (priceUsd: string) => PaymentMiddleware;
  /** Flat per-verdict price, "$x.xx" USDC. */
  verdictUsd: string;
  /** readiness-scan price override. */
  scanUsd: string;
  /** deliverable.data size cap (bytes). */
  maxBytes: number;
  /** Per-consumer + global requests/min cap. */
  rateRpm: number;
  /** EaasServiceDeps minus registry (or full override for tests). */
  signer: VerdictSigner;
  store: VerdictStoreBackend;
  registry?: Record<string, PolicyFn>;
  now?: () => Date;
}

/* --------------------------------- routes --------------------------------- */

export function createEaasRoutes(
  deps: EaasRoutesDeps,
): Hono<{ Variables: EaasVariables }> {
  const routes = new Hono<{ Variables: EaasVariables }>();
  const limiter = createRateLimiter(deps.rateRpm);

  const serviceDeps: EaasServiceDeps = {
    signer: deps.signer,
    store: deps.store,
    ...(deps.registry ? { registry: deps.registry } : {}),
    ...(deps.now ? { now: deps.now } : {}),
  };

  // Payment middleware per price tier — created lazily, cached.
  const paymentCache = new Map<string, PaymentMiddleware>();
  const paymentFor = (policy: string): PaymentMiddleware => {
    const price = EXPENSIVE_POLICIES.has(policy)
      ? deps.scanUsd
      : deps.verdictUsd;
    let mw = paymentCache.get(price);
    if (!mw) {
      mw = deps.paymentForPrice(price);
      paymentCache.set(price, mw);
    }
    return mw;
  };

  routes.post(
    "/api/eaas/verdicts",
    describeRoute({
      description:
        "Issue a signed EIP-712 verdict artifact for a deliverable (x402 pay-per-verdict)",
      responses: {
        200: { description: "Signed VerdictArtifact" },
        400: { description: "Invalid request (unknown policy, missing expectedHash, oversize data)" },
        402: { description: "Payment required (x402)" },
        429: { description: "Rate limit exceeded" },
      },
    }),
    async (c, next) => {
      const parsed = await parseBody(c, deps.maxBytes, deps.registry);
      if (parsed instanceof Response) return parsed;
      c.set("eaasReq", parsed);
      return next();
    },
    async (c, next) => {
      if (!limiter.allow(consumerKey(c))) {
        return c.json({ error: "rate limit exceeded" }, 429);
      }
      return next();
    },
    async (c, next) => {
      const req = c.get("eaasReq") as ParsedVerdictRequest;
      return paymentFor(req.policy)(c, next);
    },
    async (c) => {
      const req = c.get("eaasReq");
      const payment = c.get("payment");
      const result = await issueVerdict(
        {
          policy: req.policy,
          deliverable: req.deliverable,
          deliverableUri: req.deliverableUri,
          expectedHash: req.expectedHash,
          nonce: req.nonce,
          consumerWallet: payment?.payer,
          paymentTx: payment?.transaction,
        },
        serviceDeps,
      );
      return c.json({
        artifact: result.artifact,
        duplicate: result.duplicate,
        verifyUrl: `/api/eaas/verdicts/${result.artifact.verdictId}/verify`,
      });
    },
  );

  routes.get(
    "/api/eaas/verdicts/:verdictId",
    describeRoute({
      description: "Public read of a stored VerdictArtifact (free)",
      responses: {
        200: { description: "VerdictArtifact + evidence" },
        404: { description: "Not found" },
      },
    }),
    (c) => {
      const id = c.req.param("verdictId");
      if (!HEX32_RE.test(id)) return bad(c, "invalid verdictId");
      const stored = deps.store.get(id as Hex);
      if (!stored) return c.json({ error: "verdict not found" }, 404);
      return c.json(stored);
    },
  );

  routes.get(
    "/api/eaas/verdicts/:verdictId/verify",
    describeRoute({
      description:
        "Server-side signature check; artifact itself is self-verifiable offline via EIP-712",
      responses: {
        200: { description: "{valid, signer, chainId}" },
        404: { description: "Not found" },
      },
    }),
    (c) => {
      const id = c.req.param("verdictId");
      if (!HEX32_RE.test(id)) return bad(c, "invalid verdictId");
      const stored = deps.store.get(id as Hex);
      if (!stored) return c.json({ error: "verdict not found" }, 404);
      const valid = verifyVerdictSignature(stored.artifact);
      return c.json({
        valid,
        signer: stored.artifact.evaluator,
        chainId: stored.artifact.chainId,
      });
    },
  );

  return routes;
}
