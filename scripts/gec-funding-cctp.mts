/**
 * gec-funding-cctp.mts — EPIC-209 funding leg: Arc USDC → Base USDC via CCTP V2.
 * Post-audit revision (209-4): implements REVIEW-FINDINGS C1-C4, H1-H6, M1-M9.
 *
 * Modes (default = read-only plan; writes require --submit):
 *   plan              balances + guards + exact tx args, nothing sent
 *   burn  [--submit]  approve (if needed) + depositForBurn on Arc → funding-state.json
 *   attest [--tx=]    poll iris /v2/messages/26 until attestation ready/failed
 *   mint  [--submit] [--tx=]  receiveMessage on Base (destinationCaller=0, anyone may relay)
 *   resume [--tx=] [--submit]  attest + mint for an already-sent burn
 *   status            balances both sides + funding-state.json summary
 *
 * Safety:
 * - No write without --submit; spend modes additionally print the plan and
 *   require confirmation: interactive "YES" on a TTY, or GEC_FUNDING_CONFIRM=YES
 *   when non-interactive (audit nit — no silent spends).
 * - Contract addresses are Circle-reference-verified constants AND runtime
 *   checked: getCode + eth_chainId (5042/8453) + TokenMessengerV2.localDomain/
 *   localMessageTransmitter cross-checks before ANY spend, on every mode.
 * - Signer identity is asserted before any spend: Base key must derive
 *   BUYER_ADDRESS, Arc key must derive OPERATOR_ADDRESS (audit C4 — a wrong
 *   .env key can no longer burn to an unrecoverable destinationCaller).
 * - destinationCaller = bytes32(0): anyone may submit receiveMessage (the
 *   funds still mint to mintRecipient) — no single-key liveness dependency
 *   and no permanent lock if the buyer key is unavailable (audit H1).
 * - Idempotency (audit C1/H6): a "burning" intent is persisted BEFORE the tx
 *   is sent; burn_tx is persisted IMMEDIATELY after writeContract returns —
 *   before the receipt wait — so a crash mid-wait cannot trigger a re-burn.
 *   A stale intent without burn_tx recovers via DepositForBurn log scan or
 *   requires --tx. A lockfile serializes concurrent runs; a cumulative cap
 *   bounds total spend to the 4.0 USDC ceiling.
 * - Iris polling (audit M2): "complete"+hex attestation = ready; 404/429/5xx
 *   back off instead of crashing; the attested message is decoded and its
 *   mintRecipient/domains/destinationCaller verified against the saved burn
 *   before receiveMessage is ever sent.
 * - State file (audit C2/M3): ENOENT-only empty, every other error aborts;
 *   atomic tmp+rename writes; absolute path resolved from the script dir;
 *   --tx that differs from the recorded burn is refused without --allow-foreign-tx.
 * - Private keys come only from env and are never logged.
 *
 * Run (from hackathon/server, keys in .env):
 *   bun --env-file ./.env run scripts/gec-funding-cctp.mts plan [--amount=3.6]
 */
