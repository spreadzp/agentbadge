/**
 * Event ledger for webhook idempotency.
 *
 * SLICE-84-4: Stripe webhook idempotency ledger.
 *
 * Provides claim/release/done semantics so that webhook retries
 * are safe — a transient fulfillment failure can never mint a
 * passport twice.
 *
 * Keyed by event.id with a secondary unique index on session.id
 * so that even a replayed event with a new event.id but the same
 * session.id is deduplicated.
 *
 * In-memory + persisted JSON snapshot acceptable pre-scale.
 */

type LedgerState = "claimed" | "released" | "done";

interface LedgerEntry {
  eventId: string;
  sessionId: string;
  state: LedgerState;
  attempts: number;
  lastError?: string;
  alerted?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface IdempotencyResult {
  fulfilled: boolean;
  deduped: boolean;
  error?: string;
}

export interface IdempotencyOptions {
  alertThreshold?: number;
  onAlert?: (info: { eventId: string; sessionId: string; attempts: number; lastError: string }) => void;
}

const DEFAULT_ALERT_THRESHOLD = 3;

export class EventLedger {
  private entries = new Map<string, LedgerEntry>();
  private sessionIndex = new Map<string, string>(); // session.id → eventId

  claimEvent(eventId: string, sessionId: string): boolean {
    const existing = this.entries.get(eventId);

    if (existing) {
      if (existing.state === "done") return false;
      if (existing.state === "claimed") {
        return false;
      }
      // State is "released" — retry allowed
      existing.state = "claimed";
      existing.attempts++;
      existing.updatedAt = Date.now();
      return true;
    }

    // Check session index for cross-event dedup
    const existingEventId = this.sessionIndex.get(sessionId);
    if (existingEventId) {
      const sessionEntry = this.entries.get(existingEventId);
      if (sessionEntry) {
        if (sessionEntry.state === "done") return false;
        if (sessionEntry.state === "claimed") return false;
        // Released — allow retry via the original event ID
        sessionEntry.state = "claimed";
        sessionEntry.attempts++;
        sessionEntry.updatedAt = Date.now();
        return true;
      }
    }

    const now = Date.now();
    const entry: LedgerEntry = {
      eventId,
      sessionId,
      state: "claimed",
      attempts: 1,
      createdAt: now,
      updatedAt: now,
    };
    this.entries.set(eventId, entry);
    this.sessionIndex.set(sessionId, eventId);
    return true;
  }

  markDone(eventId: string): void {
    const entry = this.entries.get(eventId);
    if (entry) {
      entry.state = "done";
      entry.updatedAt = Date.now();
    }
  }

  releaseClaim(eventId: string): void {
    const entry = this.entries.get(eventId);
    if (entry && entry.state === "claimed") {
      entry.state = "released";
      entry.updatedAt = Date.now();
    }
  }

  getAttempts(eventId: string): number {
    return this.entries.get(eventId)?.attempts ?? 0;
  }

  getEntry(eventId: string): LedgerEntry | undefined {
    return this.entries.get(eventId);
  }

  clear(): void {
    this.entries.clear();
    this.sessionIndex.clear();
  }
}

export async function withIdempotency(
  ledger: EventLedger,
  eventId: string,
  sessionId: string,
  fn: () => Promise<void>,
  options: IdempotencyOptions = {},
): Promise<IdempotencyResult> {
  const { alertThreshold = DEFAULT_ALERT_THRESHOLD, onAlert } = options;

  const claimed = ledger.claimEvent(eventId, sessionId);
  if (!claimed) {
    const entry = ledger.getEntry(eventId);
    if (entry?.state === "done") {
      return { fulfilled: false, deduped: true };
    }
    return { fulfilled: false, deduped: true };
  }

  try {
    await fn();
    ledger.markDone(eventId);
    return { fulfilled: true, deduped: false };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    ledger.releaseClaim(eventId);

    const entry = ledger.getEntry(eventId);
    if (entry && entry.attempts >= alertThreshold && !entry.alerted) {
      entry.alerted = true;
      if (onAlert) {
        onAlert({ eventId, sessionId, attempts: entry.attempts, lastError: errorMsg });
      }
    }

    return { fulfilled: false, deduped: false, error: errorMsg };
  }
}
