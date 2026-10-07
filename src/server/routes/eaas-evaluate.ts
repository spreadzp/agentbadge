/**
 * SLICE-154-3/181-2: POST /api/eaas/jobs/evaluate — extracted from
 * eaas-jobs-api.ts (300-line cap).
 *
 * Guard order: validate (400) → rate-limit (429) → allowlist (403) →
 * idempotent replay (free) → payment → evaluate.
 *
 * SLICE-181-2 (D-181-3): when deps.seamTwoPhase is wired the x402 path
 * verifies first and settles only after a successful evaluation — refusal
 * paths answer charged:false (and refund self-settled payments) instead
 * of keeping the fee. Atomic middleware fallback when no seam is given.
 */

import type { Context, Hono } from "hono";
import { describeRoute } from "hono-openapi";
import {
  EvaluatorError,
  Erc8183Error,
} from "@agentbadge/circle-payments";
import {
  evalJobKey,
  evaluateExternalJob,
  GasCapError,
} from "../lib/eaas/eval";
import {
  consumerKey,
  createRateLimiter,
} from "../lib/eaas/request";
import { eaasQuotaGate } from "../lib/eaas/subscription";
import { respondAsync } from "../lib/eaas/requests";
import { validateEvaluate, type EvalInput } from "../lib/eaas/eval-request";
import { bazaarExtensionFor } from "../lib/service-catalog/bazaar";
import type {
  EaasJobsRoutesDeps,
  EaasJobsVariables,
} from "./eaas-jobs-api";

export function registerEvaluateRoute(
  routes: Hono<{ Variables: EaasJobsVariables }>,
  deps: EaasJobsRoutesDeps,
): void {
  const limiter = createRateLimiter(deps.rateRpm);
  const evalPay = deps.paymentForPrice(deps.evalUsd, {
    extensions: bazaarExtensionFor("eaas:jobs-evaluate"),
  });

  routes.post(
    "/api/eaas/jobs/evaluate",
    describeRoute({
      tags: ["EaaS Jobs"],
      summary:
        "Evaluate + settle an allowlisted ERC-8183 job (x402-gated; refusal = no charge)",
      responses: { 200: { description: "Verdict + artifact" } },
    }),
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
    eaasQuotaGate({
      quota: deps.quota,
      policy: (c) => (c.get("evalInput") as EvalInput).policy,
      fallback: async (c, next) => {
        if (!deps.seamTwoPhase) return evalPay(c, next);
        const handle = await deps.seamTwoPhase(c);
        if (!handle) {
          return c.json({ error: "payment required" }, 402);
        }
        c.set("paymentHandle", handle);
        c.set("payment", {
          payer: handle.payer,
          ...(handle.selfSettled
            ? { transaction: handle.selfSettled.tx }
            : {}),
        });
        return next();
      },
    }),
    async (c: Context) => {
      const input = c.get("evalInput") as EvalInput;
      const payment = c.get("payment");
      const handle = c.get("paymentHandle");
      const payer = handle?.payer ?? payment?.payer;
      const mkInput = (paymentTx?: string) => ({
        contract: input.rec,
        jobId: input.jobId,
        policy: input.policy,
        expectedHash: input.expectedHash,
        deliverableUri: input.deliverableUri,
        consumerWallet: payer,
        paymentTx: paymentTx ?? handle?.selfSettled?.tx ?? payment?.transaction,
      });

      // SLICE-154-6 async: payment must be taken before the 202 — on the
      // two-phase path commit() settles now; refusal is unavailable once
      // the job is dispatched (documented: async = charged-at-accept).
      if (input.async && handle) {
        try {
          await handle.commit();
        } catch {
          return c.json({ error: "payment required" }, 402);
        }
      }

      const early = respondAsync(c, deps.async_, {
        isAsync: input.async,
        kind: "job-eval",
        ...(payer ? { wallet: payer } : {}),
        ...(input.webhookUrl ? { webhookUrl: input.webhookUrl } : {}),
        run: () =>
          evaluateExternalJob(mkInput(), deps).then((r) => {
            if (!r.artifact) {
              throw new Error("evaluation produced no artifact");
            }
            return r.artifact;
          }),
      });
      if (early) return early;

      try {
        const result = await evaluateExternalJob(mkInput(), deps);
        // Work succeeded → settle the verified payment (two-phase path).
        if (handle) {
          try {
            await handle.commit();
          } catch {
            return c.json({ error: "payment required" }, 402);
          }
        }
        return c.json({
          verdict: result.verdict,
          artifact: result.artifact,
          ...(result.feedbackTx ? { feedbackTx: result.feedbackTx } : {}),
        });
      } catch (e) {
        // D-181-3: refusal paths never charge on the two-phase path.
        const fail = (
          msg: string,
          code: "policy_refusal" | "execution_failed",
          status: 409 | 502,
        ) =>
          handle ? handle.refuse(code, msg) : c.json({ error: msg }, status);
        if (e instanceof EvaluatorError) {
          return fail(e.message, "policy_refusal", 409);
        }
        if (e instanceof GasCapError) {
          return fail(e.message, "execution_failed", 502);
        }
        if (e instanceof Erc8183Error) {
          return fail(`settlement failed: ${e.message}`, "execution_failed", 502);
        }
        throw e;
      }
    },
  );
}
