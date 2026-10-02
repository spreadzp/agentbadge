/**
 * SLICE-152-6: provider/client profiles — ERC-8004 read path.
 *
 * Profile = merge of three sources:
 *   1. venue index (jobs + offers) — stats, recentJobs, offers
 *   2. onchain identity — agentId from venue records (offer.agentId /
 *      job.providerAgentId), then ownerOf + tokenURI on IdentityRegistry
 *   3. reputation — ReputationRegistry is currently write-only
 *      (giveFeedback), so score falls back to the venue index and reports
 *      `source: "index"`. An onchain read seam (`reputationRead` dep) is
 *      injectable for when a read function lands — then source="onchain".
 *
 * Deps are injectable so tests never touch RPC.
 */
import {
  fetchAgentLookup,
  resolveVenueNetwork,
  type AgentLookup,
  type VenueNetwork,
} from "./chain";
import { listJobs, listOffers, type VenueJob, type VenueOffer } from "./store";

export interface ProviderProfileDeps {
  network?: () => VenueNetwork;
  /** ERC-8004 identity read; default = ownerOf+tokenURI on IdentityRegistry. */
  agentLookup?: (agentId: number, net: VenueNetwork) => Promise<AgentLookup>;
  /**
   * Optional onchain reputation read (ReputationRegistry). Return null when
   * unavailable → index fallback with source="index".
   */
  reputationRead?: (
    agentId: number,
    net: VenueNetwork,
  ) => Promise<{ score: number; count: number } | null>;
}

export interface ProviderStats {
  jobsDone: number;
  jobsRejected: number;
  jobsActive: number;
  /** Sent feedback count; score shape kept numeric for UI. */
  feedbackScore: number;
  /** "onchain" | "index" — which source produced feedbackScore. */
  feedbackSource: "onchain" | "index";
  /**
   * 153-6: subjective client channel — avg of job.rating.score over
   * rated completed jobs (D7). source "index" = our venue store.
   */
  clientRating?: { avg: number; count: number; source: "index" };
  lastActiveAt?: string;
}

export interface ProviderProfile {
  address: string;
  agentId?: number;
  owner?: string;
  metadataURI?: string;
  stats: ProviderStats;
  offers: VenueOffer[];
  recentJobs: VenueJob[];
}

export interface ClientProfile {
  address: string;
  agentId?: number;
  stats: {
    jobsPosted: number;
    jobsFunded: number;
    jobsCompleted: number;
    /** Share of posted jobs that reached funded or beyond (0..1). */
    fundedRate: number;
    /** Whether client reputation feedback is enabled (ARC_VENUE_RATE_CLIENTS). */
    rated: boolean;
  };
  recentJobs: VenueJob[];
}

const lc = (a?: string) => (a ?? "").toLowerCase();

/** Distinct provider addresses across offers + claimed/indexed jobs. */
export function listProviderAddresses(): string[] {
  const set = new Set<string>();
  for (const o of listOffers()) set.add(lc(o.providerAddress));
  for (const j of listJobs()) {
    if (j.provider) set.add(lc(j.provider));
  }
  return [...set].sort();
}

/** agentId for an address from venue records — offer first, then jobs. */
function resolveAgentId(
  address: string,
  offers: VenueOffer[],
  jobs: VenueJob[],
): number | undefined {
  const offer = offers.find((o) => o.agentId != null);
  if (offer?.agentId != null) return offer.agentId;
  const job = jobs.find((j) => j.providerAgentId != null);
  return job?.providerAgentId;
}

async function identityFor(
  agentId: number | undefined,
  deps: Required<Pick<ProviderProfileDeps, "agentLookup" | "network">>,
): Promise<{ owner?: string; metadataURI?: string }> {
  if (agentId == null) return {};
  try {
    const { owner, metadataURI } = await deps.agentLookup(
      agentId,
      deps.network(),
    );
    return {
      owner: owner ?? undefined,
      metadataURI: metadataURI ?? undefined,
    };
  } catch {
    return {};
  }
}

/**
 * Provider profile: identity + index stats + offers + recent jobs.
 * Unknown address → empty profile (zeros), never throws.
 */
