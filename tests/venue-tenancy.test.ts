/**
 * SLICE-153-1: Venue tenancy model — venue registry + venueId namespace.
 *
 * Covers: venue CRUD (slug unique, owner wallet), venueId isolation
 * between venues, lazy default "public" for legacy records, scoped
 * routes /api/venue/instances/:id/jobs|offers, and /market/v/:slug page.
 * Both backends (json mem + prisma live-gated) share the same contract.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";

import {
  configureAgentAuthForTesting,
  resetAgentAuthForTesting,
} from "../src/server/middleware/agent-auth";
import { resetConfigCache } from "../src/config/env";
import {
  resetDatabaseForTests,
} from "../src/server/lib/database";
import { resetVenueEventsForTests } from "../src/server/services/venue-events";
import {
  createVenueApiRoutes,
  type VenueDeps,
} from "../src/server/routes/venue-api";
import { createVenuePageRoutes } from "../src/server/routes/venue-pages";
import {
  getJob,
  listJobs,
  listOffers,
  resetStoreForTesting,
  upsertJob,
  upsertOffer,
  useMemoryStoreForTesting,
  type VenueJob,
} from "../src/server/lib/venue/store";
import {
  createVenue,
  getVenue,
  listVenues,
  updateVenue,
  PUBLIC_VENUE_ID,
} from "../src/server/lib/venue/venues";

const OWNER = "0x00000000000000000000000000000000000000aa";
const OTHER = "0x00000000000000000000000000000000000000bb";

const SAVED_DB_ENABLED = process.env.DATABASE_ENABLED;

beforeEach(() => {
  process.env.DATABASE_ENABLED = "false";
  resetConfigCache();
  resetDatabaseForTests();
  useMemoryStoreForTesting();
  configureAgentAuthForTesting({ verifier: async () => true });
  resetVenueEventsForTests();
});
afterEach(() => {
  resetStoreForTesting();
  resetAgentAuthForTesting();
  resetVenueEventsForTests();
  resetDatabaseForTests();
  if (SAVED_DB_ENABLED === undefined) delete process.env.DATABASE_ENABLED;
  else process.env.DATABASE_ENABLED = SAVED_DB_ENABLED;
  resetConfigCache();
});

function jobFixture(over: Partial<VenueJob> = {}): VenueJob {
  return {
    jobId: `vj_${Math.random().toString(16).slice(2)}`,
    title: "t",
    description: "d",
    budgetUsdc: 1,
    status: "open",
    client: OWNER,
    evaluator: OTHER,
    createdAt: "2026-10-01T00:00:00.000Z",
    chainTxs: {},
    ...over,
  };
}

const signedHeaders = (wallet: string) => ({
  "x-wallet": wallet,
  "x-sig": "0xdead",
  "x-timestamp": String(Math.floor(Date.now() / 1000)),
  "content-type": "application/json",
});

function app(): Hono {
  const a = new Hono();
  const deps: VenueDeps = { network: () => undefined as never };
  a.route("/", createVenueApiRoutes(deps));
  return a;
}

// ─── Registry (store-level) ──────────────────────────────────────

describe("venue registry (json backend)", () => {
  it("creates a business venue and resolves by id and slug", () => {
    const v = createVenue({
      name: "Acme venue",
      slug: "acme",
      kind: "business",
      ownerWallet: OWNER,
    });
    expect(v.id).toMatch(/^vn_/);
    expect(v.active).toBe(true);
    expect(getVenue(v.id)?.slug).toBe("acme");
    expect(getVenue("acme")?.id).toBe(v.id);
  });

  it("rejects duplicate slug and reserved 'public' slug", () => {
    createVenue({ name: "a", slug: "acme", kind: "business", ownerWallet: OWNER });
    expect(() =>
      createVenue({ name: "b", slug: "acme", kind: "business", ownerWallet: OWNER }),
    ).toThrow(/slug/i);
    expect(() =>
      createVenue({ name: "p", slug: "public", kind: "business", ownerWallet: OWNER }),
    ).toThrow(/reserved|public/i);
  });

  it("updateVenue patches fields and keeps owner", () => {
    const v = createVenue({ name: "a", slug: "acme2", kind: "business", ownerWallet: OWNER });
    const upd = updateVenue(v.id, { name: "b", delegates: [OTHER] });
    expect(upd?.name).toBe("b");
    expect(upd?.ownerWallet).toBe(OWNER);
    expect(upd?.delegates).toEqual([OTHER]);
  });

  it("listVenues filters by kind and owner", () => {
    createVenue({ name: "b1", slug: "b1", kind: "business", ownerWallet: OWNER });
    createVenue({ name: "b2", slug: "b2", kind: "business", ownerWallet: OTHER });
    expect(listVenues({ kind: "business" })).toHaveLength(2);
    expect(listVenues({ owner: OWNER }).map((v) => v.slug)).toEqual(["b1"]);
  });
});

// ─── venueId isolation ───────────────────────────────────────────

describe("venueId namespace", () => {
  it("jobs in venue A are invisible to venue B listing", () => {
    const a = createVenue({ name: "A", slug: "va", kind: "business", ownerWallet: OWNER });
    const b = createVenue({ name: "B", slug: "vb", kind: "business", ownerWallet: OWNER });
    upsertJob(jobFixture({ jobId: "j_a", venueId: a.id }));
    upsertJob(jobFixture({ jobId: "j_b", venueId: b.id }));
    upsertJob(jobFixture({ jobId: "j_pub" })); // legacy — no venueId

    expect(listJobs({ venueId: a.id }).map((j) => j.jobId)).toEqual(["j_a"]);
    expect(listJobs({ venueId: b.id }).map((j) => j.jobId)).toEqual(["j_b"]);
    expect(listJobs({ venueId: PUBLIC_VENUE_ID }).map((j) => j.jobId)).toEqual(["j_pub"]);
    expect(listJobs()).toHaveLength(3); // unfiltered = all
  });

  it("legacy records read as venueId=public (lazy default)", () => {
    upsertJob(jobFixture({ jobId: "legacy" }));
    expect(getJob("legacy")?.venueId).toBeUndefined(); // raw record untouched
    expect(listJobs({ venueId: PUBLIC_VENUE_ID }).map((j) => j.jobId)).toContain("legacy");
  });

  it("offers scoped by venueId the same way", () => {
    const a = createVenue({ name: "A", slug: "va2", kind: "business", ownerWallet: OWNER });
    upsertOffer({
      id: "vo_a", providerAddress: OWNER, name: "n", description: "d",
      claimable: true, active: true, categories: [], venueId: a.id,
      createdAt: "2026-10-01T00:00:00.000Z",
    });
    upsertOffer({
      id: "vo_pub", providerAddress: OWNER, name: "n", description: "d",
      claimable: true, active: true, categories: [],
      createdAt: "2026-10-01T00:00:00.000Z",
    });
    expect(listOffers({ venueId: a.id }).map((o) => o.id)).toEqual(["vo_a"]);
    expect(listOffers({ venueId: PUBLIC_VENUE_ID }).map((o) => o.id)).toEqual(["vo_pub"]);
  });
});

// ─── API routes ──────────────────────────────────────────────────

describe("/api/venue/instances", () => {
  it("POST creates a business venue owned by the signer wallet", async () => {
    const res = await app().request("/api/venue/instances", {
      method: "POST",
      headers: signedHeaders(OWNER),
      body: JSON.stringify({ name: "Acme", slug: "acme", description: "d" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { venue: { slug: string; kind: string; ownerWallet: string } };
    expect(body.venue.slug).toBe("acme");
    expect(body.venue.kind).toBe("business");
    expect(body.venue.ownerWallet.toLowerCase()).toBe(OWNER);
  });

  it("POST rejects unsigned request and invalid slug", async () => {
    const a = app();
    const unsigned = await a.request("/api/venue/instances", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "x", slug: "x" }),
    });
    expect(unsigned.status).toBe(401);
    const bad = await a.request("/api/venue/instances", {
      method: "POST",
      headers: signedHeaders(OWNER),
      body: JSON.stringify({ name: "x", slug: "BAD SLUG!" }),
    });
    expect(bad.status).toBe(400);
  });

  it("GET lists venues publicly; GET /:id returns meta", async () => {
    const a = app();
    await a.request("/api/venue/instances", {
      method: "POST",
      headers: signedHeaders(OWNER),
      body: JSON.stringify({ name: "Acme", slug: "acme-l" }),
    });
    const list = await a.request("/api/venue/instances");
    const venues = ((await list.json()) as { venues: unknown[] }).venues;
    expect(venues.length).toBeGreaterThanOrEqual(1);
    const one = await a.request("/api/venue/instances/acme-l");
    expect(one.status).toBe(200);
    const detail = (await one.json()) as { venue: { name: string } };
    expect(detail.venue.name).toBe("Acme");
  });

  it("scoped jobs route returns only that venue's jobs", async () => {
    const a = app();
    const res = await a.request("/api/venue/instances", {
      method: "POST",
      headers: signedHeaders(OWNER),
      body: JSON.stringify({ name: "Acme", slug: "acme-j" }),
    });
    const { venue } = (await res.json()) as { venue: { id: string } };
    upsertJob(jobFixture({ jobId: "j_scoped", venueId: venue.id }));
    upsertJob(jobFixture({ jobId: "j_other" }));
    const scoped = await a.request(`/api/venue/instances/${venue.id}/jobs`, {
      headers: signedHeaders(OWNER), // 153-2: business-venue reads are member-gated
    });
    const jobs = ((await scoped.json()) as { jobs: { jobId: string }[] }).jobs;
    expect(jobs.map((j) => j.jobId)).toEqual(["j_scoped"]);
  });
});

// ─── Page route /market/v/:slug ──────────────────────────────────

describe("/market/v/:slug page", () => {
  function pageApp(): Hono {
    const a = new Hono();
    // No network dep — resolveVenueNetwork() default (testnet) is fine here.
    a.route("/", createVenuePageRoutes());
    return a;
  }

  it("renders venue landing with scoped jobs only", async () => {
    const venue = createVenue({
      name: "Page Venue",
      slug: "page-v",
      kind: "business",
      ownerWallet: OWNER,
    });
    upsertJob(jobFixture({ jobId: "j_in", venueId: venue.id }));
    upsertJob(jobFixture({ jobId: "j_out" }));
    const res = await pageApp().request("/market/v/page-v", {
      headers: { "x-wallet": OWNER }, // 153-2: member wallet → full page
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Page Venue");
    expect(html).toContain("j_in");
    expect(html).not.toContain("j_out");
  });

  it("404s on unknown slug; 'public' redirects to /market", async () => {
    const a = pageApp();
    const missing = await a.request("/market/v/nope-404");
    expect(missing.status).toBe(404);
    const pub = await a.request("/market/v/public");
    expect(pub.status).toBe(302);
    expect(pub.headers.get("location")).toBe("/market");
  });
});
