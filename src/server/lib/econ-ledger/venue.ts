/**
 * SLICE-207-3: venue jobs (ERC-8183) → canonical events.
 *
 * Hook point: the `upsertJob` facade in ../venue/store.ts — every route
 * and the indexer funnel through it. Status→seq ordinals:
 *   funded→1  submitted→2  completed→3  rejected→4  expired→5
 * Re-upserts of the same status dedupe via the idempotency key.
 */

import type { BuildEventInput } from "@agentbadge/econ-events";
import type { EconLedgerStore } from "@agentbadge/database";
import type { VenueJob } from "../venue/store.js";
import { emitEconomicEvent } from "./emit.js";

const HEX32 = /^0x[0-9a-fA-F]{64}$/;

export const VENUE_SEQ = {
  funded: 1,
  submitted: 2,
  completed: 3,
  rejected: 4,
  expired: 5,
} as const;

/** Pure mapper — VenueJob status → canonical inputs (null = skip). */
export function venueJobToEconomic(job: VenueJob): BuildEventInput[] {
  const at = new Date().toISOString();
  const base = { source: "venue", sourceId: job.jobId, at };
  switch (job.status) {
    case "funded":
      return [
        {
          ...base,
          seq: VENUE_SEQ.funded,
          kind: "pay",
          actor: job.client,
          counterparty: job.provider,
          amountUsdc:
            typeof job.budgetUsdc === "number" ? String(job.budgetUsdc) : undefined,
          payload: {
            rail: "escrow",
            jobId: job.onchainJobId !== undefined ? String(job.onchainJobId) : undefined,
          },
        },
      ];
    case "submitted": {
      if (!job.provider) return [];
      const dh = job.deliverableHash;
      if (!dh || !HEX32.test(dh)) return [];
      return [
        {
          ...base,
          seq: VENUE_SEQ.submitted,
          kind: "deliver",
          actor: job.provider,
          counterparty: job.client,
          payload: { taskRef: job.jobId, deliverableHash: dh },
        },
      ];
    }
    case "completed":
      if (!job.provider) return [];
      return [
        {
          ...base,
          seq: VENUE_SEQ.completed,
          kind: "verify",
          actor: job.evaluator,
          counterparty: job.provider,
          payload: {
            taskRef: job.jobId,
            outcome: "pass",
            deliverableHash:
              job.deliverableHash && HEX32.test(job.deliverableHash)
                ? job.deliverableHash
                : undefined,
          },
        },
      ];
    case "rejected":
      if (!job.provider) return [];
      return [
        {
          ...base,
          seq: VENUE_SEQ.rejected,
          kind: "verify",
          actor: job.evaluator,
          counterparty: job.provider,
          payload: { taskRef: job.jobId, outcome: "fail" },
        },
      ];
    default:
      // open | expired — no economic fact (expired = refund path, out of v1)
      return [];
  }
}

/** Emit on job upsert — status-gated, idempotent by construction. */
export function emitVenueJob(
  job: VenueJob,
  ledger?: EconLedgerStore | null,
): void {
  for (const input of venueJobToEconomic(job)) {
    emitEconomicEvent(input, ledger);
  }
}
