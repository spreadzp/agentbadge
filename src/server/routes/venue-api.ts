/**
 * SLICE-151-9: Venue API (D8-151 observer + entry points).
 * Mounted only when ARC_VENUE_ENABLED=true (D15 gate).
 * Attestations share the 151-3 store (D11-151); chain reads injected for tests.
 */
import { Hono } from "hono";
import { randomBytes } from "node:crypto";
import { encodeFunctionData, getAddress, isAddress, parseUnits, type Hex } from "viem";
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
import {
  resolveFeeMode,
  venueEconomics,
} from "../lib/venue/economics";
import type { VenueIndexerDeps } from "../lib/venue/indexer";
import { venueStats } from "../lib/venue/indexer";
import type { ProviderProfileDeps } from "../lib/venue/profiles";
import { registerVenueIndexerRoutes } from "./venue-api-indexer";
import { registerVenueProfileRoutes } from "./venue-api-profiles";
import {
  ERC8183_STATUS,
  dr,
  signedJson,
  str,
  venueEvaluator,
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
    const jobs = listJobs({
      status: c.req.query("status") || undefined,
      category: c.req.query("category") || undefined,
      limit: Number(c.req.query("limit") ?? 50) || 50,
    });
    return c.json({ jobs, count: jobs.length, network: net().name });
  });

  // POST /api/venue/jobs — record + prepared createJob calldata.
  app.post("/api/venue/jobs", dr("Create job → prepared createJob tx"), async (c) => {
    const s = await signedJson(c);
    if (s instanceof Response) return s;
    const { body } = s;
    const title = str(body.title, 120);
    const description = str(body.description, 2000);
    const category = body.category == null ? undefined : str(body.category, 50);
    const budgetUsdc = Number(body.budgetUsdc);
    if (!title || !description) {
      return errorResponse(c, 400, ErrorCodes.MISSING_FIELDS,
        "title (≤120) + description (≤2000) required");
    }
    if (!Number.isFinite(budgetUsdc) || budgetUsdc <= 0 || budgetUsdc > 1_000_000) {
      return errorResponse(c, 400, ErrorCodes.INVALID_INPUT,
        "budgetUsdc must be a number in (0, 1000000]");
    }
    const provider = str(body.provider, 42);
    if (provider != null && !isAddress(provider)) {
      return errorResponse(c, 400, ErrorCodes.INVALID_INPUT, "provider must be 0x…");
    }
    const n = net();
    const econ = venueEconomics();
    const evaluator = venueEvaluator();
    const expiredAt = BigInt(Math.floor(Date.now() / 1000) + 30 * 86_400);
    const jobId = `vj_${randomBytes(8).toString("hex")}`;
    const job: VenueJob = {
      jobId, title, description, budgetUsdc,
      status: "pending",
      client: s.wallet,
      provider: provider ? getAddress(provider) : undefined,
      evaluator,
      category: category ?? undefined,
      createdAt: new Date().toISOString(),
      chainTxs: {},
    };
    // 152-4: resolve take-rate mode at creation (open jobs re-resolve at
    // claim once provider is known) and arm the eval-fee ledger.
    job.feeMode = resolveFeeMode(job, econ, n);
    if (econ.evalFeeAtomic > 0n) {
      job.evalFee = {
        required: true,
        paid: false,
        amountAtomic: econ.evalFeeAtomic.toString(),
      };
    }
    upsertJob(job);
    recordVenueEvent({
      action: "job.created",
      text: `job posted — “${title}” · $${budgetUsdc} USDC`,
      jobId,
      dedupeKey: `job.created:${jobId}`,
    });
    const createData = encodeFunctionData({
      abi: n.abi,
      functionName: "createJob",
      args: [
        (provider ?? "0x0000000000000000000000000000000000000000") as `0x${string}`,
        evaluator, expiredAt,
        `${title} — ${description}`.slice(0, 512),
        // 152-4: IACPHook address when hook fee mode is configured.
        (econ.feeHook ??
          "0x0000000000000000000000000000000000000000") as `0x${string}`,
      ],
    } as never);
    const budgetBase = parseUnits(String(budgetUsdc), 6);
    return c.json({
      job,
      network: n.name,
      txs: {
        createJob: {
          to: n.agenticCommerce,
          data: createData,
          description:
            `Broadcast this tx, then POST /api/venue/jobs/${jobId}/tx ` +
            `{hash, phase:'created'} to attach it.`,
        },
        note:
          `After createJob confirms: setBudget(jobId, ${budgetBase}, 0x), ` +
          `then approve USDC + fund(jobId, ${budgetBase}, 0x).`,
      },
    });
  });

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