import {
  createPublicClient, createWalletClient, http, pad, parseAbi, parseUnits,
  defineChain, type Address, type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { existsSync, mkdirSync, openSync, closeSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

// ─── Verified constants (evidence/cctp-addresses.md, Circle reference) ──
export const ARC = defineChain({
  id: 5042,
  name: "Arc",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.arc.io"] } }, // registry RPC (audit M1)
});
export const BASE_CHAIN_ID = 8453;
export const BASE_DOMAIN = 6;
export const ARC_DOMAIN = 26;
export const USDC_ARC = "0x3600000000000000000000000000000000000000" as Address;
export const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as Address;
export const CCTP_TOKEN_MESSENGER = "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d" as Address;
export const CCTP_MESSAGE_TRANSMITTER = "0x81D40F21F12A8F0E3252Bccb954D722d4c464B64" as Address;
export const IRIS_API = "https://iris-api.circle.com";
export const BUYER_ADDRESS = "0x3bF7bf14c839AC615F87cDeDe344dF01B9cFb89f" as Address;
/** Deployer / funding source on Arc (verified 209-1 balances). */
export const OPERATOR_ADDRESS = "0xcdd23d104AA4C10DE65F4DD0571eDfeC0458699d" as Address;

/** Fast transfer (minFinalityThreshold=1000) per fee-calc-and-verdict.md. */
export const MIN_FINALITY_THRESHOLD = 1000;
export const MAX_FEE_MINOR = 50_000n; // 0.05 USDC ceiling (fallback when fee API unreachable)
export const FEE_BUFFER_BPS = 2_000n; // +20% over the live fee quote
export const NET_FLOOR_MINOR = 3_500_000n; // D-209-4: ≥3.5 USDC must land on Base
export const BURN_AMOUNT_USDC_DEFAULT = "3.6";
export const BURN_AMOUNT_HARD_CAP_USDC = "4.0"; // absolute ceiling, cumulative too
export const GAS_RESERVE_MINOR = 200_000n; // 0.2 USDC reserved on Arc for approve+burn gas
export const FUNDING_STATE_ENV = "GEC_FUNDING_STATE";
export const FUNDING_STATE_DEFAULT = resolve(
  SCRIPT_DIR, "../../../docs/EPICS/209-gec-buyer-route/evidence/funding-state.json",
);
const ZERO_BYTES32 = `0x${"0".repeat(64)}` as Hex;

const ERC20 = parseAbi([
  "function approve(address,uint256) returns (bool)",
  "function allowance(address,address) view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
]);
const TM = parseAbi([
  // V2 depositForBurn returns void (audit nit — uint64 nonce was V1).
  "function depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold)",
  "function localMessageTransmitter() view returns (address)",
]);
const MT = parseAbi([
  "function receiveMessage(bytes message, bytes attestation) returns (bool)",
  // localDomain lives on the transmitter, not the messenger (smoke-verified).
  "function localDomain() view returns (uint32)",
  // Audit N-8: usedNonces(nonce) detects a third-party relay BEFORE
  // simulating. CCTP V2 keys by the RAW bytes32 message nonce — verified
  // live on Base: usedNonces(bytes32(0))==1, keccak(domain||nonce)==0.
  "function usedNonces(bytes32) view returns (uint256)",
]);
// Audit N-3: CCTP V2 event — the V1 signature (indexed nonce, no maxFee/
// finality/hookData) has a different topic0, so a V1 scan can never match.
const DEPOSIT_FOR_BURN_EVENT = parseAbi([
  "event DepositForBurn(address indexed burnToken, uint256 amount, address indexed depositor, bytes32 mintRecipient, uint32 destinationDomain, bytes32 destinationTokenMessenger, bytes32 destinationCaller, uint256 maxFee, uint32 indexed minFinalityThreshold, bytes hookData)",
]);

const log = (...a: unknown[]) => console.log(`[gec-funding]`, ...a);

function envKey(name: string): `0x${string}` {
  const k = process.env[name];
  if (!k) throw new Error(`missing env ${name}`);
  return (k.startsWith("0x") ? k : `0x${k}`) as `0x${string}`;
}

// ─── CLI args (audit M8: indexOf split, empty rejected) ─────────────────
function argValue(argv: string[], name: string): string | undefined {
  const a = argv.find((x) => x.startsWith(`--${name}=`));
  if (!a) return undefined;
  const v = a.slice(a.indexOf("=") + 1);
  if (!v) throw new Error(`--${name}= given an empty value`);
  return v;
}
const hasFlag = (argv: string[], f: string) => argv.includes(`--${f}`);
const submit = (argv: string[]) => hasFlag(argv, "submit");

// ─── Pure helpers (unit-tested) ───────────────────────────────────────
/** Parse "3.6" → microUSDC bigint; rejects junk, ≤0 and the hard cap. */
export function parseUsdcAmount(s: string): bigint {
  if (!/^\d+(\.\d{1,6})?$/.test(s)) throw new Error(`bad USDC amount: ${s}`);
  const v = parseUnits(s, 6);
  if (v <= 0n) throw new Error("amount must be > 0");
  const cap = parseUnits(BURN_AMOUNT_HARD_CAP_USDC, 6);
  if (v > cap) throw new Error(`amount exceeds hard cap ${BURN_AMOUNT_HARD_CAP_USDC} USDC`);
  return v;
}

/**
 * depositForBurn arg tuple (audit H1): destinationCaller = bytes32(0) —
 * permissionless mint, anyone may relay receiveMessage; funds still land on
 * mintRecipient. Removes the single-key liveness dependency and the
 * locked-forever scenario.
 */
export function buildDepositForBurnArgs(
  amountMinor: bigint,
  recipient: Address,
  maxFee: bigint = MAX_FEE_MINOR,
): readonly [bigint, number, Hex, Address, Hex, bigint, number] {
  // Re-audit 5 N5-2: a bogus (non-positive or over-ceiling) fee must die here
  // — the approve tx is sent BEFORE viem's encoding check would throw.
  if (maxFee <= 0n || maxFee > MAX_FEE_MINOR) {
    throw new Error(`maxFee ${maxFee} out of bounds (0, ${MAX_FEE_MINOR}] — refusing to build burn args`);
  }
  return [
    amountMinor,
    BASE_DOMAIN,
    pad(recipient, { size: 32 }),
    USDC_ARC,
    ZERO_BYTES32, // destinationCaller — permissionless relay (audit H1)
    maxFee,
    MIN_FINALITY_THRESHOLD,
  ];
}

/** Net-floor guard: burn must leave ≥3.5 USDC on Base after worst-case fee. */
export function assertNetFloor(amount: bigint, maxFee: bigint): void {
  if (amount - maxFee < NET_FLOOR_MINOR) {
    throw new Error(
      `fee ${Number(maxFee) / 1e6} USDC breaks the net floor: ` +
      `${Number(amount) / 1e6} - ${Number(maxFee) / 1e6} < ${Number(NET_FLOOR_MINOR) / 1e6} USDC`,
    );
  }
}

/** Live-fee maxFee: quoted fee + 20% buffer, clamped by the net floor. */
export function computeMaxFee(quotedFeeMinor: bigint): bigint {
  return quotedFeeMinor + (quotedFeeMinor * FEE_BUFFER_BPS) / 10_000n;
}

/** Audit C4: the env-derived signer MUST be the expected address. */
export function assertSigner(expected: Address, actual: Address, label: string): void {
  if (expected.toLowerCase() !== actual.toLowerCase()) {
    throw new Error(
      `${label} signer mismatch: expected ${expected}, key derives ${actual} — ` +
      `refusing to act; fix the env key, do NOT proceed`,
    );
  }
}

export type AttestationState = "pending" | "ready" | "failed";

/** Classify one iris /v2/messages entry (audit M2: docs say pending|complete). */
export function classifyAttestation(m: {
  status?: string;
  attestation?: string | null;
  message?: string | null;
} | undefined): AttestationState {
  if (!m) return "pending";
  const st = (m.status ?? "").toLowerCase();
  if (st === "failed" || st === "error") return "failed"; // defensive; undocumented
  if (
    st === "complete" &&
    typeof m.message === "string" && m.message.startsWith("0x") && m.message.length > 2 &&
    typeof m.attestation === "string" && m.attestation.startsWith("0x") && m.attestation.length > 2 &&
    m.attestation !== "PENDING"
  ) {
    return "ready";
  }
  return "pending";
}

// ─── CCTP V2 message decode (audit M2: verify before receiveMessage) ────
// MessageV2 header: version@0 u32, sourceDomain@4 u32, destinationDomain@8 u32,
// nonce@12 b32, sender@44 b32, recipient@76 b32, destinationCaller@108 b32,
// minFinalityThreshold@140 u32, finalityThresholdExecuted@144 u32, body@148.
// BurnMessageV2 body: version@148 u32, burnToken@152 b32, mintRecipient@184 b32,
// amount@216 u256, messageSender@248 b32, maxFee@280 u256, feeExecuted@312 u256,
// expirationBlock@344 u256, hookData@376.
export interface DecodedCctpMessage {
  sourceDomain: number;
  destinationDomain: number;
  destinationCaller: Address;
  mintRecipient: Address;
  amount: bigint;
  burnToken: Address;
  /** Full 32-byte words — audit N-17: upper-12-byte zero must be checked. */
  destinationCallerWord: string;
  mintRecipientWord: string;
  burnTokenWord: string;
}

function readU32(hex: string, byteOff: number): number {
  return parseInt(hex.slice(2 + byteOff * 2, 2 + (byteOff + 4) * 2), 16);
}
function readBytes32Word(hex: string, byteOff: number): string {
  return hex.slice(2 + byteOff * 2, 2 + (byteOff + 32) * 2);
}
function readBytes32Address(hex: string, byteOff: number): Address {
  // last 20 bytes of the 32-byte word (left-padded address)
  return `0x${hex.slice(2 + byteOff * 2 + 12 * 2, 2 + (byteOff + 32) * 2)}` as Address;
}
function readU256(hex: string, byteOff: number): bigint {
  return BigInt(`0x${hex.slice(2 + byteOff * 2, 2 + (byteOff + 32) * 2)}`);
}

/** Decode a CCTP V2 message; returns null when the payload is too short. */
export function parseCctpMessage(msg: Hex): DecodedCctpMessage | null {
  if (typeof msg !== "string" || !msg.startsWith("0x") || msg.length < 2 + 376 * 2) return null;
  return {
    sourceDomain: readU32(msg, 4),
    destinationDomain: readU32(msg, 8),
    destinationCaller: readBytes32Address(msg, 108),
    burnToken: readBytes32Address(msg, 152),
    mintRecipient: readBytes32Address(msg, 184),
    amount: readU256(msg, 216),
    destinationCallerWord: readBytes32Word(msg, 108),
    mintRecipientWord: readBytes32Word(msg, 184),
    burnTokenWord: readBytes32Word(msg, 152),
  };
}

/** Mismatches between the attested message and the burn we recorded. */
export function verifyAttestedMessage(
  msg: Hex,
  expected: { recipient: Address; sourceDomain: number; destinationDomain: number; amountMinor?: string },
): string[] {
  const d = parseCctpMessage(msg);
  if (!d) return ["cannot decode attested message (payload too short/malformed)"];
  const bad: string[] = [];
  if (d.sourceDomain !== expected.sourceDomain) bad.push(`sourceDomain ${d.sourceDomain} != ${expected.sourceDomain}`);
  if (d.destinationDomain !== expected.destinationDomain) bad.push(`destinationDomain ${d.destinationDomain} != ${expected.destinationDomain}`);
  if (d.mintRecipient.toLowerCase() !== expected.recipient.toLowerCase()) bad.push(`mintRecipient ${d.mintRecipient} != ${expected.recipient}`);
  // Audit N-17: compare the full words — a caller word like 0x…01…0 would
  // truncate to a plausible address while the upper bytes hide non-zero data.
  if (d.destinationCallerWord !== "0".repeat(64)) {
    bad.push(`destinationCaller word ${d.destinationCallerWord} is not all-zero`);
  }
  if (!d.mintRecipientWord.startsWith("0".repeat(24))) {
    bad.push(`mintRecipient word has non-zero upper 12 bytes: ${d.mintRecipientWord}`);
  }
  if (d.burnToken.toLowerCase() !== USDC_ARC.toLowerCase() || !d.burnTokenWord.startsWith("0".repeat(24))) {
    bad.push(`burnToken word ${d.burnTokenWord} != padded USDC@Arc ${USDC_ARC}`);
  }
  if (expected.amountMinor !== undefined && d.amount !== BigInt(expected.amountMinor)) {
    bad.push(`amount ${d.amount} != recorded ${expected.amountMinor}`);
  }
  return bad;
}

// ─── Funding state file (audit C2: fail-closed loader, atomic writes) ──
export interface FundingState {
  intent?: { phase: "burning" | "minting"; amount_minor?: string; recipient?: string; at: string };
  burn_tx?: string;
  burn_confirmed?: boolean; // receipt observed successful (audit N-4)
  mint_tx?: string;
  mint_confirmed?: boolean;
  amount_minor?: string;
  recipient?: string;
  // append-only (audit N-6); reverted:true marks entries the chain rejected —
  // they stay in the audit trail but are excluded from the cumulative cap
  burns?: { tx: string; amount_minor: string; at: string; reverted?: boolean }[];
  reverted_tx?: string[]; // hashes that went on-chain but reverted — audit trail (audit N-4)
  updated_at?: string;
}

export function defaultFundingStatePath(): string {
  return process.env[FUNDING_STATE_ENV] ?? FUNDING_STATE_DEFAULT;
}

export function loadFundingState(path: string): FundingState {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as FundingState;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error(`funding state unreadable at ${path}: ${(e as Error).message}`);
  }
}

export function saveFundingState(path: string, s: FundingState): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, JSON.stringify({ ...s, updated_at: new Date().toISOString() }, null, 2) + "\n");
  renameSync(tmp, path); // atomic: readers never see a truncated file
}

