/**
 * SLICE-151-9: Venue API (D8-151 observer + entry points).
 * Mounted only when ARC_VENUE_ENABLED=true (D15 gate).
 * Attestations share the 151-3 store (D11-151); chain reads injected for tests.
 */
import { Hono } from "hono";
import type { Hex } from "viem";
import type { VenueStore as AttestationVenueStore } from "../lib/attestation-store";
import { sharedVenueStore } from "../lib/attestation-store";
import {
  getJob,
  listJobs,
  listOffers,
  upsertJob,
  type VenueJob,
} from "../lib/venue/store";
import { registerOfferRoutes } from "./venue-api-offers";
import { registerLifecycleRoutes } from "./venue-api-lifecycle";
import type { PreparedTx, VenueRole } from "../lib/venue/lifecycle";
import type { FeedbackSender } from "../lib/venue/reputation-loop";
import {
  fetchAgentOwner,
  fetchCreatedJobId,
  fetchOnchainJob,
  resolveVenueNetwork,
  type VenueNetwork,
} from "../lib/venue/chain";
import { errorResponse } from "../lib/error-response";
import { ErrorCodes } from "../lib/error-codes";
import { venueEconomics } from "../lib/venue/economics";
import type { VenueIndexerDeps } from "../lib/venue/indexer";
import { venueStats } from "../lib/venue/indexer";
import type { ProviderProfileDeps } from "../lib/venue/profiles";
import { registerVenueIndexerRoutes } from "./venue-api-indexer";
import { registerVenueProfileRoutes } from "./venue-api-profiles";
import {
  registerVenueInstanceRoutes,
  venueScope,
} from "./venue-api-instances";
import { registerVenueInstancePrivateRoutes } from "./venue-api-instances-private";
import { registerVenueAdminRoutes } from "./venue-api-admin";
import { registerVenueBillingRoutes, type VenueBillingDeps } from "./venue-api-billing";
import { createVenueJob } from "./venue-job-create";
import {
  ERC8183_STATUS,
  dr,
} from "./venue-api-helpers";
import {
  listVenueActivity,
  recordVenueEvent,
} from "../services/venue-events";

/** Injectable seam — tests stub onchain reads. */
export interface VenueDeps {
  network?: () => VenueNetwork;
  onchainJob?: (id: number, net: VenueNetwork) => Promise<unknown>;
  agentOwner?: (id: number, net: VenueNetwork) => Promise<`0x${string}` | null>;
  /** Resolve onchainJobId from a confirmed createJob tx receipt. */
  txJobId?: (txHash: `0x${string}`, net: VenueNetwork) => Promise<number | null>;
  /** Server-sign sender for lifecycle routes (152-2); null = not allowed. */
  sendTx?: (role: VenueRole, txs: PreparedTx[], net: VenueNetwork) => Promise<Hex[] | null>;
  /** Reputation feedback sender (152-3) — default: evaluator EOA via sendAsRole. */
  sendFeedback?: FeedbackSender;
  /** ERC-8004 agentId resolvers for the reputation loop (152-3). */
  providerAgentId?: (job: VenueJob, net: VenueNetwork) => Promise<number | null>;
  clientAgentId?: (job: VenueJob, net: VenueNetwork) => Promise<number | null>;
  /** Provider profile deps (152-6) — agentLookup/reputationRead seams. */
  profiles?: ProviderProfileDeps;
  /** Event indexer seam (152-5) — tests inject fake log sources. */
  indexer?: VenueIndexerDeps;
  attestations?: AttestationVenueStore;
  /** 153-5: subscription settle + optional pass-mint seams (x402 wiring). */
  billing?: VenueBillingDeps;
}

const defaultAttestStore = sharedVenueStore();

