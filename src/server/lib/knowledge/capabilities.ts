import { randomUUID } from "node:crypto";

import type { KnowledgeResult } from "./items";
import type { KnowledgeStore } from "./store";
import type { KnowledgeCapabilityRecord } from "./types";
import { KNOWLEDGE_CAPABILITY_KINDS } from "./types";

/**
 * EPIC-229 (SLICE-229-4, D-229-5): capability registry ops — the
 * m:n bridge between knowledge items and the platform's live
 * capability vocabulary (scanner checks, x402 packs, MCP tools,
 * manifests). Honest-signal wrappers over the store seam.
 */

export interface CapabilityInput {
  name: string;
  kind: string;
  description?: string | null;
  /** "SEEDED" (code-derived, verified:true) | "MANUAL" (operator). */
  source: "SEEDED" | "MANUAL" | string;
}

const NAME_MAX = 200;
const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/;

export function isValidCapabilityName(name: string): boolean {
  return NAME_RE.test(name) && name.length <= NAME_MAX;
}

/**
 * Idempotent upsert keyed on `name` — SEEDED entries carry
 * verified:true; MANUAL defaults verified:false (spec 229-4).
 */
export async function upsertKnowledgeCapability(
  store: KnowledgeStore,
  input: CapabilityInput,
): Promise<KnowledgeResult<{ capability: KnowledgeCapabilityRecord }>> {
  if (!isValidCapabilityName(input.name)) {
    return { ok: false, error: "invalid_name", field: "name" };
  }
  if (!KNOWLEDGE_CAPABILITY_KINDS.includes(input.kind as never)) {
    return { ok: false, error: "invalid_kind", field: "kind" };
  }
  const verified = input.source === "SEEDED";
  const r = await store.upsertCapability({
    id: `kc_${randomUUID()}`,
    name: input.name,
    kind: input.kind,
    description: input.description ?? null,
    source: input.source,
    verified,
  });
  return { ok: true, capability: r.row };
}

/** Link item ↔ capability. Compound-PK dedupe — repeat = created:false. */
export async function linkItemCapability(
  store: KnowledgeStore,
  itemId: string,
  capabilityId: string,
): Promise<KnowledgeResult<{ created: boolean }>> {
  const [item, cap] = await Promise.all([
    store.getItem(itemId),
    store.getCapability(capabilityId),
  ]);
  if (!item) return { ok: false, error: "item_not_found" };
  if (!cap) return { ok: false, error: "capability_not_found" };
  const r = await store.linkCapability(itemId, capabilityId);
  return { ok: true, created: r.created };
}

export async function unlinkItemCapability(
  store: KnowledgeStore,
  itemId: string,
  capabilityId: string,
): Promise<KnowledgeResult<{ removed: boolean }>> {
  const r = await store.unlinkCapability(itemId, capabilityId);
  return { ok: true, removed: r.removed };
}

export async function listKnowledgeCapabilities(
  store: KnowledgeStore,
  opts?: { verified?: boolean; kind?: string; limit?: number },
): Promise<KnowledgeCapabilityRecord[]> {
  return store.listCapabilities(opts);
}

/** Reverse lookup — which items document a capability by NAME. */
export async function itemsForKnowledgeCapability(
  store: KnowledgeStore,
  name: string,
): Promise<string[]> {
  return store.itemsForCapability(name);
}
