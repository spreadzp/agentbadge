/**
 * EPIC-232 (SLICE-232-1, D-232-3): AutomationPolicy resolution +
 * writes.
 *
 * Resolution: a missing policy row resolves to mode `off` — an
 * unconfigured scenario is safely inert by default; rows are created
 * explicitly (admin UI in 232-8, seeds, or the budget guard's audit
 * trail). Writes always pair the mutation with a PolicyChange row so
 * the audit stream is complete by construction.
 */

import type {
  AiMode,
  AiStore,
  AutomationPolicyRecord,
  PolicyChangeRecord,
} from "./types";
import { AI_MODES } from "./types";

export interface ResolvedPolicy {
  /** Declared mode on the row; "off" when no row exists. */
  mode: AiMode;
  confidenceThreshold: number | null;
  model: string | null;
  record: AutomationPolicyRecord | null;
}

export async function resolvePolicy(
  store: AiStore,
  scenario: string,
): Promise<ResolvedPolicy> {
  const row = await store.getPolicy(scenario);
  if (!row) {
    return { mode: "off", confidenceThreshold: null, model: null, record: null };
  }
  return {
    mode: (AI_MODES as readonly string[]).includes(row.mode)
      ? (row.mode as AiMode)
      : "off",
    confidenceThreshold: row.confidenceThreshold,
    model: row.model,
    record: row,
  };
}

export async function setPolicyMode(
  store: AiStore,
  scenario: string,
  mode: AiMode,
  actor: string,
  reason?: string,
): Promise<{
  policy: AutomationPolicyRecord;
  change: PolicyChangeRecord | null;
}> {
  const before = await store.getPolicy(scenario);
  return store.upsertPolicy(
    scenario,
    { mode, updatedBy: actor },
    {
      scenario,
      field: "mode",
      oldValue: before?.mode ?? null,
      newValue: mode,
      actor,
      reason: reason ?? null,
    },
  );
}

/** O4: per-scenario model override — null → env global `AI_MODEL`. */
export async function setPolicyModel(
  store: AiStore,
  scenario: string,
  model: string | null,
  actor: string,
  reason?: string,
) {
  const before = await store.getPolicy(scenario);
  return store.upsertPolicy(
    scenario,
    { model, updatedBy: actor },
    {
      scenario,
      field: "model",
      oldValue: before?.model ?? null,
      newValue: model,
      actor,
      reason: reason ?? null,
    },
  );
}

export async function setPolicyThreshold(
  store: AiStore,
  scenario: string,
  confidenceThreshold: number | null,
  actor: string,
  reason?: string,
) {
  const before = await store.getPolicy(scenario);
  return store.upsertPolicy(
    scenario,
    { confidenceThreshold, updatedBy: actor },
    {
      scenario,
      field: "confidenceThreshold",
      oldValue: before?.confidenceThreshold?.toString() ?? null,
      newValue: confidenceThreshold?.toString() ?? null,
      actor,
      reason: reason ?? null,
    },
  );
}