export function createVenueApiRoutes(deps: VenueDeps = {}) {
  const app = new Hono();
  const net = deps.network ?? resolveVenueNetwork;
  const onchainJob = deps.onchainJob ?? fetchOnchainJob;
  const agentOwner = deps.agentOwner ?? fetchAgentOwner;
  const txJobId = deps.txJobId ?? fetchCreatedJobId;
  const attestStore = deps.attestations ?? defaultAttestStore;

  app.get("/api/venue/jobs", dr("List venue jobs"), (c) => {
    // 153-1: ?venue=<id|slug> scopes the listing to a venue instance.
    const jobs = listJobs({
      status: c.req.query("status") || undefined,
      category: c.req.query("category") || undefined,
      venueId: venueScope(c.req.query("venue")),
      limit: Number(c.req.query("limit") ?? 50) || 50,
    });
    return c.json({ jobs, count: jobs.length, network: net().name });
  });

  // POST /api/venue/jobs — record + prepared createJob calldata.
  // 153-3: handler extracted to venue-job-create.ts (privateDetails wiring).
  app.post("/api/venue/jobs", dr("Create job → prepared createJob tx"),
    (c) => createVenueJob(c, net));

  // POST /jobs/:id/tx (attach tx) lives in venue-api-lifecycle.ts — max-lines.

  // GET /api/venue/jobs/:id/status — onchain pull (F1), syncs store.
  app.get("/api/venue/jobs/:id/status", dr("Pull onchain job status"), async (c) => {
    const job = getJob(c.req.param("id"));
    if (!job) {
      return errorResponse(c, 404, ErrorCodes.RESOURCE_NOT_FOUND, "unknown jobId");
    }
    if (job.onchainJobId == null) return c.json({ job, onchain: null });
    const raw = (await onchainJob(job.onchainJobId, net())) as { status: number } | null;
    if (raw) {
      const mapped = ERC8183_STATUS[raw.status];
      if (mapped && mapped !== job.status) {
        recordVenueEvent({
          action: "job.status",
          text: `job ${job.jobId} — ${job.status} → ${mapped}`,
          jobId: job.jobId,
          dedupeKey: `job.status:${job.jobId}:${mapped}`,
        });
        job.status = mapped as VenueJob["status"];
        upsertJob(job);
      }
    }
    return c.json({ job, onchain: raw });
  });

  // Offers catalog routes — SLICE-152-1, extracted to venue-api-offers.ts
  registerOfferRoutes(app, { network: net, agentOwner });

  // Jobs lifecycle routes — SLICE-152-2, extracted to venue-api-lifecycle.ts
  registerLifecycleRoutes(app, {
    network: net,
    onchainJob,
    txJobId,
    sendTx: deps.sendTx,
    sendFeedback: deps.sendFeedback,
    providerAgentId: deps.providerAgentId,
    clientAgentId: deps.clientAgentId,
  });

  // Venue instances (tenancy registry) — SLICE-153-1, venue-api-instances.ts
  registerVenueInstanceRoutes(app);
  // 153-3: scoped private-job create + verify-commitment — venue-api-instances-private.ts
  registerVenueInstancePrivateRoutes(app, net);
  // 153-4: admin console routes — PATCH :id, GET :id/admin, POST :id/delegates
  registerVenueAdminRoutes(app);
  // 153-5: billing routes — POST :id/subscribe, GET :id/economics, GET :id/billing
  registerVenueBillingRoutes(app, deps.billing);

  // Indexer + stats routes — SLICE-152-5, venue-api-indexer.ts
  registerVenueIndexerRoutes(app, { indexer: deps.indexer });
  // Provider/client profiles — SLICE-152-6, venue-api-profiles.ts
  registerVenueProfileRoutes(app, { profiles: deps.profiles });

  app.get("/api/venue/attestations", dr("Recent attestations"), (c) => {
    const limit = Number(c.req.query("limit") ?? 50) || 50;
    return c.json({
      attestations: attestStore.list(limit),
      count: Math.min(attestStore.size(), limit),
    });
  });

  // GET /api/venue/activity — merged recent venue events + attestations (D-F9).
  app.get("/api/venue/activity", dr("Recent venue activity feed"), async (c) => {
    const limit = Number(c.req.query("limit") ?? 20) || 20;
    const events = await listVenueActivity(limit);
    const attestations = attestStore.list(limit).map((a) => ({
      action: "attestation.minted",
      text: `attestation minted — ${a.domain} · score ${a.score}`,
      at: a.createdAt,
      tx: a.feedbackTx,
    }));
    const activity = [...events, ...attestations]
      .sort((x, y) => y.at.localeCompare(x.at))
      .slice(0, limit);
    return c.json({ activity, count: activity.length, network: net().name });
  });

  // SLICE-152-5: header shape kept for compat + richer index aggregates.
  app.get("/api/venue/stats", dr("Venue header stats"), (c) => {
    const jobs = listJobs();
    const agg = venueStats();
    return c.json({
      network: net().name,
      jobs: jobs.length,
      jobsOpen: jobs.filter((j) => j.status === "open").length,
      usdcVolume: jobs.reduce((s, j) => s + j.budgetUsdc, 0),
      providers: listOffers().length,
      attestations: attestStore.size(),
      jobsTotal: agg.jobsTotal,
      jobsByStatus: agg.jobsByStatus,
      feedbackCount: agg.feedbackCount,
      providersActive: agg.providersActive,
      offersActive: agg.offersActive,
    });
  });

  // GET /api/venue/economics — public fee transparency (152-4).
  app.get("/api/venue/economics", dr("Venue economics config"), (c) => {
    const econ = venueEconomics();
    const n = net();
    const modes = {
      hook: econ.feeHook != null,
      sweep: econ.treasury != null && econ.takeRateBps > 0,
      none: true,
    };
    return c.json({
      network: n.name,
      takeRateBps: econ.takeRateBps,
      evalFeeAtomic: econ.evalFeeAtomic.toString(),
      treasury: econ.treasury,
      feeHook: econ.feeHook,
      feeModes: modes,
      docs: "hook=onchain IACPHook split · sweep=post-settlement transfer from server provider EOA · none=external provider",
    });
  });

  return app;
}

export const venueApiRoutes = createVenueApiRoutes();
