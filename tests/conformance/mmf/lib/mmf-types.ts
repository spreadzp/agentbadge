/**
 * SLICE-255-1: MMF corpus types — vendored Mandata vectors @ v0.4.24.
 *
 * Faithful typing: unknown keys pass through via index signatures,
 * nothing is dropped on load (round-trip lossless). Interpretation
 * lives in the adapters/runners (255-2+), not here.
 */

export type MmfTrack =
  | "core"
  | "delegation"
  | "lifecycle"
  | "credential"
  | "evidence";

export interface MmfBounds {
  max_amount?: number;
  currency?: string;
  allowed_payees?: string[];
  expires_in_days?: number;
  velocity_limit?: number;
  total_budget?: number;
  budget_window_days?: number;
  [k: string]: unknown;
}

export interface MmfMandate {
  bounds: MmfBounds;
  mandate_id?: string;
  revoked?: boolean;
  [k: string]: unknown;
}

export interface MmfTx {
  tx_id?: string;
  /** delegation steps: delegate id acting (spend-as). */
  as?: string;
  payee?: string;
  /** Numeric amount — absent when amount_json is used. */
  amount?: number;
  /**
   * Raw lexical amount form (e.g. "1.0"). MUST stay a string —
   * scalar projection keeps lexemes 1:1 (D-255-Q16).
   */
  amount_json?: string;
  currency?: string;
  at?: number;
  [k: string]: unknown;
}

export interface MmfExpect {
  allowed?: boolean;
  check?: string;
  /** V36-style: malformed input rejected before evaluation. */
  rejected?: boolean;
  replayed?: boolean;
  status?: string;
  [k: string]: unknown;
}

export interface MmfPriorTxn {
  at: number;
  amount: number;
  [k: string]: unknown;
}

export interface MmfRegistry {
  revoked?: string[];
  unavailable?: boolean;
  [k: string]: unknown;
}

export interface CoreVector {
  id: string;
  /** Most vectors use `desc`; V30 uses `description` — both kept. */
  desc?: string;
  description?: string;
  mandate: MmfMandate;
  prior_txns?: MmfPriorTxn[];
  registry?: MmfRegistry;
  tx: MmfTx;
  then_tx?: MmfTx;
  expect: MmfExpect;
  then_expect?: MmfExpect;
  [k: string]: unknown;
}

export interface DelegationStep {
  delegate?: string;
  /** Delegation-chain parent (e.g. {delegate:"g",from:"c"}). */
  from?: string;
  bounds?: MmfBounds;
  tx?: MmfTx;
  claim?: MmfTx;
  settle?: MmfTx;
  /** Always the literal "parent" in v0.4.24. */
  revoke?: string;
  at?: number;
  /** Object verdict or scalar "valid"/"invalid". */
  expect?: MmfExpect | "valid" | "invalid";
  [k: string]: unknown;
}

export interface DelegationVector {
  id: string;
  desc?: string;
  description?: string;
  /** Parent mandate bounds (delegation root). */
  parent: MmfBounds;
  steps: DelegationStep[];
  [k: string]: unknown;
}

export interface LifecycleStep {
  tx?: MmfTx;
  claim?: MmfTx;
  /** tx_id to settle (may be nonexistent, e.g. "nope"). */
  settle?: string;
  /** tx_id to void. */
  void?: string;
  /** e.g. "rail-decline:pay_1" — rail-side cancellation marker. */
  cancellation?: string;
  at?: number;
  expect?: MmfExpect;
  [k: string]: unknown;
}

export interface LifecycleVector {
  id: string;
  desc?: string;
  description?: string;
  mandate: MmfMandate;
  mandate2?: MmfMandate;
  registry?: MmfRegistry;
  steps: LifecycleStep[];
  /** Expected evidence events: DECISION/REPLAY/REJECTED/CLAIM/SETTLE/VOID. */
  events: string[];
  [k: string]: unknown;
}

export interface CredentialVector {
  id: string;
  kind: string;
  note?: string;
  /** C01 shape: raw inputs + seed. */
  seed_hex?: string;
  public_key_hex?: string;
  inputs?: Record<string, unknown>;
  /** C02+ shape: pre-built credential + mandate inputs. */
  credential?: Record<string, unknown>;
  mandate_inputs?: Record<string, unknown>;
  principal_public_key_hex?: string;
  expected: Record<string, unknown>;
  [k: string]: unknown;
}

export interface EvidenceRecord {
  event: string;
  tx_id?: string;
  mandate_id?: string;
  agent?: string;
  payee?: string;
  amount?: number;
  allowed?: boolean;
  check?: string;
  timestamp?: number;
  currency?: string;
  status?: string;
  [k: string]: unknown;
}

export interface EvidenceExpect {
  /** §7 canonical payload string. */
  payload: string;
  /** sha256 of the canonical payload (hex). */
  hash: string;
  [k: string]: unknown;
}

export interface EvidenceVector {
  id: string;
  desc?: string;
  description?: string;
  records: EvidenceRecord[];
  expect: EvidenceExpect[];
  /** Expected head of the hash chain. */
  head: string;
  [k: string]: unknown;
}

export interface CorpusFile<V> {
  /** Domain spec version (e.g. "mmf-v0.3") — absent in lifecycle.json. */
  version?: string;
  description?: string;
  vectors: V[];
}

export interface MmfCorpus {
  core: CorpusFile<CoreVector>;
  delegation: CorpusFile<DelegationVector>;
  lifecycle: CorpusFile<LifecycleVector>;
  /** credential.json is a bare array (no wrapper). */
  credential: CredentialVector[];
  evidence: CorpusFile<EvidenceVector>;
  /** Flat view: every vector tagged with its track. */
  all: Array<{
    track: MmfTrack;
    vector:
      | CoreVector
      | DelegationVector
      | LifecycleVector
      | CredentialVector
      | EvidenceVector;
  }>;
}
