/**
 * SLICE-185-2 (EPIC-185): witness layer wiring.
 *
 * Env:
 *   WITNESS_ENABLED    — "1"/"true" enables POST endpoints (me stays
 *                        readable; off → honest 503 witness_disabled).
 *   WITNESS_WINDOW_SEC — attest window after delivery (default 3600).
 *   WITNESS_DAILY_CAP  — attest credits per agent per UTC day (default 20).
 *   WITNESS_SEAT_DAILY_CAP — seat claims per agent per UTC day (default 10).
 *   WITNESS_STORE      — "memory" | "json" (default "json").
 *
 * Stores: json backends in .data/ (witness.json, witness-jobs.json).
 * Registration store is a separate json instance over the same file —
 * safe because this wiring only READS (meGate lookups); all writes
 * happen in the agent-registration wiring's instance.
 */
import type { Hono } from "hono";
import { createWitnessRoutes } from "../routes/witness-api";
import { createMemoryWitnessStore } from "../lib/witness/store";
import { createJsonWitnessStore } from "../lib/witness/store-json";
import { createJsonAgentRegistrationStore } from "../lib/agent-registration/store";
import { createJsonWitnessJobSource } from "../lib/witness/jobs";

const envFlag = (name: string): boolean =>
  ["1", "true", "yes"].includes((process.env[name] ?? "").toLowerCase());
const envInt = (name: string, fallback: number): number => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};

export function wireWitness(app: Hono): void {
  const store =
    process.env.WITNESS_STORE === "memory"
      ? createMemoryWitnessStore()
      : createJsonWitnessStore();
  const jobs = createJsonWitnessJobSource();

  app.route(
    "/",
    createWitnessRoutes({
      enabled: envFlag("WITNESS_ENABLED"),
      store,
      registrationStore: createJsonAgentRegistrationStore(),
      getJob: (jobId) => jobs.getJob(jobId),
      windowSec: envInt("WITNESS_WINDOW_SEC", 3600),
      dailyCap: envInt("WITNESS_DAILY_CAP", 20),
      seatDailyCap: envInt("WITNESS_SEAT_DAILY_CAP", 10),
    }),
  );
}
