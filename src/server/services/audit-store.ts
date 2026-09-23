/**
 * SLICE-145-4: Audit Store service (D9).
 *
 * KeeperHub audit trail persisted to `Event` rows (type="audit",
 * source="keeperhub") — survives restarts. The EventEmitter + in-memory
 * array stay: emit drives the SSE stream (`/keeperhub/audit/stream`), the
 * array is the read-cache/fallback for `list()`.
 *
 * - `add()` — async: awaits `events.create()` BEFORE returning (audit must
 *   be durable before the API response, D3), then updates the read-cache
 *   and emits. DB failure degrades to in-memory — the event is never lost
 *   from the stream.
 * - `list()` — async: reads from the DB when available (post-restart
 *   trail), falls back to the in-memory array. Dedupe by executionId +
 *   source preserved on both paths.
 * - `DATABASE_ENABLED=false` / config unavailable → in-memory only
 *   (zero behavior change).
 */

import { EventEmitter } from "events";

import type { Store } from "@agentbadge/database";

import { getDatabase } from "../lib/database";

export interface AuditEvent {
  id: string;
  source: string;
  siteUrl: string;
  score?: number;
  status: "recorded" | "failed" | "pending";
  txHashes?: string[];
  executionId?: string;
  error?: string;
  receivedAt: string;
}

const MAX_EVENTS = 500;
const AUDIT_TYPE = "audit";
const AUDIT_SOURCE = "keeperhub";

export class AuditStore extends EventEmitter {
  private events: AuditEvent[] = [];

  async add(
    event: Omit<AuditEvent, "id" | "receivedAt"> & {
      id?: string;
      receivedAt?: string;
    },
  ): Promise<AuditEvent> {
    const fullEvent: AuditEvent = {
      id:
        event.id ??
        `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      receivedAt: event.receivedAt ?? new Date().toISOString(),
      source: event.source,
      siteUrl: event.siteUrl,
      score: event.score,
      status: event.status,
      txHashes: event.txHashes,
      executionId: event.executionId,
      error: event.error,
    };

    // Durable write first (D3) — awaited so the audit row exists before
    // the API response. Best-effort: failure degrades to in-memory.
    const store = this.store();
    if (store) {
      try {
        await store.create({
          type: AUDIT_TYPE,
          source: AUDIT_SOURCE,
          payload: fullEvent as unknown as Record<string, unknown>,
        });
      } catch {
        // fall through — read-cache + emit still happen
      }
    }

    // Dedupe by executionId + source: replace existing, move to front
    if (fullEvent.executionId) {
      const existingIdx = this.events.findIndex(
        (e) =>
          e.executionId === fullEvent.executionId &&
          e.source === fullEvent.source,
      );
      if (existingIdx >= 0) {
        this.events.splice(existingIdx, 1);
      }
    }

    this.events.unshift(fullEvent);

    // Cap at MAX_EVENTS
    if (this.events.length > MAX_EVENTS) {
      this.events = this.events.slice(0, MAX_EVENTS);
    }

    this.emit("audit", fullEvent);
    return fullEvent;
  }

  /**
   * Newest-first audit events. DB-first when available (survives
   * restarts); in-memory array otherwise. Dedupe by executionId + source
   * applied on both paths.
   */
  async list(opts?: {
    limit?: number;
    siteUrl?: string;
  }): Promise<AuditEvent[]> {
    const limit = opts?.limit ?? 50;
    const store = this.store();
    if (store) {
      try {
        const rows = await store.list({
          type: AUDIT_TYPE,
          limit: MAX_EVENTS,
        });
        let result = rows.map((r) => r.payload as unknown as AuditEvent);
        result = dedupeByExecutionId(result);
        if (opts?.siteUrl) {
          result = result.filter((e) => e.siteUrl === opts.siteUrl);
        }
        return result.slice(0, limit);
      } catch {
        // fall through to in-memory
      }
    }

    let result = this.events;
    if (opts?.siteUrl) {
      result = result.filter((e) => e.siteUrl === opts.siteUrl);
    }
    return result.slice(0, limit);
  }

  /** Test helper — clears the read-cache AND persisted audit rows. */
  async clear(): Promise<void> {
    this.events = [];
    const store = this.store();
    if (!store) return;
    try {
      const rows = await store.list({ type: AUDIT_TYPE, limit: 10_000 });
      for (const r of rows) await store.delete(r.id);
    } catch {
      // best-effort
    }
  }

  size(): number {
    return this.events.length;
  }

  private store(): Store | null {
    try {
      return getDatabase().events;
    } catch {
      return null;
    }
  }
}

/** Keep the newest event per (executionId, source); rows are newest-first. */
function dedupeByExecutionId(events: AuditEvent[]): AuditEvent[] {
  const seen = new Set<string>();
  return events.filter((e) => {
    if (!e.executionId) return true;
    const key = `${e.source}:${e.executionId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export const auditStore = new AuditStore();
