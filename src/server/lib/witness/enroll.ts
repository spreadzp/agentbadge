/**
 * SLICE-185-1 (EPIC-185): witness enrollment (D-185-1).
 *
 * Open enroll: any registered agent (184 api_key auth happens in the
 * route layer, 185-2) declares domains + the wallet that will sign
 * attestations. The wallet is IMMUTABLE after enroll — COI is computed
 * on it, so rotation would be a sybil escape.
 *
 * Returns a result union instead of throwing; the route layer maps
 * codes to error-catalog entries (181-1) in 185-2.
 */
import { isAddress, getAddress } from "viem";
import type { WitnessStore } from "./store";
import {
  WITNESS_DOMAINS,
  WITNESS_MAX_DOMAINS,
  type WitnessDomain,
  type WitnessEnroll,
} from "./types";

export type EnrollError =
  | "witness_invalid_domains"
  | "witness_invalid_wallet"
  | "witness_already_enrolled";

export type EnrollResult =
  | { ok: true; record: WitnessEnroll }
  | { ok: false; code: EnrollError };

const DOMAIN_SET = new Set<string>(WITNESS_DOMAINS);

export async function enrollWitness(
  store: WitnessStore,
  input: { agentId: string; domains: string[]; wallet: string },
): Promise<EnrollResult> {
  const agentId = (input.agentId ?? "").trim();
  if (!agentId) return { ok: false, code: "witness_invalid_domains" };

  const raw = Array.isArray(input.domains) ? input.domains : [];
  // Raw length is bounded BEFORE dedupe — the API contract is ≤8
  // submitted entries, not ≤8 distinct ones.
  if (raw.length === 0 || raw.length > WITNESS_MAX_DOMAINS) {
    return { ok: false, code: "witness_invalid_domains" };
  }
  const domains = [...new Set(raw)] as WitnessDomain[];
  if (domains.some((d) => !DOMAIN_SET.has(d))) {
    return { ok: false, code: "witness_invalid_domains" };
  }

  if (!isAddress(input.wallet)) {
    return { ok: false, code: "witness_invalid_wallet" };
  }
  const wallet = getAddress(input.wallet);

  const record: WitnessEnroll = {
    agentId,
    domains,
    wallet,
    enrolledAt: Date.now(),
    status: "active",
  };
  // Atomic under the store backend — a concurrent duplicate loses.
  const created = await store.putEnroll(record);
  if (!created) return { ok: false, code: "witness_already_enrolled" };
  return { ok: true, record };
}
