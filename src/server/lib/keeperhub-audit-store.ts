import { EventEmitter } from "events";

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

class AuditStore extends EventEmitter {
  private events: AuditEvent[] = [];

  add(event: Omit<AuditEvent, "id" | "receivedAt"> & { id?: string; receivedAt?: string }): AuditEvent {
    const fullEvent: AuditEvent = {
      id: event.id ?? `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      receivedAt: event.receivedAt ?? new Date().toISOString(),
      source: event.source,
      siteUrl: event.siteUrl,
      score: event.score,
      status: event.status,
      txHashes: event.txHashes,
      executionId: event.executionId,
      error: event.error,
    };

    // Dedupe by executionId + source: replace existing, move to front
    if (fullEvent.executionId) {
      const existingIdx = this.events.findIndex(
        (e) => e.executionId === fullEvent.executionId && e.source === fullEvent.source,
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

  list(opts?: { limit?: number; siteUrl?: string }): AuditEvent[] {
    let result = this.events;
    if (opts?.siteUrl) {
      result = result.filter((e) => e.siteUrl === opts.siteUrl);
    }
    const limit = opts?.limit ?? 50;
    return result.slice(0, limit);
  }

  clear(): void {
    this.events = [];
  }

  size(): number {
    return this.events.length;
  }
}

export const auditStore = new AuditStore();
