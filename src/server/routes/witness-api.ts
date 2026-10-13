/**
 * SLICE-185-2 (EPIC-185): witness API — enroll / seat / me.
 * (attest lives in witness-attest.ts — registerXRoute pattern for the
 * 300-line cap; shared gates in lib/witness/route-gates.ts)
 *
 *   POST /api/v1/witness/enroll                — keyed (184) enroll
 *   POST /api/v1/witness/jobs/:jobId/seat      — claim a seat (≤2/job)
 *   GET  /api/v1/witness/me                    — enroll + today credits
 *
 * Every refusal is charged:false (181 no-charge semantics — these
 * endpoints are free).
 */
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { errorResponse } from "../lib/error-response";
import { ErrorCodes } from "../lib/error-codes";
import { enrollWitness } from "../lib/witness/enroll";
import { utcDayKey } from "../lib/witness/attest";
import {
  enrolledWitness,
  jobGate,
  witnessGate,
  type WitnessRoutesDeps,
} from "../lib/witness/route-gates";
import { registerWitnessAttestRoute } from "./witness-attest";
import type { WitnessEnroll } from "../lib/witness/store";

export type { WitnessRoutesDeps } from "../lib/witness/route-gates";

const publicEnroll = (r: WitnessEnroll) => ({
  agentId: r.agentId,
  domains: r.domains,
  wallet: r.wallet,
  enrolledAt: r.enrolledAt,
  status: r.status,
});

const disabled = (deps: WitnessRoutesDeps) => !deps.enabled;

export function createWitnessRoutes(deps: WitnessRoutesDeps): Hono {
  const routes = new Hono();

  /* ------------------------------- enroll ------------------------------- */

  routes.post(
    "/api/v1/witness/enroll",
    describeRoute({
      description:
        "Enroll the authenticated agent as a witness — declares domains " +
        "and the EIP-191 signing wallet (immutable afterwards).",
      responses: {
        201: { description: "Witness enrollment record" },
        400: { description: "Invalid domains or wallet" },
        401: { description: "Missing/invalid agb_ key" },
        409: { description: "Already enrolled" },
        503: { description: "Witness layer disabled" },
      },
    }),
    async (c) => {
      if (disabled(deps))
        return errorResponse(c, 503, ErrorCodes.WITNESS_DISABLED, "witness layer is disabled", { retryable: true });
      const reg = await witnessGate(c, deps);
      if (reg instanceof Response) return reg;

      let body: { domains?: string[]; wallet?: string };
      try {
        body = await c.req.json();
      } catch {
        return errorResponse(c, 400, ErrorCodes.INVALID_JSON, "invalid JSON");
      }
      const res = await enrollWitness(deps.store, {
        agentId: reg.agentId,
        domains: Array.isArray(body.domains) ? body.domains : [],
        wallet: String(body.wallet ?? ""),
      });
      if (!res.ok) {
        const map = {
          witness_invalid_domains: [400, ErrorCodes.WITNESS_INVALID_DOMAINS, "domains must be 1-8 of scan|code|data|generic"],
          witness_invalid_wallet: [400, ErrorCodes.WITNESS_INVALID_WALLET, "wallet must be a valid EVM address"],
          witness_already_enrolled: [409, ErrorCodes.WITNESS_ALREADY_ENROLLED, "agent is already enrolled; wallet is immutable"],
        } as const;
        const [status, code, msg] = map[res.code];
        return errorResponse(c, status, code, msg, { charged: false });
      }
      return c.json({ enrollment: publicEnroll(res.record) }, 201);
    },
  );

  /* -------------------------------- seat -------------------------------- */

  routes.post(
    "/api/v1/witness/jobs/:jobId/seat",
    describeRoute({
      description:
        "Claim a witness seat for a delivered job (≤2/job, attest window " +
        "opens at delivery + WITNESS_WINDOW_SEC). Idempotent per agent.",
      responses: {
        200: { description: "Seat already held (idempotent replay)" },
        201: { description: "Seat claimed" },
        401: { description: "Missing/invalid agb_ key" },
        404: { description: "Job not found" },
        409: { description: "opt-out / COI / not delivered / window closed / no seats" },
        503: { description: "Witness layer disabled" },
      },
    }),
    async (c) => {
      if (disabled(deps))
        return errorResponse(c, 503, ErrorCodes.WITNESS_DISABLED, "witness layer is disabled", { retryable: true });
      const reg = await witnessGate(c, deps);
      if (reg instanceof Response) return reg;
      const enroll = await enrolledWitness(c, deps, reg.agentId);
      if (enroll instanceof Response) return enroll;

      const jobId = c.req.param("jobId");
      const job = await jobGate(c, deps, jobId, reg.agentId, enroll.wallet);
      if (job instanceof Response) return job;

      if (!job.deliveredAt)
        return errorResponse(
          c,
          409,
          ErrorCodes.WITNESS_NOT_DELIVERED,
          "job has no delivered artifact yet — attest window not open",
          { charged: false },
        );
      const expiresAt = job.deliveredAt + deps.windowSec * 1000;
      const res = await deps.store.claimSeat(jobId, reg.agentId, expiresAt);
      switch (res) {
        case "claimed": {
          const seats = await deps.store.listSeats(jobId);
          return c.json({ seat: seats.find((s) => s.agentId === reg.agentId) }, 201);
        }
        case "already_seated": {
          const seats = await deps.store.listSeats(jobId);
          return c.json({ seat: seats.find((s) => s.agentId === reg.agentId) }, 200);
        }
        case "already_attested":
          return errorResponse(c, 409, ErrorCodes.WITNESS_DUPLICATE, "job already attested by this witness", { charged: false });
        case "window_closed":
          return errorResponse(c, 409, ErrorCodes.WITNESS_WINDOW_CLOSED, "attest window is closed", { charged: false });
        default:
          return errorResponse(c, 409, ErrorCodes.WITNESS_NO_SEATS, "all witness seats for this job are claimed", { charged: false });
      }
    },
  );

  /* -------------------------------- attest ------------------------------ */

  registerWitnessAttestRoute(routes, deps);

  /* --------------------------------- me --------------------------------- */

  routes.get(
    "/api/v1/witness/me",
    describeRoute({
      description: "Witness enrollment + today's attestation credit usage.",
      responses: {
        200: { description: "Enrollment state (enrolled:false when absent)" },
        401: { description: "Missing/invalid agb_ key" },
      },
    }),
    async (c) => {
      const reg = await witnessGate(c, deps);
      if (reg instanceof Response) return reg;
      const enroll = await deps.store.getEnroll(reg.agentId);
      if (!enroll) return c.json({ enrolled: false }, 200);
      const used = await deps.store.getDailyCredits(reg.agentId, utcDayKey());
      return c.json(
        {
          enrolled: true,
          enrollment: publicEnroll(enroll),
          credits: { used, cap: deps.dailyCap, day: utcDayKey() },
        },
        200,
      );
    },
  );

  return routes;
}
