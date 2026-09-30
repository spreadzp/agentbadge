/**
 * SLICE-151-9: Venue API (D8-151 observer + entry points).
 * Mounted only when ARC_VENUE_ENABLED=true (D15 gate).
 * Attestations share the 151-3 store (D11-151); chain reads injected for tests.
 */
import { Hono } from "hono";
import { randomBytes } from "node:crypto";
import { encodeFunctionData, getAddress, isAddress, parseUnits } from "viem";
import { logger } from "@agentbadge/passport";
import type { VenueStore as AttestationVenueStore } from "../lib/attestation-store";
import { createVenueStore } from "../lib/attestation-store";
import {
  getJob,
  listJobs,
  listOffers,
  upsertJob,
  upsertOffer,
  type VenueJob,
} from "../lib/venue/store";
import {
  fetchAgentOwner,
  fetchOnchainJob,
  resolveVenueNetwork,
  type VenueNetwork,
} from "../lib/venue/chain";
import { errorResponse } from "../lib/error-response";
import { ErrorCodes } from "../lib/error-codes";
import {
  ERC8183_STATUS,
  TX_PHASES,
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
  attestations?: AttestationVenueStore;
}

const defaultAttestStore = createVenueStore();

export function createVenueApiRoutes(deps: VenueDeps = {}) {
  const app = new Hono();
  const net = deps.network ?? resolveVenueNetwork;
  const onchainJob = deps.onchainJob ?? fetchOnchainJob;
  const agentOwner = deps.agentOwner ?? fetchAgentOwner;
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
        "0x0000000000000000000000000000000000000000" as `0x${string}`,
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

  // POST /api/venue/jobs/:id/tx — attach broadcast tx hash for a phase.
  app.post("/api/venue/jobs/:id/tx", dr("Attach tx hash to job phase"), async (c) => {
    const job = getJob(c.req.param("id"));
    if (!job) {
      return errorResponse(c, 404, ErrorCodes.RESOURCE_NOT_FOUND, "unknown jobId");
    }
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    const hash = str(body?.hash, 66);
    const phase = str(body?.phase, 20);
    if (!hash || !/^0x[0-9a-fA-F]{64}$/.test(hash)) {
      return errorResponse(c, 400, ErrorCodes.INVALID_INPUT, "hash must be 0x<64hex>");
    }
    if (!phase || !(TX_PHASES as readonly string[]).includes(phase)) {
      return errorResponse(c, 400, ErrorCodes.INVALID_INPUT,
        "phase ∈ {created,funded,submitted,completed}");
    }
    job.chainTxs[phase as keyof VenueJob["chainTxs"]] = hash;
    if (phase === "created" && job.status === "pending") job.status = "open";
    upsertJob(job);
    recordVenueEvent({
      action: "job.tx",
      text: `job ${job.jobId} — ${phase} tx confirmed`,
      jobId: job.jobId,
      tx: hash,
      dedupeKey: `job.tx:${job.jobId}:${phase}`,
    });
    return c.json({ job });
  });

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

  app.get("/api/venue/offers", dr("List provider offers"), (c) =>
    c.json({ offers: listOffers({ limit: 50 }), network: net().name }),
  );

  // POST /api/venue/offers — signer must own ERC-8004 agentId (D5).
  app.post("/api/venue/offers", dr("Register provider offer (ownerOf gate)"), async (c) => {
    const s = await signedJson(c);
    if (s instanceof Response) return s;
    const { body } = s;
    const agentId = Number(body.agentId);
    const name = str(body.name, 100);
    const description = str(body.description, 500);
    const endpoint = str(body.endpoint, 500);
    if (!Number.isInteger(agentId) || agentId < 0) {
      return errorResponse(c, 400, ErrorCodes.INVALID_INPUT,
        "agentId must be a non-negative integer");
    }
    if (!name || !description) {
      return errorResponse(c, 400, ErrorCodes.MISSING_FIELDS,
        "name (≤100) + description (≤500) required");
    }
    if (!endpoint || !/^https:\/\//.test(endpoint)) {
      return errorResponse(c, 400, ErrorCodes.INVALID_INPUT, "endpoint must be https://");
    }
    const n = net();
    const owner = await agentOwner(agentId, n);
    if (!owner) {
      return errorResponse(c, 400, ErrorCodes.INVALID_INPUT,
        `agentId ${agentId} not found on ${n.name} identity registry`);
    }
    if (owner.toLowerCase() !== s.wallet.toLowerCase()) {
      return errorResponse(c, 403, ErrorCodes.PASSPORT_OWNERSHIP_MISMATCH,
        `agentId ${agentId} is owned by ${owner}, not the signer`);
    }
    const offer = {
      providerAddress: s.wallet,
      agentId, name, description, endpoint,
      categories: Array.isArray(body.categories)
        ? (body.categories as unknown[])
          .map((x) => str(x, 50))
          .filter((x): x is string => !!x)
          .slice(0, 10)
        : [],
      createdAt: new Date().toISOString(),
    };
    upsertOffer(offer);
    logger.info("venue: provider offer registered", { provider: s.wallet, agentId });
    recordVenueEvent({
      action: "offer.registered",
      text: `provider registered — “${name}” · agentId ${agentId}`,
      dedupeKey: `offer:${s.wallet}:${agentId}`,
    });
    return c.json({ offer });
  });

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

  app.get("/api/venue/stats", dr("Venue header stats"), (c) => {
    const jobs = listJobs();
    return c.json({
      network: net().name,
      jobs: jobs.length,
      jobsOpen: jobs.filter((j) => j.status === "open").length,
      usdcVolume: jobs.reduce((s, j) => s + j.budgetUsdc, 0),
      providers: listOffers().length,
      attestations: attestStore.size(),
    });
  });

  return app;
}

export const venueApiRoutes = createVenueApiRoutes();
