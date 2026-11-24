import type { DemandStore } from "./store";
import type { DemandMemoryData } from "./store-memory-core";
import { createMemoryDemandCore } from "./store-memory-core";
import { memorySignalOps } from "./store-memory-signals";
import { memoryClusterOps } from "./store-memory-clusters";
import {
  memoryEventOps,
  memoryOpportunityOps,
} from "./store-memory-opportunities";

export type { DemandMemoryData };
export { createMemoryDemandData } from "./store-memory-core";

/**
 * EPIC-231 (SLICE-231-1, D-143/D-229-1): in-memory demand store —
 * behavioral parity with the Postgres adapter (same dedup rules,
 * same canonical-only recount, same status machines, same
 * append-only events).
 *
 * "Atomic" = synchronous body inside the async method: a refusal
 * writes NOTHING, exactly like a rolled-back tx. Split across
 * store-memory-{core,signals,clusters,opportunities}.ts for
 * max-lines.
 */

export function createMemoryDemandStore(
  data: DemandMemoryData,
): DemandStore {
  const core = createMemoryDemandCore(data);
  return {
    backend: "memory",
    ...memorySignalOps(core),
    ...memoryClusterOps(core),
    ...memoryOpportunityOps(core),
    ...memoryEventOps(core),
  };
}
