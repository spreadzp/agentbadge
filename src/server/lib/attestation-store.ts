/**
 * SLICE-151-3: VenueStore (D12-151) — shared store interface for
 * venue/public listings. In-memory ring buffer now; JSON persist +
 * DB adapter can land behind the same interface in 151-9/EPIC-143.
 */

export interface AttestationEntry {
  id: string;
  url: string;
  domain: string;
  score: number;
  status: string;
  /** ERC-8004 agentId the feedback was written to (oracle or client's). */
  agentId: string;
  feedbackTx: string;
  memoTx: string;
  /** CAIP-2 network the attestation settled on. */
  network: string;
  createdAt: string;
}

export interface VenueStore {
  add(entry: AttestationEntry): void;
  /** Newest-first. */
  list(limit?: number): AttestationEntry[];
  size(): number;
}

/** In-memory ring buffer — newest entries kept, capacity-bounded. */
export function createVenueStore(capacity = 200): VenueStore {
  const entries: AttestationEntry[] = [];
  return {
    add(entry) {
      entries.unshift(entry);
      if (entries.length > capacity) entries.length = capacity;
    },
    list(limit = 50) {
      return entries.slice(0, limit);
    },
    size() {
      return entries.length;
    },
  };
}

/**
 * Shared default instance — attestation-api writes, venue pages/API
 * read. Without this each route file got its own private ring buffer
 * and the venue feed never saw attestation entries.
 */
let _shared: VenueStore | undefined;
export function sharedVenueStore(): VenueStore {
  _shared ??= createVenueStore();
  return _shared;
}
