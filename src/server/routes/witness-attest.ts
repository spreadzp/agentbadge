/**
 * SLICE-185-2 (EPIC-185): POST /api/v1/witness/jobs/:jobId/attest —
 * extracted from witness-api.ts for the 300-line cap (eaas-evaluate
 * registerXRoute pattern).
 *
 * Pipeline: COI → seat → duplicate → window → daily cap → sig → store.
 * Response contains only the caller's own attestation (D-185-8 —
 * witnesses never see each other before/after submission here).
 */
import type { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { errorResponse } from "../lib/error-response";
import { ErrorCodes } from "../lib/error-codes";
import {
  buildWitnessPayload,
  checkDailyCap,
  utcDayKey,
  validateAttestWindow,
  verifyWitnessSignature,
} from "../lib/witness/attest";
import {
  enrolledWitness,
  jobGate,
  witnessGate,
  type WitnessRoutesDeps,
} from "../lib/witness/route-gates";
import {
  WITNESS_REASON_MAX,
  type WitnessAttestation,
} from "../lib/witness/store";

const SHA256_RE = /^0x[0-9a-fA-F]{64}$/;
// EOA-only: EIP-191 personal_sign is 65 bytes. Contract-wallet
// (EIP-1271) signatures can be longer — they'd need a different check.
const SIG_RE = /^0x[0-9a-fA-F]{130}$/;
const VERDICTS = new Set(["pass", "fail", "inconclusive"]);
// M-2: reasons are stored verbatim and later rendered — reject C0/C1
// control chars and bidi-override sequences (display injection).
const REASON_CTRL_RE = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/;

export function registerWitnessAttestRoute(
  routes: Hono,
  deps: WitnessRoutesDeps,
): void {
  routes.post(
    "/api/v1/witness/jobs/:jobId/attest",
    describeRoute({
      description:
        "Submit an EIP-191 signed witness attestation for a seated job. " +
        "Pipeline: COI → seat → duplicate → window → daily cap → sig → store.",
      responses: {
        201: { description: "Attestation recorded (own record only — D-185-8)" },
        400: { description: "Bad signature or malformed body" },
        401: { description: "Missing/invalid agb_ key" },
        404: { description: "Job not found" },
        409: { description: "COI / no seat / duplicate / window closed / not delivered" },
        429: { description: "Daily attest cap reached" },
        503: { description: "Witness layer disabled" },
      },
    }),
    async (c) => {
      if (!deps.enabled)
        return errorResponse(c, 503, ErrorCodes.WITNESS_DISABLED, "witness layer is disabled", { retryable: true });
      const reg = await witnessGate(c, deps);
      if (reg instanceof Response) return reg;
      const enroll = await enrolledWitness(c, deps, reg.agentId);
      if (enroll instanceof Response) return enroll;

      let body: {
        verdict?: string;
        contentSha256?: string;
        reason?: string;
        signature?: string;
      };
      try {
        body = await c.req.json();
      } catch {
        return errorResponse(c, 400, ErrorCodes.INVALID_JSON, "invalid JSON");
      }
      const verdict = String(body.verdict ?? "") as WitnessAttestation["verdict"];
      const contentSha256 = String(body.contentSha256 ?? "");
      const reason = String(body.reason ?? "");
      const signature = String(body.signature ?? "");
      if (
        !VERDICTS.has(verdict) ||
        !SHA256_RE.test(contentSha256) ||
        reason.trim().length === 0 ||
        reason.length > WITNESS_REASON_MAX ||
        REASON_CTRL_RE.test(reason) ||
        !SIG_RE.test(signature)
      ) {
        return errorResponse(
          c,
          400,
          ErrorCodes.INVALID_INPUT,
          "verdict∈{pass,fail,inconclusive}; contentSha256=0x+64hex; reason=1-280ch printable; signature=0x+130hex",
          { charged: false },
        );
      }

      const jobId = c.req.param("jobId");
      const job = await jobGate(c, deps, jobId, reg.agentId, enroll.wallet);
      if (job instanceof Response) return job;

      const seat = (await deps.store.listSeats(jobId)).find(
        (s) => s.agentId === reg.agentId && s.claimed,
      );
      if (!seat)
        return errorResponse(c, 409, ErrorCodes.WITNESS_NO_SEATS, "no claimed seat — POST .../seat first", { charged: false });
      if (await deps.store.getAttestation(jobId, reg.agentId))
        return errorResponse(c, 409, ErrorCodes.WITNESS_DUPLICATE, "job already attested by this witness", { charged: false });

      const window = validateAttestWindow(job, deps.windowSec);
      if (window === "not_delivered")
        return errorResponse(c, 409, ErrorCodes.WITNESS_NOT_DELIVERED, "job has no delivered artifact yet", { charged: false });
      if (window === "closed")
        return errorResponse(c, 409, ErrorCodes.WITNESS_WINDOW_CLOSED, "attest window is closed", { charged: false });
      // N-5: capture the day key once — a request straddling UTC midnight
      // must credit one bucket, not split across two days.
      const dayKey = utcDayKey();
      if (!(await checkDailyCap(deps.store, reg.agentId, deps.dailyCap, dayKey)))
        return errorResponse(c, 429, ErrorCodes.WITNESS_DAILY_CAP, "daily witness attest cap reached", {
          charged: false,
          retryable: true,
          hint: "Credits reset at UTC midnight — retry tomorrow.",
        });

      const payload = buildWitnessPayload({
        jobId,
        agentId: reg.agentId,
        verdict,
        contentSha256,
        reason,
      });
      const ok = await verifyWitnessSignature(
        payload,
        signature as `0x${string}`,
        enroll.wallet,
      );
      if (!ok)
        return errorResponse(c, 400, ErrorCodes.WITNESS_BAD_SIGNATURE, "signature does not recover to the enrolled wallet", { charged: false });

      const attestation: WitnessAttestation = {
        jobId,
        agentId: reg.agentId,
        verdict,
        // N-3: normalize at rest — the signed payload lowercases, so the
        // stored form matches what a verifier rebuilds.
        contentSha256: contentSha256.toLowerCase() as `0x${string}`,
        reason,
        attestedAt: new Date().toISOString(),
        signature: signature as `0x${string}`,
      };
      // H-2: the window deadline is re-enforced inside the store's atomic
      // region — a request that started inside the window can't land an
      // attestation after it closes.
      const notAfterMs = (job.deliveredAt ?? 0) + deps.windowSec * 1000;
      if (
        !(await deps.store.putAttestation(attestation, { notAfterMs }))
      ) {
        if (Date.now() >= notAfterMs)
          return errorResponse(c, 409, ErrorCodes.WITNESS_WINDOW_CLOSED, "attest window is closed", { charged: false });
        return errorResponse(c, 409, ErrorCodes.WITNESS_DUPLICATE, "job already attested by this witness", { charged: false });
      }
      return c.json({ attestation }, 201);
    },
  );
}
