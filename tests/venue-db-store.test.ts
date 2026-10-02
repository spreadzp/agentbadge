/**
 * SLICE-152-9: PrismaVenueStore regression — write-behind persistence must
 * survive a process restart (re-init hydration). The bug this guards: the
 * raw lane previously interpolated whole SQL strings as bind params
 * (`$1` syntax error), silently dropping every write; venue state was lost
 * on each fly deploy.
 *
 * Live-gated: skipped unless DATABASE_ENABLED + DATABASE_URL give a real
 * Postgres handle. Uses unique row ids and deletes them afterwards — safe
 * to run against any DATABASE_URL.
 */
import { afterAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";

import { getDatabase } from "../src/server/lib/database";
import { PrismaVenueStore } from "../src/server/lib/venue/db-store";
import type { VenueJob, VenueOffer } from "../src/server/lib/venue/store";

const db = getDatabase().db;
const runId = randomBytes(4).toString("hex");
const jobId = `vj_test_dur_${runId}`;
const offerId = `vo_test_dur_${runId}`;
const metaKey = `test:dur:${runId}`;

describe.skipIf(!db)("PrismaVenueStore persistence (live Postgres)", () => {
  it("hydrates a fresh instance with rows written by a previous one", async () => {
    const first = new PrismaVenueStore(db!);
    await first.ready();

    const job: VenueJob = {
      jobId,
      title: "durability probe",
      description: "SLICE-152-9 regression",
      budgetUsdc: 0.01,
      status: "open",
      client: "0x00000000000000000000000000000000000000aa",
      evaluator: "0x00000000000000000000000000000000000000bb",
      provider: "0x00000000000000000000000000000000000000cc",
      createdAt: new Date().toISOString(),
      chainTxs: {},
    };
    const offer: VenueOffer = {
      id: offerId,
      providerAddress: "0x00000000000000000000000000000000000000cc",
      name: "durability-probe",
      description: "SLICE-152-9 regression",
      claimable: false,
      active: false,
      categories: ["test"],
      createdAt: new Date().toISOString(),
    };

    first.upsertJob(job);
    first.upsertOffer(offer);
    first.setMeta(metaKey, { probe: runId });
    await first.flush();

    // Fresh instance = simulated restart: mirror hydrates from Postgres only.
    const second = new PrismaVenueStore(db!);
    await second.ready();

    expect(second.getJob(jobId)?.title).toBe("durability probe");
    expect(second.getOfferById(offerId)?.name).toBe("durability-probe");
    expect(second.getMeta<{ probe: string }>(metaKey)?.probe).toBe(runId);
  });

  afterAll(async () => {
    if (!db) return;
    const statements = [
      db.raw.sql`DELETE FROM "venueJob" WHERE "jobId" = ${jobId}`,
      db.raw.sql`DELETE FROM "venueOffer" WHERE "id" = ${offerId}`,
      db.raw.sql`DELETE FROM "venueMeta" WHERE "key" = ${metaKey}`,
    ];
    for (const q of statements) {
      await db.runtime().execute(q.affectedCount().build());
    }
  });
});
