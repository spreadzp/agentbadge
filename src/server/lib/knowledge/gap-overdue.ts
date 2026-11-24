import { generateReportId } from "../../../agent-readiness/integrity/ulid";

/**
 * EPIC-264 (SLICE-264-13, C8): durable overdue-breach records —
 * the FACT a deadline was breached, persisted by the sweeper
 * independent of console visits. Types shared by the store
 * contract, both backends, and the sweeper.
 *
 * (gapId, dueAt) is the breach generation: a deadline that moves
 * forward after a breach records a NEW row, not a refresh of the
 * old one — "deadline repaired" is a distinct signal from "never
 * breached".
 */

/** The stored breach row — one per (gapId, dueAt) generation. */
export interface KnowledgeGapOverdueRecord {
  id: string;
  gapId: string;
  /** The breached deadline (part of the unique key). */
  dueAt: string;
  /** The sweeper tick that caught it. */
  detectedAt: string;
  /** NULL = recorded, emit pending — the kill-safe catch-up mark. */
  emittedAt: string | null;
}

/** Breach-row write shape — `detectedAt` omitted → the WRITER
 *  stamps it (same honest-clock rule as the audit rows). */
export interface KnowledgeGapOverdueInsert {
  id: string;
  gapId: string;
  dueAt: string;
  detectedAt?: string;
}

/** Pending-emit projection — the durable-intent drain set
 *  (`emittedAt IS NULL`). Gap fields join current state; the row
 *  is the fact — a gap that left the due set (RESOLVED, deadline
 *  moved) still owes its signal. Nulls if the gap row vanished. */
export interface KnowledgeGapOverduePending {
  id: string;
  gapId: string;
  /** The breached deadline — NOT the gap's current dueAt. */
  dueAt: string;
  normalizedQuery: string | null;
  count: number | null;
}

/** kgo_<ulid> — ULID keeps same-ms writes sortable under a
 *  time-keyed index (the 264-11 gapEventId lesson). */
export const gapOverdueId = () => `kgo_${generateReportId()}`;
