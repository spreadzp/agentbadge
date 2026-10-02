/**
 * SLICE-152-9: one-shot migration of the JSON VenueStore
 * (.data/venue.json) into the prisma backend (Postgres venueJob /
 * venueOffer / venueMeta tables).
 *
 * Usage:
 *   ARC_VENUE_STORE=prisma bun run scripts/venue/migrate-json-to-db.ts [path]
 *
 * Defaults to ./.data/venue.json. Idempotent — upserts keyed by
 * jobId/offerId/meta key, safe to re-run. Requires DATABASE_ENABLED +
 * DATABASE_URL in env (prod: run locally against the pooled URL).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { getDatabase } from "../../src/server/lib/database";
import { PrismaVenueStore } from "../../src/server/lib/venue/db-store";
import type {
  VenueData,
  VenueJob,
  VenueOffer,
} from "../../src/server/lib/venue/store";

const path = process.argv[2] ?? join(process.cwd(), ".data", "venue.json");

if (!existsSync(path)) {
  console.error(`venue.json not found at ${path}`);
  process.exit(1);
}

const data = JSON.parse(readFileSync(path, "utf8")) as VenueData;
const jobs = Object.values(data.jobs ?? {});
const offers = Object.values(data.offers ?? {});
const meta = Object.entries(data.meta ?? {});

const db = getDatabase().db;
if (!db) {
  console.error("DATABASE is disabled or unreachable — check DATABASE_ENABLED/DATABASE_URL");
  process.exit(1);
}

const store = new PrismaVenueStore(db);
await store.ready();

for (const job of jobs) store.upsertJob(job as VenueJob);
for (const offer of offers) store.upsertOffer(offer as VenueOffer);
for (const [key, value] of meta) store.setMeta(key, value);

await store.flush();

console.log(
  `migrated: ${jobs.length} jobs, ${offers.length} offers, ${meta.length} meta keys`,
);

// Read-back verification via a fresh hydrated instance.
const verify = new PrismaVenueStore(db);
await verify.ready();
let missing = 0;
for (const job of jobs) {
  if (!verify.getJob(job.jobId)) missing++;
}
for (const offer of offers) {
  if (!verify.getOfferById(offer.id)) missing++;
}
for (const [key] of meta) {
  if (verify.getMeta(key) === undefined) missing++;
}

if (missing > 0) {
  console.error(`verify failed: ${missing} records missing after hydration`);
  process.exit(1);
}
console.log("verify ok — all records hydrated from Postgres");
process.exit(0);
