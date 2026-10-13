/**
 * SLICE-185-1 (EPIC-185): WitnessStore — enroll / seats / attestations /
 * daily credits.
 *
 * Async write-through store, same contract as AgentWalletStore /
 * AgentRegistrationStore: every mutation is persisted BEFORE the caller
 * sees the result; the process holds no authoritative state.
 *
 * Backends: json (store-json.ts, per-path mutex) and memory (tests/dev).
 * db backend (Postgres via @agentbadge/database) is a later migration —
 * the interface is async already so swapping is transparent.
 */
import {
  WITNESS_SEATS_PER_JOB,
  type WitnessAttestation,
  type WitnessEnroll,
  type WitnessSeat,
  type WitnessSeatClaim,
} from "./types";

export {
  WITNESS_DOMAINS,
  WITNESS_MAX_DOMAINS,
  WITNESS_REASON_MAX,
  WITNESS_SEATS_PER_JOB,
} from "./types";
export type {
  WitnessAttestation,
  WitnessDomain,
  WitnessEnroll,
  WitnessSeat,
  WitnessSeatClaim,
} from "./types";

export interface WitnessStore {
  name: "json" | "memory" | "db";

  /* enroll */
  /**
   * Persists an enrollment. Atomic duplicate guard: returns false when
   * agentId is already enrolled (wallet stays immutable — D-185-1).
   */
  putEnroll(rec: WitnessEnroll): Promise<boolean>;
  getEnroll(agentId: string): Promise<WitnessEnroll | undefined>;
  /** COI lookup — enrollments are keyed by agentId but conflicts are
   *  computed on the wallet (sybil). */
  getEnrollByWallet(wallet: string): Promise<WitnessEnroll | undefined>;
  /** Flips status to "suspended". Idempotent; false if unknown. */
  suspendEnroll(agentId: string): Promise<boolean>;

  /* seats */
  /**
   * Atomically claims a seat for (jobId, agentId). `expiresAt` is the
   * attest-window close (caller computes delivery + WITNESS_WINDOW_SEC).
   * Claim order: already_attested → already_seated → window_closed →
   * no_seats → claimed.
   */
  claimSeat(
    jobId: string,
    agentId: string,
    expiresAt: number,
  ): Promise<WitnessSeatClaim>;
  listSeats(jobId: string): Promise<WitnessSeat[]>;

  /* attestations */
  /**
   * Persists an attestation. Atomic duplicate guard: returns false when
   * (jobId, agentId) already attested — one opinion per witness per job.
   */
  putAttestation(att: WitnessAttestation): Promise<boolean>;
  getAttestation(
    jobId: string,
    agentId: string,
  ): Promise<WitnessAttestation | undefined>;
  listAttestations(jobId: string): Promise<WitnessAttestation[]>;

  /* credits */
  /**
   * Increments the daily credit counter `agentId:dayKey` and returns
   * the new count (1 on first use). The caller compares against
   * WITNESS_DAILY_CAP (D-185-5).
   */
  incrDailyCredits(agentId: string, dayKey: string): Promise<number>;
}

/**
 * Pure claim step — mutates `seats` only on success. Callers run this
 * under their backend's serialization (json mutex / memory sync).
 * Check order: already_attested → already_seated → window_closed →
 * no_seats → claimed.
 */
export function claimSeatIn(
  seats: WitnessSeat[],
  attested: ReadonlySet<string>,
  jobId: string,
  agentId: string,
  expiresAt: number,
): WitnessSeatClaim {
  if (attested.has(agentId)) return "already_attested";
  if (seats.some((s) => s.agentId === agentId)) return "already_seated";
  if (Date.now() >= expiresAt) return "window_closed";
  const claimed = seats.filter((s) => s.claimed).length;
  if (claimed >= WITNESS_SEATS_PER_JOB) return "no_seats";
  seats.push({
    jobId,
    seatNo: (claimed + 1) as 1 | 2,
    agentId,
    expiresAt,
    claimed: true,
  });
  return "claimed";
}

/* -------------------------------- memory --------------------------------- */

export function createMemoryWitnessStore(): WitnessStore {
  const enrollments = new Map<string, WitnessEnroll>();
  const seats = new Map<string, WitnessSeat[]>();
  const attestations = new Map<string, WitnessAttestation[]>();
  const credits = new Map<string, number>();
  return {
    name: "memory",

    async putEnroll(rec) {
      if (enrollments.has(rec.agentId)) return false;
      enrollments.set(rec.agentId, rec);
      return true;
    },
    async getEnroll(agentId) {
      return enrollments.get(agentId);
    },
    async getEnrollByWallet(wallet) {
      const lower = wallet.toLowerCase();
      return [...enrollments.values()].find(
        (r) => r.wallet.toLowerCase() === lower,
      );
    },
    async suspendEnroll(agentId) {
      const rec = enrollments.get(agentId);
      if (!rec) return false;
      enrollments.set(agentId, { ...rec, status: "suspended" });
      return true;
    },

    // Sync body = atomic claim (single-threaded), matches the json mutex.
    async claimSeat(jobId, agentId, expiresAt) {
      const list = seats.get(jobId) ?? [];
      const attested = new Set(
        (attestations.get(jobId) ?? []).map((a) => a.agentId),
      );
      const res = claimSeatIn(list, attested, jobId, agentId, expiresAt);
      if (res === "claimed") seats.set(jobId, list);
      return res;
    },
    async listSeats(jobId) {
      return [...(seats.get(jobId) ?? [])];
    },

    async putAttestation(att) {
      const list = attestations.get(att.jobId) ?? [];
      if (list.some((a) => a.agentId === att.agentId)) return false;
      list.push(att);
      attestations.set(att.jobId, list);
      return true;
    },
    async getAttestation(jobId, agentId) {
      return (attestations.get(jobId) ?? []).find(
        (a) => a.agentId === agentId,
      );
    },
    async listAttestations(jobId) {
      return [...(attestations.get(jobId) ?? [])];
    },

    async incrDailyCredits(agentId, dayKey) {
      const key = `${agentId}:${dayKey}`;
      const n = (credits.get(key) ?? 0) + 1;
      credits.set(key, n);
      return n;
    },
  };
}