export async function getProviderProfile(
  address: string,
  deps: ProviderProfileDeps = {},
): Promise<ProviderProfile> {
  const addr = lc(address);
  const offers = listOffers().filter((o) => lc(o.providerAddress) === addr);
  const jobs = listJobs().filter((j) => lc(j.provider) === addr);
  const agentId = resolveAgentId(addr, offers, jobs);

  const done = jobs.filter((j) => j.status === "completed");
  const rejected = jobs.filter((j) => j.status === "rejected");
  const active = jobs.filter((j) =>
    ["claimed", "funded", "submitted"].includes(j.status),
  );
  const indexFeedback = jobs.filter((j) => j.feedback?.status === "sent");
  const lastActiveAt =
    jobs.length > 0
      ? jobs.map((j) => j.createdAt).sort().at(-1)
      : offers.map((o) => o.createdAt).sort().at(-1);

  // Reputation: onchain seam first, venue index fallback.
  let feedbackScore = indexFeedback.length;
  let feedbackSource: ProviderStats["feedbackSource"] = "index";
  if (deps.reputationRead && agentId != null) {
    const net = (deps.network ?? resolveVenueNetwork)();
    const onchain = await deps.reputationRead(agentId, net).catch(() => null);
    if (onchain) {
      feedbackScore = onchain.score;
      feedbackSource = "onchain";
    }
  }

  const identity = await identityFor(agentId, {
    agentLookup: deps.agentLookup ?? fetchAgentLookup,
    network: deps.network ?? resolveVenueNetwork,
  });

  // 153-6: subjective client ratings — avg over rated completed jobs.
  const ratedJobs = done.filter((j) => j.rating != null);
  const clientRating = ratedJobs.length > 0
    ? {
      avg: ratedJobs.reduce((s, j) => s + j.rating!.score, 0) / ratedJobs.length,
      count: ratedJobs.length,
      source: "index" as const,
    }
    : undefined;

  return {
    address,
    agentId,
    ...identity,
    stats: {
      jobsDone: done.length,
      jobsRejected: rejected.length,
      jobsActive: active.length,
      feedbackScore,
      feedbackSource,
      clientRating,
      lastActiveAt,
    },
    offers: [...offers].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    recentJobs: [...jobs]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 10),
  };
}

/** List-page rows — index data only, no chain calls (fast). */
export interface ProviderSummary {
  address: string;
  agentId?: number;
  name?: string;
  jobsDone: number;
  jobsActive: number;
  feedbackScore: number;
  /** 153-6: client-rating avg on the list page (index source). */
  clientRatingAvg?: number;
  offersActive: number;
  lastActiveAt?: string;
}

export function listProviderSummaries(): ProviderSummary[] {
  return listProviderAddresses().map((addr) => {
    const offers = listOffers().filter(
      (o) => lc(o.providerAddress) === addr,
    );
    const jobs = listJobs().filter((j) => lc(j.provider) === addr);
    const agentId = resolveAgentId(addr, offers, jobs);
    const rated = jobs.filter(
      (j) => j.status === "completed" && j.rating != null,
    );
    return {
      address: addr,
      agentId,
      name: offers.find((o) => o.name)?.name,
      jobsDone: jobs.filter((j) => j.status === "completed").length,
      jobsActive: jobs.filter((j) =>
        ["claimed", "funded", "submitted"].includes(j.status),
      ).length,
      feedbackScore: jobs.filter((j) => j.feedback?.status === "sent").length,
      clientRatingAvg: rated.length > 0
        ? rated.reduce((s, j) => s + j.rating!.score, 0) / rated.length
        : undefined,
      offersActive: offers.filter((o) => o.active).length,
      lastActiveAt:
        [...jobs.map((j) => j.createdAt), ...offers.map((o) => o.createdAt)]
          .sort()
          .at(-1) ?? undefined,
    };
  });
}

/**
 * Client profile (symmetric, thin): posted/funded/completed + funded rate.
 * `rated` reflects ARC_VENUE_RATE_CLIENTS — client feedback via 152-3.
 */
export function getClientProfile(address: string): ClientProfile {
  const addr = lc(address);
  const jobs = listJobs().filter((j) => lc(j.client) === addr);
  const funded = jobs.filter(
    (j) =>
      j.chainTxs.funded ||
      ["funded", "submitted", "completed", "rejected"].includes(j.status),
  );
  return {
    address,
    agentId: jobs.find((j) => j.clientAgentId != null)?.clientAgentId,
    stats: {
      jobsPosted: jobs.length,
      jobsFunded: funded.length,
      jobsCompleted: jobs.filter((j) => j.status === "completed").length,
      fundedRate: jobs.length ? funded.length / jobs.length : 0,
      rated: process.env.ARC_VENUE_RATE_CLIENTS === "1",
    },
    recentJobs: [...jobs]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 10),
  };
}
