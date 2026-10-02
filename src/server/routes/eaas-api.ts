/**
 * SLICE-154-2: Standalone verdict API — pay-per-verdict через x402.
 *
 * POST /api/eaas/verdicts — x402-gated. Pipeline (order matters):
 *   1. validate body          → 400 без списания (битый запрос не оплачивается)
 *   2. rate limit             → 429 до settle (платный спам не сжигает compute)
 *   3. payment middleware     → 402 → settle (per-policy цена)
 *   4. issueVerdict           → signed artifact + persist
 *   Policy throw → reject verdict "evaluation-error:<code>" (fail-closed).
 * GET /api/eaas/verdicts/:verdictId         — public artifact, free.
 * GET /api/eaas/verdicts/:verdictId/verify  — {valid, signer, chainId}, free.
 */

import { Hono, type Context } from "hono";
import { describeRoute } from "hono-openapi";
import type { Hex } from "viem";
import type { PolicyFn } from "../lib/eaas/policies";
import type { VerdictStoreBackend } from "../lib/eaas/store";
import {
  verifyVerdictSignature,
  type VerdictSigner,
} from "../lib/eaas/verdict";
import type {
  AnchorStore,
  FindAnchorFn,
  VerdictAnchorer,
} from "../lib/eaas/anchor";
import {
  eaasQuotaGate,
  type EaasQuotaDeps,
} from "../lib/eaas/subscription";
import {
  respondAsync,
  type EaasAsyncDeps,
} from "../lib/eaas/requests";
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
  /**
   * SLICE-154-4: memo anchoring — absent = anchor fields omitted from
   * verify responses (feature off). enqueue is forwarded into the
   * verdict service so issued artifacts anchor asynchronously.
   */
  anchor?: {
    anchorer: Pick<VerdictAnchorer, "enqueue">;
    store: AnchorStore;
    find: FindAnchorFn;
    explorerTx?: (txHash: string) => string;
  };
  /**
   * SLICE-154-5: subscription quota gate — absent = x402-only (feature off).
   * Valid wallet-sig + CLASS_EAAS pass + live sub → quota path, no payment.
   */
  quota?: EaasQuotaDeps;
  /**
   * SLICE-154-6: async request delivery — absent = async:true rejected 400.
   * Requests ride the same quota/x402 gate; payment settles upfront, then
   * the verdict runs in the background (202 + statusUrl + webhook).
   */
  async_?: EaasAsyncDeps;
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
    ...(deps.anchor ? { anchorer: deps.anchor.anchorer } : {}),
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
    eaasQuotaGate({
      quota: deps.quota,
      policy: (c) => (c.get("eaasReq") as ParsedVerdictRequest).policy,
      fallback: async (c, next) =>
        paymentFor((c.get("eaasReq") as ParsedVerdictRequest).policy)(c, next),
    }),
    async (c) => {
      const req = c.get("eaasReq");
      const payment = c.get("payment");
      const run = () =>
        issueVerdict(
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
        ).then((r) => r.artifact);

      // SLICE-154-6: async mode — payment already settled; run in bg.
      const early = respondAsync(c, deps.async_, {
        isAsync: req.async,
        kind: "verdict",
        ...(payment?.payer ? { wallet: payment.payer } : {}),
        ...(req.webhookUrl ? { webhookUrl: req.webhookUrl } : {}),
        run,
      });
      if (early) return early;

      const t0 = Date.now();
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
      deps.async_?.metrics.observeVerdict(Date.now() - t0);
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

  // SLICE-154-4: public verify — offline signature + onchain memo anchor.
  // Rate-limited: it's an unauthenticated "facade of trust" for third parties.
  const verifyHandler = async (c: Context<{ Variables: EaasVariables }>) => {
    if (!limiter.allow(`verify:${consumerKey(c)}`)) {
      return c.json({ error: "rate limit exceeded" }, 429);
    }
    const id = c.req.param("verdictId") ?? "";
    if (!HEX32_RE.test(id)) return bad(c, "invalid verdictId");
    const stored = deps.store.get(id as Hex);
    if (!stored) return c.json({ error: "verdict not found" }, 404);
    const signatureValid = verifyVerdictSignature(stored.artifact);

    const anchor: Record<string, unknown> = {
      found: false,
      contextMatches: false,
      status: "none",
    };
    let explorerUrl: string | undefined;
    if (deps.anchor) {
      const rec = deps.anchor.store.get(id as Hex);
      anchor.status = rec?.status ?? "none";
      const txHash = rec?.txHash;
      let hit = null;
      if (rec) {
        try {
          hit = await deps.anchor.find(rec.memoId);
        } catch {
          hit = null; // RPC hiccup → report found:false, never 5xx
        }
      }
      if (rec) anchor.memoId = rec.memoId;
      if (hit || txHash) {
        anchor.found = hit != null || rec?.status === "anchored";
        anchor.txHash = hit?.txHash ?? txHash;
        anchor.contextMatches = hit ? hit.memoData === rec?.artifactHash : false;
        if (hit?.blockTime !== undefined) anchor.blockTime = hit.blockTime;
        const tx = (hit?.txHash ?? txHash) as string | undefined;
        if (tx && deps.anchor.explorerTx) explorerUrl = deps.anchor.explorerTx(tx);
      }
    }

    return c.json({
      valid: signatureValid,
      signatureValid,
      signer: stored.artifact.evaluator,
      chainId: stored.artifact.chainId,
      anchor,
      ...(explorerUrl ? { explorerUrl } : {}),
    });
  };

  routes.get(
    "/api/eaas/verdicts/:verdictId/verify",
    describeRoute({
      description:
        "Verify a VerdictArtifact: offline EIP-712 signature check + onchain memo anchor lookup (public, rate-limited)",
      responses: {
        200: { description: "{signatureValid, signer, chainId, anchor, explorerUrl?}" },
        404: { description: "Not found" },
        429: { description: "Rate limit exceeded" },
      },
    }),
    verifyHandler,
  );

  // Spec-named alias — same handler.
  routes.get(
    "/api/eaas/verify/:verdictId",
    describeRoute({
      description: "Alias of /api/eaas/verdicts/:verdictId/verify",
      responses: {
        200: { description: "{signatureValid, signer, chainId, anchor, explorerUrl?}" },
        404: { description: "Not found" },
        429: { description: "Rate limit exceeded" },
      },
    }),
    verifyHandler,
  );

  return routes;
}
