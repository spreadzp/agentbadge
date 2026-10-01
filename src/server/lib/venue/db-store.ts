/**
 * SLICE-152-5: VenueStore prisma backend (D5-152 read path = our index).
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
 * Persistence goes through the prisma-orm raw SQL lane — the venue contract
 * models (VenueJob/VenueOffer/VenueMeta in @agentbadge/database) land with the
 * next package publish; the raw lane works against any DATABASE_URL today.
 * Table DDL is applied at init (CREATE TABLE IF NOT EXISTS) so a fresh env
 * boots without a migration run; `prisma db migrate` remains the canonical
 * path for schema evolution.
 */
import type { JsonValue } from "@prisma/orm-postgres/target/codec-types";
import { logger } from "@agentbadge/passport";

import { getDatabase } from "../database";
import { normalizeOffer } from "./json-store";
import type {
  VenueJob,
  VenueOffer,
  VenueStoreBackend,
} from "./store";

type Db = NonNullable<ReturnType<typeof getDatabase>["db"]>;

const DDL = `
CREATE TABLE IF NOT EXISTS "VenueJob" (
  "id"        TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "jobId"     TEXT NOT NULL UNIQUE,
  "status"    TEXT NOT NULL,
  "client"    TEXT NOT NULL,
  "provider"  TEXT,
  "payload"   JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "VenueJob_status_createdAt_idx" ON "VenueJob" ("status", "createdAt");
CREATE INDEX IF NOT EXISTS "VenueJob_client_idx" ON "VenueJob" ("client");
CREATE TABLE IF NOT EXISTS "VenueOffer" (
  "id"              TEXT PRIMARY KEY,
  "providerAddress" TEXT NOT NULL,
  "active"          BOOLEAN NOT NULL DEFAULT true,
  "payload"         JSONB NOT NULL,
  "createdAt"       TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "VenueOffer_providerAddress_active_idx"
  ON "VenueOffer" ("providerAddress", "active");
CREATE TABLE IF NOT EXISTS "VenueMeta" (
  "key"       TEXT PRIMARY KEY,
  "value"     JSONB NOT NULL,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

interface Mirror {
  jobs: Map<string, VenueJob>;
  offers: Map<string, VenueOffer>;
  meta: Map<string, unknown>;
}

/**
 * Raw SQL helpers — prisma-orm raw lane: sql-tag → returnsRow/affectedCount
 * → build() → runtime().query/execute(plan). Payload columns carry the full
 * record as jsonb; indexed columns power stats queries.
 */
async function rawQuery(
  db: Db,
  sql: string,
  cols: Record<string, string>,
): Promise<Record<string, unknown>[]> {
  const plan = db.raw.sql`${sql}`.returnsRow(cols).build();
  const rows = await db.runtime().query(plan);
  return rows as Record<string, unknown>[];
}

async function rawExec(db: Db, sql: string): Promise<void> {
  const plan = db.raw.sql`${sql}`.affectedCount().build();
  await db.runtime().execute(plan);
}

const esc = (v: string) => `'${v.replace(/'/g, "''")}'`;

/**
 * Build the prisma-backed store, or null when DATABASE is disabled.
 * Hydration + DDL kick off in the background; reads serve the mirror.
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

  /** Idempotent table DDL + hydrate mirror. */
  private async init(): Promise<void> {
    try {
      await rawExec(this.db, DDL);
    } catch (err) {
      logger.warn("venue: db-store DDL failed (tables may already exist)", {
        err: String(err),
      });
    }
    const [jobs, offers, meta] = await Promise.all([
      rawQuery(this.db, `SELECT "payload" FROM "VenueJob"`, { payload: "pg/jsonb@1" }),
      rawQuery(this.db, `SELECT "id", "payload" FROM "VenueOffer"`, {
        id: "pg/text@1",
        payload: "pg/jsonb@1",
      }),
      rawQuery(this.db, `SELECT "key", "value" FROM "VenueMeta"`, {
        key: "pg/text@1",
        value: "pg/jsonb@1",
      }),
    ]);
    for (const row of jobs) {
      const job = row.payload as VenueJob;
      this.mirror.jobs.set(job.jobId, job);
    }
    for (const row of offers) {
      this.mirror.offers.set(
        String(row.id),
        normalizeOffer(row.payload as VenueOffer),
      );
    }
    for (const row of meta) {
      this.mirror.meta.set(String(row.key), row.value);
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
    const sql =
      `INSERT INTO "VenueJob" ("jobId","status","client","provider","payload","updatedAt")` +
      ` VALUES (${esc(job.jobId)},${esc(job.status)},${esc(job.client)},` +
      `${job.provider ? esc(job.provider) : "NULL"},` +
      `${esc(JSON.stringify(job))}::jsonb, now())` +
      ` ON CONFLICT ("jobId") DO UPDATE SET "status"=EXCLUDED."status",` +
      ` "client"=EXCLUDED."client", "provider"=EXCLUDED."provider",` +
      ` "payload"=EXCLUDED."payload", "updatedAt"=now()`;
    this.enqueue(() => rawExec(this.db, sql));
  }

  getJob(jobId: string): VenueJob | undefined {
    return this.mirror.jobs.get(jobId);
  }

  listJobs(filter?: {
    status?: string;
    category?: string;
    limit?: number;
  }): VenueJob[] {
    let all = [...this.mirror.jobs.values()];
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
    const sql =
      `INSERT INTO "VenueOffer" ("id","providerAddress","active","payload","updatedAt")` +
      ` VALUES (${esc(o.id)},${esc(o.providerAddress)},${o.active},` +
      `${esc(JSON.stringify(o))}::jsonb, now())` +
      ` ON CONFLICT ("id") DO UPDATE SET "providerAddress"=EXCLUDED."providerAddress",` +
      ` "active"=EXCLUDED."active", "payload"=EXCLUDED."payload", "updatedAt"=now()`;
    this.enqueue(() => rawExec(this.db, sql));
  }

  getOfferById(id: string): VenueOffer | undefined {
    return this.mirror.offers.get(id);
  }

  listOffers(filter?: {
    provider?: string;
    active?: boolean;
    limit?: number;
  }): VenueOffer[] {
    let all = [...this.mirror.offers.values()].map(normalizeOffer);
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
    const sql =
      `INSERT INTO "VenueMeta" ("key","value","updatedAt")` +
      ` VALUES (${esc(key)},${esc(JSON.stringify(value))}::jsonb, now())` +
      ` ON CONFLICT ("key") DO UPDATE SET "value"=EXCLUDED."value",` +
      ` "updatedAt"=now()`;
    this.enqueue(() => rawExec(this.db, sql));
  }
}

export type { JsonValue };
