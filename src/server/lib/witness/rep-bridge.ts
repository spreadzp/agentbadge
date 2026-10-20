/**
 * SLICE-185-4 (EPIC-185): reputation bridge — emit-only seam to the
 * future 188 reputation layer.
 *
 * D-185-6: attest-flow emits `witness.attested` / `witness.agreement` /
 * `witness.disagreement` through this interface. v1 ships a structured-
 * log sink only; the 188 implementer swaps in a real sink via wiring
 * without touching the route code. Emit is fire-and-forget — a failing
 * sink logs a warning and MUST NOT fail the 201 response.
 *
 * Scoring policy (bronze cap, honest-zero) belongs to 188 — this module
 * is deliberately policy-free transport.
 */
import { logger } from "@agentbadge/passport/logger";

/** Rep events the witness layer can emit (D-185-6). */
export type WitnessRepEvent =
  | "witness.attested"
  | "witness.agreement"
  | "witness.disagreement";

export interface WitnessRepSignal {
  agentId: string;
  jobId: string;
  /** ms epoch of the attestation. */
  at: number;
  /** The witness's own verdict — the sink maps it to rep semantics. */
  verdict: "pass" | "fail" | "inconclusive";
}

export interface WitnessRepSink {
  emit(event: WitnessRepEvent, signal: WitnessRepSignal): void;
}

/**
 * v1 sink: structured log line. Keeps the seam observable in prod logs
 * until 188 lands a real reputation writer.
 */
export function createLogRepSink(): WitnessRepSink {
  return {
    emit(event, signal) {
      logger.info("witness rep signal", { event, ...signal });
    },
  };
}

/**
 * Fire-and-forget emit. Wraps sync AND async sink failures so a broken
 * rep backend can never break the attest route.
 */
export function emitRep(
  sink: WitnessRepSink | undefined,
  event: WitnessRepEvent,
  signal: WitnessRepSignal,
): void {
  if (!sink) return;
  try {
    const r = sink.emit(event, signal) as unknown;
    // A sink may return a promise even though the interface is sync-typed —
    // attach a rejection guard so an async throw can't become unhandled.
    if (r && typeof (r as Promise<void>).catch === "function") {
      void (r as Promise<void>).catch((e) =>
        logger.warn("witness rep emit failed (async)", {
          event,
          err: e instanceof Error ? e.message : String(e),
        }),
      );
    }
  } catch (e) {
    logger.warn("witness rep emit failed", {
      event,
      err: e instanceof Error ? e.message : String(e),
    });
  }
}

/**
 * Post-attestation rep dispatch. Compares the witness verdict with the
 * job's evaluator verdict — agreement/disagreement events feed 188's
 * accuracy scoring once it exists. evaluatorVerdict may be absent on
 * early reads (job projected without a verdict yet) → only `attested`.
 */
export function emitAttestRep(
  sink: WitnessRepSink | undefined,
  input: {
    agentId: string;
    jobId: string;
    verdict: "pass" | "fail" | "inconclusive";
    evaluatorVerdict?: string;
  },
): void {
  const at = Date.now();
  const base = {
    agentId: input.agentId,
    jobId: input.jobId,
    at,
    verdict: input.verdict,
  };
  emitRep(sink, "witness.attested", base);
  if (input.evaluatorVerdict === undefined) return;
  emitRep(
    sink,
    input.evaluatorVerdict === input.verdict
      ? "witness.agreement"
      : "witness.disagreement",
    base,
  );
}
