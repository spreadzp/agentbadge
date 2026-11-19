/**
 * EPIC-226 / SLICE-226-2 — bridge from the EPIC-222 PaymentException
 * ops queue to the finops reconciliation queue: OPEN PaymentException
 * rows become ReconciliationException rows keyed by `rx_<source id>`
 * so re-runs never double-create.
 */

import { createHash } from "node:crypto";

import type { Database } from "@agentbadge/database";

import { MAX_ID_FIELD } from "./guards";
import { TYPE_BY_REASON, detectExceptions } from "./exceptions";
import {
  type DetectResult,
  type ExceptionCandidate,
  type FinOpsResult,
} from "./types";

/** N3: max rows one scan converts — keeps audit evidence bounded. */
const DETECT_SCAN_LIMIT = 100;
/** M-4: max source rows examined per scan call (escalating pages). */
const SCAN_BUDGET = 2000;

/**
 * The source `list` has no offset/cursor in the published store
 * contract, so a fixed `limit` window would starve rows beyond it
 * (every scan re-reads the same already-mirrored window). We page
 * with escalating limits until `limit` NEW rows are collected or the
 * source is exhausted, pre-filtering already-mirrored ids via the
 * `rx_<id>` key convention. SCAN_BUDGET bounds one pass at v1 volume.
 */
export async function detectFromPaymentExceptions(
  db: Database,
  opts: { sinceMs?: number; limit?: number } = {},
): Promise<FinOpsResult<DetectResult>> {
  // L4-4: a non-finite or negative limit silently disables the scan —
  // floor it to a positive integer before it reaches the store.
  const target =
    typeof opts.limit === "number" && Number.isFinite(opts.limit)
      ? Math.min(SCAN_BUDGET, Math.max(1, Math.floor(opts.limit)))
      : DETECT_SCAN_LIMIT;
  const mirrored = new Set(
    (await db.finops.exceptions.list({})).map((r) => r.id),
  );
  const candidates: ExceptionCandidate[] = [];
  // N6-8: a store that clamps `limit` returns overlapping pages —
  // dedupe SOURCE rows we've already candidate'd so re-reads can't
  // inflate the batch or the skipped count.
  const seen = new Set<string>();
  let requested = target;
  let prevLen = -1;
  for (;;) {
    const page = await db.payments.exceptions.list({
      status: "OPEN",
      sinceMs: opts.sinceMs,
      limit: requested,
    });
    for (const e of page) {
      if (candidates.length >= target) break;
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      // N5-7: `rx_<source id>` must never exceed MAX_ID_FIELD — an
      // over-long source id would fail the whole batch and starve
      // every later scan. Hash it deterministically; dedupe still
      // works because the same source row maps to the same key.
      const rxId =
        e.id.length + 3 <= MAX_ID_FIELD
          ? `rx_${e.id}`
          : `rx_${createHash("sha256").update(e.id).digest("hex").slice(0, 60)}`;
      if (mirrored.has(rxId)) continue; // already in the queue
      // N6-1: subjectRef is echoed into later audit evidence and
      // the pre-pass caps it — an over-long source id (e.g. the same
      // row that triggered the hash above) must be CLAMPED, not left
      // to fail the whole batch again. A row with NO usable reference
      // is skipped — one malformed row must never starve the scan.
      const subjectRef = (e.paymentId?.trim() || e.id.trim()).slice(
        0,
        MAX_ID_FIELD,
      );
      if (subjectRef === "") continue;
      // C4b: own-property check — `kind` values like "constructor" or
      // "__proto__" must not reach through the prototype chain.
      const type = Object.hasOwn(TYPE_BY_REASON, e.kind)
        ? TYPE_BY_REASON[e.kind]
        : undefined;
      if (type === undefined) {
        // Unknown kind — keep the work visible as a generic mismatch.
        candidates.push({
          id: rxId,
          type: "AMOUNT_MISMATCH",
          subjectRef,
          details: { source: "payment-exception", kind: e.kind, details: e.details },
        });
        continue;
      }
      if (type === null) continue; // REFUND_REQUEST — not reconciliation
      candidates.push({
        id: rxId,
        type,
        subjectRef,
        details: { source: "payment-exception", kind: e.kind, attemptId: e.attemptId, details: e.details },
      });
    }
    // Stop when the target is met, the source is exhausted, or the
    // scan budget is spent. `page.length < requested` alone does NOT
    // prove exhaustion — a store that silently clamps `limit` returns
    // a short page while more rows exist. Re-ask with the clamped
    // count once; an identical count twice means we have hit the
    // store's hard ceiling and cannot progress without offset
    // support (published-store limitation, shipped residual).
    if (candidates.length >= target || requested >= SCAN_BUDGET) {
      break;
    }
    if (page.length === 0 || page.length === prevLen) break;
    if (page.length < requested) {
      prevLen = page.length;
      requested = page.length;
      continue;
    }
    prevLen = page.length;
    requested = Math.min(requested * 2, SCAN_BUDGET);
  }
  return detectExceptions(db, candidates);
}
