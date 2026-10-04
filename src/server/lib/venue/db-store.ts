/**
 * SLICE-152-5: VenueStore prisma backend (D5-152 read path = our index).
 * SLICE-152-9: fixed raw-lane usage — `db.raw.sql` is a tagged template:
 * `${value}` interpolates as a bind parameter ($N), so whole-statement
 * interpolation (`sql`${sql}``) produced `syntax error at or near "$1"`.
 * All queries are now literal templates with per-value interpolation.
 * Table DDL moved out of init — schema is owned by committed migrations
 * (packages/database `prisma db migrate`, venue models landed in
 * migrations/app/20261002T1019_add_venue_models).
 *
 * VenueStore API is synchronous — every route reads inline — so this backend
 * keeps an in-memory mirror hydrated from Postgres at init and write-behind
 * persists through a serialized queue. `ready()` resolves after hydration;
 * the indexer and stats endpoints await it before serving.
 *
 * Selected via ARC_VENUE_STORE=prisma|db (sqlite alias accepted per spec).
 * Requires DATABASE_ENABLED + DATABASE_URL — createVenueDbStore() returns
 * null when the database section is off and the caller falls back to json.
 *
 * Contract table names are camelCase (`venueJob`/`venueOffer`/`venueMeta`)
 * per packages/database/src/prisma/contract.prisma.
 */
import { randomUUID } from "node:crypto";
import { param } from "@agentbadge/database";
import { logger } from "@agentbadge/passport";

import { getDatabase } from "../database";
import { normalizeOffer } from "./json-store";
import type {
  VenueJob,
  VenueOffer,
  VenueStoreBackend,
} from "./store";

type Db = NonNullable<ReturnType<typeof getDatabase>["db"]>;

interface Mirror {
  jobs: Map<string, VenueJob>;
  offers: Map<string, VenueOffer>;
  meta: Map<string, unknown>;
}

/**
 * Build the prisma-backed store, or null when DATABASE is disabled.
 * Hydration kicks off in the background; reads serve the mirror.
 */
export function createVenueDbStore(): VenueStoreBackend | null {
  const db = getDatabase().db;
  if (!db) return null;
  return new PrismaVenueStore(db);
}

export class PrismaVenueStore implements VenueStoreBackend {
  readonly name = "prisma" as const;
  private readonly mirror: Mirror = {
    jobs: new Map(),
    offers: new Map(),
    meta: new Map(),
  };
  /** Serialized write-behind queue — keeps row order per key. */
  private writeChain: Promise<void> = Promise.resolve();
  private readonly initPromise: Promise<void>;

  constructor(private readonly db: Db) {
    this.initPromise = this.init().catch((err) => {
      logger.error("venue: db-store init failed", { err: String(err) });
    });
  }

  ready(): Promise<void> {
    return this.initPromise;
  }

  /** Hydrate mirror from Postgres (schema arrives via `db migrate`). */
  private async init(): Promise<void> {
    // json columns arrive driver-parsed (objects), so select them ::text
    // with pg/text@1 and JSON.parse here — pg/json@1 would double-parse.
    const jobsPlan = this.db.raw
      .sql`SELECT "payload"::text AS payload FROM "venueJob"`
      .returnsRow({ payload: "pg/text@1" })
      .build();
    const offersPlan = this.db.raw
      .sql`SELECT "id", "payload"::text AS payload FROM "venueOffer"`
      .returnsRow({ id: "pg/text@1", payload: "pg/text@1" })
      .build();
    const metaPlan = this.db.raw
      .sql`SELECT "key", "value"::text AS value FROM "venueMeta"`
      .returnsRow({ key: "pg/text@1", value: "pg/text@1" })
      .build();

    const [jobs, offers, meta] = await Promise.all([
      this.db.runtime().query(jobsPlan),
      this.db.runtime().query(offersPlan),
      this.db.runtime().query(metaPlan),
    ]);

    for (const row of jobs as { payload: string }[]) {
      const job = JSON.parse(row.payload) as VenueJob;
      this.mirror.jobs.set(job.jobId, job);
    }
    for (const row of offers as { id: string; payload: string }[]) {
      this.mirror.offers.set(
        String(row.id),
        normalizeOffer(JSON.parse(row.payload) as VenueOffer),
      );
    }
    for (const row of meta as { key: string; value: string }[]) {
      this.mirror.meta.set(String(row.key), JSON.parse(row.value));
    }
    logger.info("venue: db-store hydrated", {
      jobs: this.mirror.jobs.size,
      offers: this.mirror.offers.size,
    });
  }