// ─── Run serialization (audit H6/N-13): one process per state file ─────
export function acquireLock(statePath: string): () => void {
  const lockPath = `${statePath}.lock`;
  mkdirSync(dirname(statePath), { recursive: true }); // before the lock — ENOENT ≠ "lock held"
  let fd: number;
  try {
    fd = openSync(lockPath, "wx");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") {
      const pid = readFileSync(lockPath, "utf8").trim();
      // N-13: check liveness for an accurate diagnostic — never auto-clear,
      // but tell the operator exactly what state the lock is in.
      let liveness = "unreadable";
      if (/^\d+$/.test(pid)) {
        try { process.kill(Number(pid), 0); liveness = "ALIVE"; }
        catch { liveness = "DEAD"; }
      }
      throw new Error(
        `another funding run holds ${lockPath} (recorded pid ${pid || "unknown"}, ${liveness}) — ` +
        `refusing to run concurrently; if that pid is dead, remove ${lockPath}`,
      );
    }
    throw e;
  }
  writeFileSync(fd, `${process.pid}\n`);
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    try { closeSync(fd); } catch { /* already closed */ }
    try { unlinkSync(lockPath); } catch { /* already removed */ }
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  };
  const onSignal = () => { release(); process.exit(130); };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  return release;
}

// ─── Spend confirmation (audit nit): no silent --submit ────────────────
async function confirmSpend(argv: string[], summary: Record<string, unknown>): Promise<void> {
  log("SPEND PLAN:", JSON.stringify(summary, null, 2));
  if (!submit(argv)) {
    log("dry-run — pass --submit to execute (209-5 only, post re-audit)");
    return;
  }
  // Audit N-7: no flag may skip the confirmation — --allow-foreign-tx only
  // relaxes tx provenance, never the explicit YES.
  if (process.stdin.isTTY) {
    const { createInterface } = await import("node:readline");
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise<string>((r) => rl.question('Type YES to spend: ', r));
    rl.close();
    if (answer.trim() !== "YES") throw new Error("spend aborted by operator");
    return;
  }
  if (process.env.GEC_FUNDING_CONFIRM !== "YES") {
    throw new Error("non-interactive spend requires GEC_FUNDING_CONFIRM=YES");
  }
}

