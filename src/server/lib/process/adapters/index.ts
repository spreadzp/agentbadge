/**
 * SLICE-236-3 (D-236-Q1): adapter registry — `kind/source → adapter`.
 *
 * Each adapter declares `handles(event)` + `project(event)`; a new
 * domain = a new file + one registration. `project()` always returns a
 * VALID projection — an event no adapter claims still gets a 200-level
 * UNSUPPORTED projection + TYPE_UNKNOWN issue (D-236-Q4); forwards-
 * compatible with new econ-events kinds.
 */
import type { ProcessEventProjection } from "../projections/types";
import { unsupportedProjection } from "./helpers";
import type { EconomicEventLike, ProcessAdapter } from "./types";

export interface AdapterRegistry {
  /** First adapter claiming the event, undefined when none does. */
  adapterFor(event: EconomicEventLike): ProcessAdapter | undefined;
  /** Routed projection — UNSUPPORTED fallback when unclaimed. */
  project(event: EconomicEventLike): Promise<ProcessEventProjection>;
}

export function createAdapterRegistry(
  adapters: readonly ProcessAdapter[],
): AdapterRegistry {
  const adapterFor = (event: EconomicEventLike) =>
    adapters.find((a) => a.handles(event));
  return {
    adapterFor,
    async project(event) {
      const adapter = adapterFor(event);
      if (!adapter) return unsupportedProjection(event, "unmapped", "0.0.0");
      return adapter.project(event);
    },
  };
}
