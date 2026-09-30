/**
 * Venue UI routes (SLICE-151-9, D9-151: /market becomes the hub).
 *
 *   GET /market                — hub landing (was 301 → /services/marketplace;
 *                                redirect preserved when ARC_VENUE_ENABLED off)
 *   GET /market/jobs           — jobs board + htmx fragment
 *   GET /market/jobs/:id       — job detail
 *   GET /market/jobs/new       — post-job form (wallet → createJob)
 *   GET /market/providers      — provider offers
 *   GET /market/providers/new  — register-offer form (ERC-8004 ownerOf gate)
 *   GET /market/attestations   — shared 151-3 attestations (D11-151)
 *   GET /ui/venue/jobs-fragment — htmx poll target (~10s), syncs onchain status
 *
 * Mounted only when ARC_VENUE_ENABLED=true.
 */

import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { listJobs, listOffers, getJob, upsertJob } from "../lib/venue/store";
import {
  fetchOnchainJob,
  resolveVenueNetwork,
  type VenueNetwork,
} from "../lib/venue/chain";
import type { VenueStore as AttestationVenueStore } from "../lib/attestation-store";
import { createVenueStore } from "../lib/attestation-store";
import {
  venueHubPage,
  venueJobDetailPage,
  venueJobsFragment,
  venueJobsPage,
} from "../../views/venue-pages";
import {
  venueAttestationsPage,
  venueNewJobPage,
  venueNewProviderPage,
  venueProvidersPage,
} from "../../views/venue-forms";
import { errorResponse } from "../lib/error-response";
import { ErrorCodes } from "../lib/error-codes";

const ERC8183_STATUS: Record<number, string> = {
  0: "open",
  1: "funded",
  2: "submitted",
  3: "completed",
  4: "rejected",
  5: "expired",
};

export interface VenuePageDeps {
  network?: () => VenueNetwork;
  onchainJob?: typeof fetchOnchainJob;
  attestations?: AttestationVenueStore;
}

const defaultAttestStore = createVenueStore();

/** Sync store status for jobs that have an onchainJobId (bounded). */
async function syncOnchainStatuses(
  jobs: ReturnType<typeof listJobs>,
  net: VenueNetwork,
  onchainJob: NonNullable<VenuePageDeps["onchainJob"]>,
): Promise<void> {
  const syncable = jobs.filter((j) => j.onchainJobId != null).slice(0, 10);
  await Promise.all(
    syncable.map(async (job) => {
      const raw = await onchainJob(job.onchainJobId!, net);
      if (raw) {
        const mapped = ERC8183_STATUS[raw.status];
        if (mapped && mapped !== job.status) {
          job.status = mapped as typeof job.status;
          upsertJob(job);
        }
      }
    }),
  );
}

export function createVenuePageRoutes(deps: VenuePageDeps = {}) {
  const app = new Hono();
  const net = deps.network ?? resolveVenueNetwork;
  const onchainJob = deps.onchainJob ?? fetchOnchainJob;
  const attestStore = deps.attestations ?? defaultAttestStore;

  // ── /market hub (D9-151) ───────────────────────────────────────
  app.get(
    "/market",
    describeRoute({
      tags: ["Venue"],
      summary: "Venue hub landing",
      responses: { 200: { description: "HTML hub page" } },
    }),
    (c) => {
      const jobs = listJobs();
      return c.html(
        venueHubPage(
          {
            jobs: jobs.length,
            jobsOpen: jobs.filter((j) => j.status === "open").length,
            usdcVolume: jobs.reduce((s, j) => s + j.budgetUsdc, 0),
            providers: listOffers().length,
            attestations: attestStore.size(),
          },
          net(),
        ),
      );
    },
  );

  // ── /market/jobs board ─────────────────────────────────────────
  app.get(
    "/market/jobs",
    describeRoute({
      tags: ["Venue"],
      summary: "Jobs board page",
      responses: { 200: { description: "HTML board" } },
    }),
    (c) => {
      const filter = {
        status: c.req.query("status") || undefined,
        category: c.req.query("category") || undefined,
      };
      return c.html(venueJobsPage(listJobs(filter), filter, net()));
    },
  );

  // ── htmx poll fragment ─────────────────────────────────────────
  app.get(
    "/ui/venue/jobs-fragment",
    describeRoute({
      tags: ["Venue"],
      summary: "Jobs board htmx fragment (poll ~10s, syncs onchain status)",
      responses: { 200: { description: "HTML fragment" } },
    }),
    async (c) => {
      const filter = {
        status: c.req.query("status") || undefined,
        category: c.req.query("category") || undefined,
      };
      const jobs = listJobs(filter);
      await syncOnchainStatuses(jobs, net(), onchainJob);
      return c.html(venueJobsFragment(listJobs(filter), net()));
    },
  );

  // ── /market/jobs/new form ──────────────────────────────────────
  app.get(
    "/market/jobs/new",
    describeRoute({
      tags: ["Venue"],
      summary: "Post-job form (wallet → createJob tx)",
      responses: { 200: { description: "HTML form" } },
    }),
    (c) => c.html(venueNewJobPage(net())),
  );

  // ── /market/jobs/:id detail ────────────────────────────────────
  app.get(
    "/market/jobs/:id",
    describeRoute({
      tags: ["Venue"],
      summary: "Job detail page",
      responses: {
        200: { description: "HTML detail" },
        404: { description: "Unknown job" },
      },
    }),
    async (c) => {
      const job = getJob(c.req.param("id"));
      if (!job) {
        return errorResponse(
          c,
          404,
          ErrorCodes.RESOURCE_NOT_FOUND,
          "unknown jobId",
        );
      }
      if (job.onchainJobId != null) {
        await syncOnchainStatuses([job], net(), onchainJob);
      }
      return c.html(venueJobDetailPage(job, net()));
    },
  );

  // ── /market/providers ──────────────────────────────────────────
  app.get(
    "/market/providers",
    describeRoute({
      tags: ["Venue"],
      summary: "Provider offers page",
      responses: { 200: { description: "HTML list" } },
    }),
    (c) => c.html(venueProvidersPage(listOffers({ limit: 50 }), net())),
  );

  // ── /market/providers/new ──────────────────────────────────────
  app.get(
    "/market/providers/new",
    describeRoute({
      tags: ["Venue"],
      summary: "Register-offer form (ERC-8004 ownerOf gate)",
      responses: { 200: { description: "HTML form" } },
    }),
    (c) => c.html(venueNewProviderPage(net())),
  );

  // ── /market/attestations (D11-151) ─────────────────────────────
  app.get(
    "/market/attestations",
    describeRoute({
      tags: ["Venue"],
      summary: "Onchain attestations page (shared 151-3 store)",
      responses: { 200: { description: "HTML page" } },
    }),
    (c) => c.html(venueAttestationsPage(attestStore.list(50), net())),
  );

  return app;
}

export const venuePageRoutes = createVenuePageRoutes();
