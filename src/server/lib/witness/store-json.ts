/**
 * SLICE-185-1 (EPIC-185): JSON-file backend for WitnessStore.
 *
 * File layout (.data/witness.json): enrollments keyed by agentId,
 * seats/attestations keyed by jobId, credits keyed by `agentId:dayKey`.
 * All mutations run under a per-path async mutex — claimSeat /
 * putEnroll / putAttestation are atomic read-modify-write inside one
 * process. Multi-replica deployments need the db backend.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { WitnessAttestation, WitnessEnroll, WitnessSeat } from "./types";
import { claimSeatIn, type WitnessStore } from "./store";

interface WitnessJsonFile {
  enrollments: Record<string, WitnessEnroll>;
  /** jobId → seats */
  seats: Record<string, WitnessSeat[]>;
  /** jobId → attestations */
  attestations: Record<string, WitnessAttestation[]>;
  /** `${agentId}:${dayKey}` → used credits */
  credits: Record<string, number>;
}

// Fresh nested objects every call — a shared literal would leak
// mutations across store instances/files (caught by the persistence
// test: a suspend in one file surfaced in an unrelated fresh store).
function emptyFile(): WitnessJsonFile {
  return { enrollments: {}, seats: {}, attestations: {}, credits: {} };
}

function readJson(path: string): WitnessJsonFile {
  if (!existsSync(path)) return emptyFile();
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as WitnessJsonFile;
    return {
      enrollments: raw.enrollments ?? {},
      seats: raw.seats ?? {},
      attestations: raw.attestations ?? {},
      credits: raw.credits ?? {},
    };
  } catch {
    return emptyFile();
  }
}

function writeJson(path: string, data: WitnessJsonFile): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2));
}

/** Serializes async mutations per path — plain promise chain, no deps. */
function createMutex(): <T>(fn: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const next = tail.then(fn);
    tail = next.catch(() => {});
    return next;
  };
}

export function createJsonWitnessStore(
  path = join(process.cwd(), ".data", "witness.json"),
): WitnessStore {
  const locked = createMutex();
  return {
    name: "json",

    async putEnroll(rec) {
      return locked(async () => {
        const data = readJson(path);
        if (data.enrollments[rec.agentId]) return false;
        data.enrollments[rec.agentId] = rec;
        writeJson(path, data);
        return true;
      });
    },
    async getEnroll(agentId) {
      return readJson(path).enrollments[agentId];
    },
    async getEnrollByWallet(wallet) {
      const lower = wallet.toLowerCase();
      return Object.values(readJson(path).enrollments).find(
        (r) => r.wallet.toLowerCase() === lower,
      );
    },
    async suspendEnroll(agentId) {
      return locked(async () => {
        const data = readJson(path);
        const rec = data.enrollments[agentId];
        if (!rec) return false;
        data.enrollments[agentId] = { ...rec, status: "suspended" };
        writeJson(path, data);
        return true;
      });
    },

    async claimSeat(jobId, agentId, expiresAt) {
      return locked(async () => {
        const data = readJson(path);
        const seats = data.seats[jobId] ?? [];
        const attested = new Set(
          (data.attestations[jobId] ?? []).map((a) => a.agentId),
        );
        const res = claimSeatIn(seats, attested, jobId, agentId, expiresAt);
        if (res !== "claimed") return res;
        data.seats[jobId] = seats;
        writeJson(path, data);
        return "claimed";
      });
    },
    async listSeats(jobId) {
      return [...(readJson(path).seats[jobId] ?? [])];
    },

    async putAttestation(att) {
      return locked(async () => {
        const data = readJson(path);
        const list = data.attestations[att.jobId] ?? [];
        if (list.some((a) => a.agentId === att.agentId)) return false;
        list.push(att);
        data.attestations[att.jobId] = list;
        writeJson(path, data);
        return true;
      });
    },
    async getAttestation(jobId, agentId) {
      return (readJson(path).attestations[jobId] ?? []).find(
        (a) => a.agentId === agentId,
      );
    },
    async listAttestations(jobId) {
      return [...(readJson(path).attestations[jobId] ?? [])];
    },

    async incrDailyCredits(agentId, dayKey) {
      return locked(async () => {
        const data = readJson(path);
        const key = `${agentId}:${dayKey}`;
        const n = (data.credits[key] ?? 0) + 1;
        data.credits[key] = n;
        writeJson(path, data);
        return n;
      });
    },
  };
}
