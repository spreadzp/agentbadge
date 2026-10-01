/**
 * SLICE-152-5: venue indexer health + stats aggregates.
 * Health reads the indexer watermark meta; stats aggregate the local index
 * (D5-152 read path — routes serve from the index, not the chain).
 * Split out of indexer.ts (max-lines).
 */
import { resolveVenueNetwork } from "./chain";
import {
  indexerMetaKeys,
  type VenueIndexerDeps,
  type VenueIndexerRun,
} from "./indexer";
import { defaultGetHead } from "./indexer-rpc";
import { getVenueMeta, listJobs, listOffers } from "./store";

export interface VenueIndexerHealth {
  watermark: number;
  head: number;
  lag: number;
  lastRun?: VenueIndexerRun & { at: string };
}

export async function venueIndexerHealth(
  deps: VenueIndexerDeps = {},
): Promise<VenueIndexerHealth> {
  const net = (deps.network ?? resolveVenueNetwork)();
  const getHead = deps.getHead ?? defaultGetHead(net);
  const head = Number(await getHead().catch(() => 0n));
  const k = indexerMetaKeys(net.name);
  const watermark = getVenueMeta<number>(k.watermark) ?? 0;
  return {
    watermark,
    head,
    lag: Math.max(0, head - watermark),
    lastRun: getVenueMeta<VenueIndexerHealth["lastRun"]>(k.lastRun),
  };
}

export interface VenueStats {
  jobsTotal: number;
  jobsByStatus: Record<string, number>;
  volumeUsdc: number;
  feedbackCount: number;
  providersActive: number;
  offersActive: number;
}

/** Aggregates for /api/venue/stats — computed from the index (D5-152). */
export function venueStats(): VenueStats {
  const jobs = listJobs();
  const byStatus: Record<string, number> = {};
  let volume = 0;
  let feedback = 0;
  const providers = new Set<string>();
  for (const j of jobs) {
    byStatus[j.status] = (byStatus[j.status] ?? 0) + 1;
    volume += j.budgetUsdc;
    if (j.feedback?.status === "sent") feedback++;
    if (j.provider && j.status !== "pending") {
      providers.add(j.provider.toLowerCase());
    }
  }
  return {
    jobsTotal: jobs.length,
    jobsByStatus: byStatus,
    volumeUsdc: Math.round(volume * 100) / 100,
    feedbackCount: feedback,
    providersActive: providers.size,
    offersActive: listOffers({ active: true }).length,
  };
}
