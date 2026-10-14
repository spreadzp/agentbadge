/**
 * SLICE-185-2 (EPIC-185): shared gates for the witness routes —
 * extracted from routes/witness-api.ts for the 300-line lint cap.
 *
 * gate           → Bearer agb_ → active AgentRegistration (401 else)
 * enrolledWitness → active WitnessEnroll for that agentId (409 else)
 * jobGate        → WitnessJobRef, with opt-out + COI refusals (404/409)
 *
 * Every refusal carries charged:false — witness endpoints are free
 * (181 no-charge semantics).
 */
import type { Context } from "hono";
import { errorResponse } from "../error-response";
import { ErrorCodes } from "../error-codes";
import { meGate } from "../agent-registration/me-gate";
import type {
  AgentRegistration,
  AgentRegistrationStore,
} from "../agent-registration/store";
import { checkCoi } from "./attest";
import type { WitnessJobRef } from "./jobs";
import type { WitnessEnroll, WitnessStore } from "./store";
import type { WitnessAnchorer } from "./anchor";
import type { WitnessRepSink } from "./rep-bridge";

export interface WitnessRoutesDeps {
  /** WITNESS_ENABLED — POSTs answer 503 when off (fail honest). */
  enabled: boolean;
  store: WitnessStore;
  registrationStore: AgentRegistrationStore;
  /** Job projection for COI/window/opt-out — producer feeds witness-jobs. */
  getJob: (
    jobId: string,
  ) => Promise<WitnessJobRef | undefined> | WitnessJobRef | undefined;
  /** WITNESS_WINDOW_SEC — attest window after delivery (default 3600). */
  windowSec: number;
  /** WITNESS_DAILY_CAP — attest credits per agent per UTC day. */
  dailyCap: number;
  /**
   * WITNESS_SEAT_DAILY_CAP — successful seat claims per agent per UTC
   * day (185-6 audit H-1: open enrollment + 2 free seats/job lets two
   * sybils monopolize every job). Defaults to dailyCap when unset.
   */
  seatDailyCap?: number;
  /**
   * SLICE-185-4: rep emit sink (188 seam). Undefined → no-op. Failures
   * are logged, never break the 201 (fire-and-forget, D-185-6).
   */
  repSink?: WitnessRepSink;
  /**
   * SLICE-185-4: memo anchorer (WITNESS_ANCHOR_ENABLED, D-185-7).
   * Undefined → zero memo calls.
   */
  anchorer?: WitnessAnchorer;
}

/** Bearer agb_ → active registration; Response means already sent 401. */
export async function witnessGate(
  c: Context,
  deps: WitnessRoutesDeps,
): Promise<AgentRegistration | Response> {
  return meGate(c, deps.registrationStore);
}

/** Shared enroll precondition for seat/attest. Returns enroll or Response. */
export async function enrolledWitness(
  c: Context,
  deps: WitnessRoutesDeps,
  agentId: string,
): Promise<WitnessEnroll | Response> {
  const enroll = await deps.store.getEnroll(agentId);
  if (!enroll)
    return errorResponse(
      c,
      409,
      ErrorCodes.WITNESS_NOT_ENROLLED,
      "agent is not enrolled as a witness",
      { charged: false, hint: "POST /api/v1/witness/enroll first" },
    );
  if (enroll.status !== "active")
    return errorResponse(
      c,
      409,
      ErrorCodes.WITNESS_SUSPENDED,
      "witness enrollment is suspended",
      { charged: false },
    );
  return enroll;
}

/** Shared job lookup + opt-out + COI gate. Returns job or Response. */
export async function jobGate(
  c: Context,
  deps: WitnessRoutesDeps,
  jobId: string,
  agentId: string,
  wallet: string,
): Promise<WitnessJobRef | Response> {
  const job = await deps.getJob(jobId);
  if (!job)
    return errorResponse(
      c,
      404,
      ErrorCodes.WITNESS_JOB_NOT_FOUND,
      "job not found",
      { charged: false },
    );
  if (job.witnessAllowed === false)
    return errorResponse(
      c,
      409,
      ErrorCodes.WITNESS_OPT_OUT,
      "buyer opted this job out of witness attestations",
      { charged: false },
    );
  if (checkCoi(job, agentId, wallet))
    return errorResponse(
      c,
      409,
      ErrorCodes.WITNESS_CONFLICT,
      "witness conflicts with a job participant (requester/buyer/evaluator)",
      { charged: false },
    );
  return job;
}