// ─── Clients (audit C4: identity asserted at construction) ─────────────
function arcClients() {
  const acct = privateKeyToAccount(envKey("ARC_OPERATOR_KEY"));
  assertSigner(OPERATOR_ADDRESS, acct.address, "Arc operator");
  return {
    acct,
    pub: createPublicClient({ chain: ARC, transport: http() }),
    wal: createWalletClient({ account: acct, chain: ARC, transport: http() }),
  };
}

async function baseClients() {
  const { base } = await import("viem/chains");
  const acct = privateKeyToAccount(envKey("GEC_INTEROP_PRIVATE_KEY"));
  assertSigner(BUYER_ADDRESS, acct.address, "Base buyer");
  return {
    acct,
    pub: createPublicClient({ chain: base, transport: http() }),
    wal: createWalletClient({ account: acct, chain: base, transport: http() }),
  };
}

// ─── Guards (audit M1: run in EVERY mode that could spend) ─────────────
async function verifyContracts(): Promise<void> {
  const { pub: pubArc } = arcClients();
  const { pub: pubBase } = await baseClients();
  const [arcId, baseId] = await Promise.all([pubArc.getChainId(), pubBase.getChainId()]);
  if (arcId !== 5042) throw new Error(`Arc RPC returned chainId ${arcId}, expected 5042 — wrong endpoint`);
  if (baseId !== BASE_CHAIN_ID) throw new Error(`Base RPC returned chainId ${baseId}, expected ${BASE_CHAIN_ID}`);
  const checks: [Promise<Hex | undefined>, string][] = [
    [pubArc.getCode({ address: USDC_ARC }), "USDC@Arc"],
    [pubArc.getCode({ address: CCTP_TOKEN_MESSENGER }), "TokenMessengerV2@Arc"],
    [pubBase.getCode({ address: CCTP_MESSAGE_TRANSMITTER }), "MessageTransmitterV2@Base"],
    [pubBase.getCode({ address: USDC_BASE }), "USDC@Base"],
  ];
  for (const [p, name] of checks) {
    const code = await p;
    if (!code || code === "0x") throw new Error(`no bytecode at ${name} — address wrong or RPC broken`);
  }
  // Cross-check contract self-knowledge (audit M1): each chain's contracts
  // must agree on the wiring — Arc TM routes to the pinned transmitter, and
  // each transmitter reports its own domain (26 on Arc, 6 on Base).
  const [mt, arcDom, baseDom] = await Promise.all([
    pubArc.readContract({ address: CCTP_TOKEN_MESSENGER, abi: TM, functionName: "localMessageTransmitter" }),
    pubArc.readContract({ address: CCTP_MESSAGE_TRANSMITTER, abi: MT, functionName: "localDomain" }),
    pubBase.readContract({ address: CCTP_MESSAGE_TRANSMITTER, abi: MT, functionName: "localDomain" }),
  ]);
  if ((mt as Address).toLowerCase() !== CCTP_MESSAGE_TRANSMITTER.toLowerCase()) {
    throw new Error(`TokenMessengerV2.localMessageTransmitter=${mt} != ${CCTP_MESSAGE_TRANSMITTER}`);
  }
  if (arcDom !== ARC_DOMAIN) throw new Error(`Arc MessageTransmitterV2.localDomain=${arcDom} != ${ARC_DOMAIN}`);
  if (baseDom !== BASE_DOMAIN) throw new Error(`Base MessageTransmitterV2.localDomain=${baseDom} != ${BASE_DOMAIN}`);
  log("contracts verified: code@4 addrs, chainIds 5042/8453, localDomain 26/6, localMessageTransmitter matches");
}

async function balances(): Promise<{ arcUsdc: bigint; baseEth: bigint; baseUsdc: bigint }> {
  const { pub: pubArc, acct: src } = arcClients();
  const { pub: pubBase, acct: buyer } = await baseClients();
  const arcUsdc = await pubArc.readContract({
    address: USDC_ARC, abi: ERC20, functionName: "balanceOf", args: [src.address],
  });
  const baseEth = await pubBase.getBalance({ address: buyer.address });
  const baseUsdc = await pubBase.readContract({
    address: USDC_BASE, abi: ERC20, functionName: "balanceOf", args: [buyer.address],
  });
  return { arcUsdc, baseEth, baseUsdc };
}

/**
 * Live fast-fee quote; falls back to the conservative 0.05 USDC ceiling.
 * Audit N-12: the endpoint returns a top-level ARRAY of
 * {finalityThreshold, minimumFee} — minimumFee is basis points. Pick the
 * threshold-1000 (fast) tier and floor the buffered result.
 */