  /** Serialize a persistence op; failures are logged, never thrown. */
  private enqueue(op: () => Promise<unknown>): void {
    this.writeChain = this.writeChain.then(() =>
      op().then(
        () => undefined,
        (err) =>
          logger.error("venue: db write-behind failed", {
            err: String(err),
          }),
      ),
    );
  }

  /** Test/flush hook — resolves when all queued writes landed. */
  flush(): Promise<void> {
    return this.writeChain;
  }

  // ─── jobs ────────────────────────────────────────────────────────

  upsertJob(job: VenueJob): void {
    this.mirror.jobs.set(job.jobId, job);
    const payload = JSON.stringify(job);
    const provider = param(job.provider ?? null, {
      codecId: "pg/text@1",
    });
    const plan = this.db.raw
      .sql`INSERT INTO "venueJob" ("id","jobId","status","client","provider","payload","updatedAt")
        VALUES (${randomUUID()}, ${job.jobId}, ${job.status}, ${job.client},
          ${provider}, ${payload}::json, now())
        ON CONFLICT ("jobId") DO UPDATE SET "status" = EXCLUDED."status",
          "client" = EXCLUDED."client", "provider" = EXCLUDED."provider",
          "payload" = EXCLUDED."payload", "updatedAt" = now()`
      .affectedCount()
      .build();
    this.enqueue(() => this.db.runtime().execute(plan));
  }

  getJob(jobId: string): VenueJob | undefined {
    return this.mirror.jobs.get(jobId);
  }

  listJobs(filter?: {
    status?: string;
    category?: string;
    venueId?: string;
    limit?: number;
  }): VenueJob[] {
    let all = [...this.mirror.jobs.values()];
    if (filter?.venueId) {
      const v = filter.venueId;
      all = all.filter((j) => (j.venueId ?? "public") === v);
    }
    if (filter?.status) all = all.filter((j) => j.status === filter.status);
    if (filter?.category) {
      const cat = filter.category.toLowerCase();
      all = all.filter((j) => j.category?.toLowerCase() === cat);
    }
    all = all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return filter?.limit ? all.slice(0, filter.limit) : all;
  }

  // ─── offers ──────────────────────────────────────────────────────

  upsertOffer(offer: VenueOffer): void {
    const o = normalizeOffer(offer);
    this.mirror.offers.set(o.id, o);
    const payload = JSON.stringify(o);
    const plan = this.db.raw
      .sql`INSERT INTO "venueOffer" ("id","providerAddress","active","payload","updatedAt")
        VALUES (${o.id}, ${o.providerAddress}, ${o.active}, ${payload}::json, now())
        ON CONFLICT ("id") DO UPDATE SET "providerAddress" = EXCLUDED."providerAddress",
          "active" = EXCLUDED."active", "payload" = EXCLUDED."payload",
          "updatedAt" = now()`
      .affectedCount()
      .build();
    this.enqueue(() => this.db.runtime().execute(plan));
  }

  getOfferById(id: string): VenueOffer | undefined {
    return this.mirror.offers.get(id);
  }

  listOffers(filter?: {
    provider?: string;
    active?: boolean;
    venueId?: string;
    limit?: number;
  }): VenueOffer[] {
    let all = [...this.mirror.offers.values()].map(normalizeOffer);
    if (filter?.venueId) {
      const v = filter.venueId;
      all = all.filter((o) => (o.venueId ?? "public") === v);
    }
    if (filter?.provider) {
      const p = filter.provider.toLowerCase();
      all = all.filter((o) => o.providerAddress.toLowerCase() === p);
    }
    if (filter?.active !== undefined) {
      all = all.filter((o) => o.active === filter.active);
    }
    all = all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return filter?.limit ? all.slice(0, filter.limit) : all;
  }

  deactivateOffer(id: string): boolean {
    const offer = this.mirror.offers.get(id);
    if (!offer) return false;
    this.upsertOffer({ ...normalizeOffer(offer), active: false });
    return true;
  }

  // ─── meta ────────────────────────────────────────────────────────

  getMeta<T>(key: string): T | undefined {
    return this.mirror.meta.get(key) as T | undefined;
  }

  setMeta(key: string, value: unknown): void {
    this.mirror.meta.set(key, value);
    const payload = JSON.stringify(value ?? null);
    const plan = this.db.raw
      .sql`INSERT INTO "venueMeta" ("key","value","updatedAt")
        VALUES (${key}, ${payload}::json, now())
        ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value",
          "updatedAt" = now()`
      .affectedCount()
      .build();
    this.enqueue(() => this.db.runtime().execute(plan));
  }
}