/** Fee in micro-USDC for `bps` basis points of `amountMinor`, 4-decimal
 * precision, rounded UP (over-estimate is the safe direction for a cap).
 * bps×1e4 keeps 4 decimals; fee = amount·bps/10_000 → divisor 10_000·1e4 = 1e8.
 * Exported for tests (re-audit 4 N-12 demanded a unit test). */
export function bpsFeeMinor(amountMinor: bigint, bps: number): bigint {
  return (amountMinor * BigInt(Math.round(bps * 1e4)) + 99_999_999n) / 100_000_000n;
}

async function fetchMaxFee(amount: bigint): Promise<bigint> {
  let quoted: bigint | undefined;
  try {
    const r = await fetch(`${IRIS_API}/v2/burn/USDC/fees/${ARC_DOMAIN}/${BASE_DOMAIN}`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (r.ok) {
      const j = (await r.json()) as { finalityThreshold?: number; minimumFee?: number | string }[] | { fees?: { finalityThreshold?: number; minimumFee?: number | string }[]; minimumFee?: number | string };
      const tiers = Array.isArray(j) ? j : (j.fees ?? []);
      // Re-audit 5 N5-4a: only the threshold-1000 (fast) tier is usable — a
      // tiers[0] fallback could silently pick the standard (0bps) tier and
      // under-fund a fast burn. No fast tier → conservative ceiling.
      const tier = tiers.find((t) => t.finalityThreshold === MIN_FINALITY_THRESHOLD);
      const raw = tier?.minimumFee ?? (!Array.isArray(j) ? j.minimumFee : undefined);
      if (raw !== undefined) {
        // Re-audit 2 N-12: shape determines the unit — never guess by size.
        // Array/tier shape: minimumFee is basis points. Object shape: already
        // micro-USDC. Re-audit 4 N-12: fractional bps via bpsFeeMinor
        // (divisor 1e8 — 1e9 under-capped 10×).
        const n = Number(raw);
        if (!Number.isFinite(n) || n < 0) return MAX_FEE_MINOR; // N5-2: bogus quote → ceiling
        quoted = tier ? bpsFeeMinor(amount, n) : BigInt(Math.ceil(n));
      }
    }
  } catch { /* fall through to the conservative ceiling */ }
  if (quoted === undefined || quoted < 0n) return MAX_FEE_MINOR;
  // Re-audit 5 N5-4b: a live quote above the ceiling aborts loudly — silently
  // clamping could under-fund the fast transfer on an irreversible step.
  if (quoted > MAX_FEE_MINOR) {
    throw new Error(
      `live fee quote ${quoted} micro-USDC exceeds the ${MAX_FEE_MINOR} ceiling — ` +
      `refusing to under-fund the burn; raise MAX_FEE or wait for lower fees`,
    );
  }
  const cap = computeMaxFee(quoted);
  return cap > MAX_FEE_MINOR ? MAX_FEE_MINOR : (cap || 1_000n);
}

// ─── Attestation polling (audit M2) ─────────────────────────────────────
export async function pollAttestation(burnTx: string, maxPolls = 180): Promise<{ msg: Hex; att: Hex }> {
  for (let i = 0; i < maxPolls; i++) {
    let m: { status?: string; attestation?: string | null; message?: string | null } | undefined;
    try {
      const r = await fetch(`${IRIS_API}/v2/messages/${ARC_DOMAIN}?transactionHash=${burnTx}`, {
        signal: AbortSignal.timeout(15_000),
      });
      if (!r.ok) {
        // 404 = not observed yet; 429/5xx = transient — back off, don't crash
        if (i % 6 === 0) log(`iris http ${r.status} (poll ${i}) — backing off`);
        await new Promise((r2) => setTimeout(r2, Math.min(10_000 * (i + 1), 60_000)));
        continue;
      }
      const j = (await r.json()) as { messages?: typeof m[] };
      m = j.messages?.[0];
    } catch (e) {
      if (i % 6 === 0) log(`iris fetch error: ${(e as Error).message} (poll ${i}) — retrying`);
      await new Promise((r2) => setTimeout(r2, 10_000));
      continue;
    }
    const st = classifyAttestation(m);
    if (st === "failed") throw new Error(`attestation FAILED for ${burnTx} — inspect iris before retry`);
    if (st === "ready") return { msg: m!.message as Hex, att: m!.attestation as Hex };
    if (i % 6 === 0) log(`iris: ${m?.status ?? "not observed"} (poll ${i})`);
    await new Promise((r2) => setTimeout(r2, 10_000));
  }
  throw new Error("attestation timeout — use resume later; funds NOT lost, burn already attested or pending");
}

// ─── Burn-tx verification for --tx overrides (audit M3) ────────────────
async function verifyBurnTx(txHash: string): Promise<void> {
  const { pub } = arcClients();
  const tx = await pub.getTransaction({ hash: txHash as Hex }).catch(() => null);
  if (!tx) throw new Error(`tx ${txHash} not found on Arc`);
  if (tx.to?.toLowerCase() !== CCTP_TOKEN_MESSENGER.toLowerCase()) {
    throw new Error(`tx ${txHash} targets ${tx.to}, not TokenMessengerV2`);
  }
  if (tx.from.toLowerCase() !== OPERATOR_ADDRESS.toLowerCase()) {
    throw new Error(`tx ${txHash} from ${tx.from}, not the operator ${OPERATOR_ADDRESS}`);
  }
}

// ─── tx arg (audit M3: foreign --tx refused without --allow-foreign-tx) ──
function txArg(argv: string[], state: FundingState): string {
  const t = argValue(argv, "tx") ?? state.burn_tx;
  if (!t || !/^0x[0-9a-fA-F]{64}$/.test(t)) throw new Error("no burn tx — pass --tx=<hash> or run burn first");
  // Audit N-7: dedicated flag for tx-provenance override — never --force.
  if (state.burn_tx && t.toLowerCase() !== state.burn_tx.toLowerCase() && !hasFlag(argv, "allow-foreign-tx")) {
    throw new Error(`--tx ${t} differs from recorded burn ${state.burn_tx} — pass --allow-foreign-tx to override`);
  }
  return t;
}

// ─── Modes ────────────────────────────────────────────────────────────
async function cmdPlan(argv: string[]): Promise<void> {
  const amount = parseUsdcAmount(argValue(argv, "amount") ?? BURN_AMOUNT_USDC_DEFAULT);
  await verifyContracts();
  const { acct: src } = arcClients();
  const b = await balances();
  log(`src ${src.address} Arc USDC: ${Number(b.arcUsdc) / 1e6} (need ${Number(amount) / 1e6} + 0.2 gas reserve + fee)`);
  log(`buyer ${BUYER_ADDRESS} Base ETH: ${Number(b.baseEth) / 1e18}, Base USDC: ${Number(b.baseUsdc) / 1e6}`);
  if (b.arcUsdc < amount + GAS_RESERVE_MINOR) throw new Error("insufficient Arc USDC for burn + gas reserve");
  const maxFee = await fetchMaxFee(amount);
  assertNetFloor(amount, maxFee);
  const args = buildDepositForBurnArgs(amount, BUYER_ADDRESS, maxFee);
  log("planned depositForBurn:", JSON.stringify({
    amount_minor: args[0].toString(), destinationDomain: args[1], mintRecipient: args[2],
    burnToken: args[3], destinationCaller: args[4], maxFee: args[5].toString(),
    minFinalityThreshold: args[6],
  }, null, 2));
  log(`net on Base ≥ ${(Number(amount - maxFee) / 1e6).toFixed(6)} USDC`);
  log("PLAN OK — pass burn --submit to execute (gated to 209-5, post re-audit)");
}

// Audit N-13: a custom GEC_FUNDING_STATE path that does not exist yet must be
// acknowledged with --init — a typo would silently drop cumulative-cap dedupe.
function assertFreshFundingState(argv: string[], statePath: string): void {
  if (process.env[FUNDING_STATE_ENV] && !existsSync(statePath) && !hasFlag(argv, "init")) {
    throw new Error(
      `no funding state at ${statePath} (custom ${FUNDING_STATE_ENV}) — pass --init to create a fresh state file`,
    );
  }
}

async function cmdBurn(argv: string[]): Promise<void> {
  const statePath = defaultFundingStatePath();
  assertFreshFundingState(argv, statePath);
  const release = acquireLock(statePath);
  try {
    let state = loadFundingState(statePath);
    // Audit N-4: a recorded hash without confirmation must be reconciled on
    // the chain before deciding — a reverted tx poisons the state otherwise.
    if (state.burn_tx && !state.burn_confirmed) {
      const { pub } = arcClients();
      const rc = await pub.getTransactionReceipt({ hash: state.burn_tx as Hex }).catch(() => null);
      if (rc?.status === "success") {
        state = { ...state, burn_confirmed: true, intent: undefined };
        saveFundingState(statePath, state);
        log(`burn confirmed on-chain: ${state.burn_tx}`);
      } else if (rc) {
        log(`recorded burn REVERTED on-chain: ${state.burn_tx} — clearing for retry`);
        // Re-audit 2: flag the burns[] entry as reverted — it stays for the
        // audit trail but no longer counts against the cumulative cap.
        const deadTx = state.burn_tx.toLowerCase();
        state = {
          ...state, burn_tx: undefined, burn_confirmed: undefined, intent: undefined,
          reverted_tx: [...(state.reverted_tx ?? []), state.burn_tx],
          burns: (state.burns ?? []).map((b) =>
            b.tx.toLowerCase() === deadTx ? { ...b, reverted: true } : b),
        };
        saveFundingState(statePath, state);
      } else {
        throw new Error(
          `burn_tx ${state.burn_tx} broadcast but not yet mined — ` +
          `wait and re-run; refusing to send a second burn`,
        );
      }
    }
    if (state.burn_tx) {
      log(`burn already sent: ${state.burn_tx} — idempotent skip (use resume)`);
      return;
    }
    // Audit C1/N-3: recover an orphaned burn — explicit --tx (verified on-chain)
    // or a V2 DepositForBurn scan matched on depositor+recipient+amount.
    if (state.intent?.phase === "burning") {
      const { pub, acct } = arcClients();
      let found: string | undefined;
      const txOverride = argValue(argv, "tx");
      if (txOverride) {
        await verifyBurnTx(txOverride);
        found = txOverride;
      } else {
        const latest = await pub.getBlockNumber();
        const logs = await pub.getLogs({
          address: CCTP_TOKEN_MESSENGER, event: DEPOSIT_FOR_BURN_EVENT[0],
          args: { depositor: acct.address }, fromBlock: latest - 50_000n, toBlock: "latest",
        }); // audit N-3: V2 ABI; RPC errors abort, never swallowed
        const intentAt = Date.parse(state.intent.at);
        const want = pad(BUYER_ADDRESS, { size: 32 }).toLowerCase();
        const wantAmt = state.intent.amount_minor ? BigInt(state.intent.amount_minor) : undefined;
        const candidates = logs.filter((l) => {
          const a = l.args;
          if (!a) return false;
          if (String(a.mintRecipient).toLowerCase() !== want) return false;
          if (wantAmt !== undefined && a.amount !== wantAmt) return false;
          return true;
        });
        // Audit N-3: match on intent.at too — an event that predates the
        // recorded intent (5 min clock skew tolerated) is an unrelated burn.
        const matches: typeof candidates = [];
        for (const l of candidates) {
          if (Number.isNaN(intentAt) || l.blockNumber == null) { matches.push(l); continue; }
          const blk = await pub.getBlock({ blockNumber: l.blockNumber });
          if (Number(blk.timestamp) * 1000 >= intentAt - 300_000) matches.push(l);
        }
        found = matches.at(-1)?.transactionHash; // newest, not oldest (audit N-3)
      }
      if (found) {
        log(`recovered burn tx: ${found}`);
        const amt = state.intent.amount_minor ?? "0";
        state = {
          ...state, burn_tx: found, intent: undefined,
          amount_minor: state.amount_minor ?? amt, recipient: BUYER_ADDRESS,
          burns: [...(state.burns ?? []), { tx: found, amount_minor: amt, at: state.intent.at }],
        };
        saveFundingState(statePath, state);
        log(`burn already sent: ${found} — idempotent skip (use resume)`);
        return;
      }
      throw new Error(
        "stale 'burning' intent without burn_tx and no matching V2 DepositForBurn found — " +
        "pass --tx=<hash> to recover, or delete funding-state.json intent if nothing was sent",
      );
    }
    const amount = parseUsdcAmount(argValue(argv, "amount") ?? BURN_AMOUNT_USDC_DEFAULT);
    const burned = (state.burns ?? []).reduce((s, b) => s + (b.reverted ? 0n : BigInt(b.amount_minor)), 0n);
    if (burned + amount > parseUsdcAmount(BURN_AMOUNT_HARD_CAP_USDC)) {
      throw new Error(`cumulative cap: ${Number(burned) / 1e6} already burned + ${Number(amount) / 1e6} > 4.0 ceiling`);
    }
    await verifyContracts();
    const { wal, pub, acct } = arcClients();
    const bal = await balances();
    if (bal.arcUsdc < amount + GAS_RESERVE_MINOR) throw new Error("insufficient Arc USDC for burn + gas reserve");
    const maxFee = await fetchMaxFee(amount);
    assertNetFloor(amount, maxFee);
    await confirmSpend(argv, {
      action: "depositForBurn", chain: "Arc(5042) -> Base(8453)",
      amount_usdc: Number(amount) / 1e6, maxFee_usdc: Number(maxFee) / 1e6,
      mintRecipient: BUYER_ADDRESS, destinationCaller: "0x0 (permissionless)",
    });
    if (!submit(argv)) return;

    const allowance = await pub.readContract({
      address: USDC_ARC, abi: ERC20, functionName: "allowance",
      args: [acct.address, CCTP_TOKEN_MESSENGER],
    });
    if (allowance < amount) {
      const sim = await pub.simulateContract({
        address: USDC_ARC, abi: ERC20, functionName: "approve",
        args: [CCTP_TOKEN_MESSENGER, amount], account: acct,
      });
      const tx = await wal.writeContract(sim.request);
      log("approve tx:", tx);
      const rc = await pub.waitForTransactionReceipt({ hash: tx });
      if (rc.status !== "success") throw new Error(`approve failed: ${tx}`);
    }
    const sim = await pub.simulateContract({
      address: CCTP_TOKEN_MESSENGER, abi: TM, functionName: "depositForBurn",
      args: buildDepositForBurnArgs(amount, BUYER_ADDRESS, maxFee), account: acct,
    });
    // Audit C1/N-5: the intent covers exactly the send window — saved after
    // the simulates, immediately before writeContract. A failure earlier in
    // this function leaves no stale intent to lock the run out; a failure
    // inside writeContract keeps it, because the tx may have broadcast.
    state = { ...state, intent: { phase: "burning", amount_minor: amount.toString(), recipient: BUYER_ADDRESS, at: new Date().toISOString() } };
    saveFundingState(statePath, state);
    const burnTx = await wal.writeContract(sim.request);
    log("burn tx:", burnTx, `https://explorer.arc.io/tx/${burnTx}`);
    // Audit C1/N-6: persist the hash IMMEDIATELY (before the receipt wait) and
    // add to the append-only burns[] at the same moment — the cumulative cap
    // then reflects every broadcast, not just receipt-confirmed ones.
    state = {
      ...state, burn_tx: burnTx, amount_minor: amount.toString(), recipient: BUYER_ADDRESS,
      burns: [...(state.burns ?? []), { tx: burnTx, amount_minor: amount.toString(), at: new Date().toISOString() }],
    };
    saveFundingState(statePath, state);
    const rc = await pub.waitForTransactionReceipt({ hash: burnTx });
    if (rc.status !== "success") throw new Error(`depositForBurn reverted: ${burnTx}`);
    state = { ...state, intent: undefined, burn_confirmed: true };
    saveFundingState(statePath, state);
    log(`state → ${statePath}; next: attest/poll, then mint --submit`);
  } finally {
    release();
  }
}

async function cmdAttest(argv: string[]): Promise<void> {
  const state = loadFundingState(defaultFundingStatePath());
  const burnTx = txArg(argv, state);
  const { msg, att } = await pollAttestation(burnTx);
  const mismatches = verifyAttestedMessage(msg, {
    recipient: BUYER_ADDRESS, sourceDomain: ARC_DOMAIN, destinationDomain: BASE_DOMAIN,
    amountMinor: state.amount_minor,
  });
  if (mismatches.length) {
    throw new Error(`attested message does not match recorded burn: ${mismatches.join("; ")}`);
  }
  log("attestation ready and verified:", { message: `${msg.slice(0, 42)}…`, attestation: `${att.slice(0, 42)}…` });
}

/** Shared mint path for mint + resume (audit M3: identical guards). */
async function mintFlow(argv: string[], statePath: string): Promise<void> {
  assertFreshFundingState(argv, statePath);
  const release = acquireLock(statePath);
  try {
    let state = loadFundingState(statePath);
    // Audit N-4: reconcile a recorded-but-unconfirmed mint hash on-chain.
    if (state.mint_tx && !state.mint_confirmed) {
      const { pub: pubBase } = await baseClients();
      const rc = await pubBase.getTransactionReceipt({ hash: state.mint_tx as Hex }).catch(() => null);
      if (rc?.status === "success") {
        state = { ...state, mint_confirmed: true, intent: undefined };
        saveFundingState(statePath, state);
        log(`mint confirmed on-chain: ${state.mint_tx}`);
      } else if (rc) {
        log(`recorded mint REVERTED on-chain: ${state.mint_tx} — clearing for retry`);
        state = {
          ...state, mint_tx: undefined, mint_confirmed: undefined, intent: undefined,
          reverted_tx: [...(state.reverted_tx ?? []), state.mint_tx],
        };
        saveFundingState(statePath, state);
      } else {
        throw new Error(
          `mint_tx ${state.mint_tx} broadcast but not yet mined — ` +
          `wait and re-run; refusing to send a second receiveMessage`,
        );
      }
    }
    if (state.mint_tx) {
      log(`mint already done: ${state.mint_tx} — idempotent skip`);
      return;
    }
    const burnTx = txArg(argv, state);
    await verifyContracts();
    const { pub: pubBase, wal, acct } = await baseClients();
    const eth = await pubBase.getBalance({ address: acct.address });
    if (eth === 0n) throw new Error("buyer has NO Base ETH — cannot submit receiveMessage");
    if (argValue(argv, "tx")) await verifyBurnTx(burnTx);
    const { msg, att } = await pollAttestation(burnTx);
    const mismatches = verifyAttestedMessage(msg, {
      recipient: BUYER_ADDRESS, sourceDomain: ARC_DOMAIN, destinationDomain: BASE_DOMAIN,
      amountMinor: state.amount_minor,
    });
    if (mismatches.length) {
      throw new Error(`attested message mismatch: ${mismatches.join("; ")} — refusing to mint`);
    }
    // Audit N-8: BEFORE simulating, ask the Base transmitter whether this
    // message nonce is already spent — a third party may have relayed
    // receiveMessage (the H1 permissionless design). V2 keys usedNonces
    // by the RAW bytes32 nonce at message offset 12 (re-audit 2, verified
    // on-chain — NOT keccak256(sourceDomain||nonce) as in V1).
    const nonceWord = `0x${readBytes32Word(msg, 12)}` as Hex;
    // Re-audit 3 N-8: usedNonces(bytes32(0)) is 1 on Base — a zero nonce would
    // always report "relayed". Zero nonce in a verified message shouldn't
    // happen, but guard anyway: skip the check rather than false-positive.
    const ZERO_NONCE = `0x${"0".repeat(64)}` as Hex;
    const usedBits = nonceWord === ZERO_NONCE ? 0n : await pubBase.readContract({
      address: CCTP_MESSAGE_TRANSMITTER, abi: MT, functionName: "usedNonces",
      args: [nonceWord],
    });
    if (usedBits !== 0n) {
      const baseUsdc = await pubBase.readContract({
        address: USDC_BASE, abi: ERC20, functionName: "balanceOf", args: [acct.address],
      });
      const expected = state.amount_minor ? BigInt(state.amount_minor) - MAX_FEE_MINOR : NET_FLOOR_MINOR;
      if (baseUsdc >= expected) {
        state = { ...state, mint_tx: "relayed-externally", mint_confirmed: true, intent: undefined };
        saveFundingState(statePath, state);
        log(`nonce already used (relayed externally), balance ${Number(baseUsdc) / 1e6} USDC — recorded`);
        return;
      }
      throw new Error(
        `nonce used but buyer Base USDC ${Number(baseUsdc) / 1e6} < expected ${Number(expected) / 1e6} — ` +
        `relay may have failed or paid a different recipient; inspect before retrying`,
      );
    }
    // Simulate before spending; any remaining revert is a real failure.
    const sim = await pubBase.simulateContract({
      address: CCTP_MESSAGE_TRANSMITTER, abi: MT, functionName: "receiveMessage",
      args: [msg, att], account: acct,
    });
    await confirmSpend(argv, {
      action: "receiveMessage", chain: "Base(8453)", burn_tx: burnTx,
      mintRecipient: BUYER_ADDRESS,
    });
    if (!submit(argv)) return;
    // N-5: intent right before the send, same discipline as the burn side.
    state = { ...state, intent: { phase: "minting", recipient: BUYER_ADDRESS, at: new Date().toISOString() } };
    saveFundingState(statePath, state);
    const mintTx = await wal.writeContract(sim.request);
    log("mint tx:", mintTx);
    // Same C1 discipline on the mint side.
    state = { ...state, burn_tx: burnTx, mint_tx: mintTx };
    saveFundingState(statePath, state);
    const rc = await pubBase.waitForTransactionReceipt({ hash: mintTx });
    if (rc.status !== "success") throw new Error(`receiveMessage reverted: ${mintTx}`);
    state = { ...state, intent: undefined, mint_confirmed: true };
    saveFundingState(statePath, state);
    log(`USDC minted on Base → ${BUYER_ADDRESS}`);
  } finally {
    release();
  }
}

async function cmdStatus(): Promise<void> {
  await verifyContracts();
  const { acct: src } = arcClients();
  const b = await balances();
  const state = loadFundingState(defaultFundingStatePath());
  log(`src ${src.address} Arc USDC: ${Number(b.arcUsdc) / 1e6}`);
  log(`buyer ${BUYER_ADDRESS} Base ETH: ${Number(b.baseEth) / 1e18}, Base USDC: ${Number(b.baseUsdc) / 1e6}`);
  log("funding-state:", JSON.stringify(state));
}

async function main(): Promise<void> {
  const mode = process.argv[2] ?? "plan";
  const argv = process.argv.slice(2);
  switch (mode) {
    case "plan": return cmdPlan(argv);
    case "burn": return cmdBurn(argv);
    case "attest": return cmdAttest(argv);
    case "mint": return mintFlow(argv, defaultFundingStatePath());
    case "resume": return mintFlow(argv, defaultFundingStatePath());
    case "status": return cmdStatus();
    default:
      console.error("usage: bun run scripts/gec-funding-cctp.mts plan|burn|attest|mint|resume|status [--amount=] [--tx=] [--submit] [--allow-foreign-tx]");
      process.exit(1);
  }
}

// Audit M9: import.meta.main — only the direct CLI runs main().
if (import.meta.main) {
  main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
}
