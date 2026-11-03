/**
 * gec-funding-cctp.mts — EPIC-209 funding leg: Arc USDC → Base USDC via CCTP V2.
 *
 * Modes (default = read-only plan; writes require --submit):
 *   plan            balances + guards + exact tx args, nothing sent
 *   burn  [--submit]  approve (if needed) + depositForBurn on Arc → funding-state.json
 *   attest [--tx=]    poll iris /v2/messages/26 until attestation ready/failed
 *   mint  [--submit] [--tx=]  receiveMessage on Base (destinationCaller=buyer)
 *   resume [--tx=] [--submit]  attest + mint for an already-sent burn
 *   status          balances both sides + funding-state.json summary
 *
 * Safety:
 * - No write without --submit; burn/mint never run in this slice (209-5).
 * - Contract addresses are the Circle-reference-verified constants from
 *   docs/EPICS/209-gec-buyer-route/evidence/cctp-addresses.md AND are
 *   bytecode-checked at runtime before any spend (no memory-hardcoding).
 * - destinationCaller = buyer wallet: only the buyer may submit the mint.
 * - FAILED attestation aborts; PENDING keeps polling; timeout = hard error.
 * - Idempotent: burn_tx persisted to funding-state.json; re-run resumes
 *   at attest/mint instead of burning twice.
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

// ─── Verified constants (evidence/cctp-addresses.md, Circle reference) ──
export const ARC = defineChain({
  id: 5042,
  name: "Arc",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.drpc.mainnet.arc.io"] } },
});
export const BASE_CHAIN_ID = 8453;
export const BASE_DOMAIN = 6;
export const ARC_DOMAIN = 26;
export const USDC_ARC = "0x3600000000000000000000000000000000000000" as Address;
export const CCTP_TOKEN_MESSENGER = "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d" as Address;
export const CCTP_MESSAGE_TRANSMITTER = "0x81D40F21F12A8F0E3252Bccb954D722d4c464B64" as Address;
export const IRIS_API = "https://iris-api.circle.com";
export const BUYER_ADDRESS = "0x3bF7bf14c839AC615F87cDeDe344dF01B9cFb89f" as Address;

/** Fast transfer (minFinalityThreshold=1000) per fee-calc-and-verdict.md. */
export const MIN_FINALITY_THRESHOLD = 1000;
export const MAX_FEE_MINOR = 50_000n; // 0.05 USDC cap → net ≥3.5 USDC on 3.6 burn
export const BURN_AMOUNT_USDC_DEFAULT = "3.6";
export const BURN_AMOUNT_HARD_CAP_USDC = "4.0"; // absolute ceiling (D-209-4 + fees)
export const FUNDING_STATE_ENV = "GEC_FUNDING_STATE";
export const FUNDING_STATE_DEFAULT =
  "../../docs/EPICS/209-gec-buyer-route/evidence/funding-state.json";

const ERC20 = parseAbi([
  "function approve(address,uint256) returns (bool)",
  "function allowance(address,address) view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
]);
const TM = parseAbi([
  "function depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold) returns (uint64)",
]);
const MT = parseAbi([
  "function receiveMessage(bytes message, bytes attestation) returns (bool)",
]);

const log = (...a: unknown[]) => console.log(`[gec-funding]`, ...a);

function envKey(name: string): `0x${string}` {
  const k = process.env[name];
  if (!k) throw new Error(`missing env ${name}`);
  return (k.startsWith("0x") ? k : `0x${k}`) as `0x${string}`;
}

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

/** depositForBurn arg tuple; destinationCaller=recipient (buyer-only mint). */
export function buildDepositForBurnArgs(
  amountMinor: bigint,
  recipient: Address,
): readonly [bigint, number, Hex, Address, Hex, bigint, number] {
  return [
    amountMinor,
    BASE_DOMAIN,
    pad(recipient, { size: 32 }),
    USDC_ARC,
    pad(recipient, { size: 32 }), // destinationCaller — buyer-only mint
    MAX_FEE_MINOR,
    MIN_FINALITY_THRESHOLD,
  ];
}

export type AttestationState = "pending" | "ready" | "failed";

/** Classify one iris /v2/messages entry — FAILED must abort, never mint. */
export function classifyAttestation(m: {
  status?: string;
  attestation?: string | null;
  message?: string | null;
} | undefined): AttestationState {
  if (!m) return "pending";
  const st = (m.status ?? "").toLowerCase();
  if (st === "failed" || st === "error") return "failed";
  if (m.message && m.attestation && m.attestation !== "PENDING" && m.attestation.startsWith("0x")) {
    return "ready";
  }
  return "pending";
}

// ─── Funding state file (resume/idempotency) ──────────────────────────
export interface FundingState {
  burn_tx?: string;
  mint_tx?: string;
  amount_minor?: string;
  recipient?: string;
  updated_at?: string;
}

export function defaultFundingStatePath(): string {
  return process.env[FUNDING_STATE_ENV] ?? FUNDING_STATE_DEFAULT;
}

export function loadFundingState(path: string): FundingState {
  try {
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    return JSON.parse(readFileSync(path, "utf8")) as FundingState;
  } catch {
    return {};
  }
}

export function saveFundingState(path: string, s: FundingState): void {
  const { writeFileSync, mkdirSync } = require("node:fs") as typeof import("node:fs");
  const { dirname } = require("node:path") as typeof import("node:path");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    JSON.stringify({ ...s, updated_at: new Date().toISOString() }, null, 2) + "\n",
  );
}

// ─── Clients ──────────────────────────────────────────────────────────
function arcClients() {
  const acct = privateKeyToAccount(envKey("ARC_OPERATOR_KEY"));
  return {
    acct,
    pub: createPublicClient({ chain: ARC, transport: http() }),
    wal: createWalletClient({ account: acct, chain: ARC, transport: http() }),
  };
}

async function baseClients() {
  const { base } = await import("viem/chains");
  const acct = privateKeyToAccount(envKey("GEC_INTEROP_PRIVATE_KEY"));
  return {
    acct,
    pub: createPublicClient({ chain: base, transport: http() }),
    wal: createWalletClient({ account: acct, chain: base, transport: http() }),
  };
}

// ─── Guards (run before ANY spend) ────────────────────────────────────
async function verifyContracts(): Promise<void> {
  const { pub: pubArc } = arcClients();
  const { pub: pubBase } = await baseClients();
  const checks: [Promise<Hex | undefined>, string][] = [
    [pubArc.getCode({ address: USDC_ARC }), "USDC@Arc"],
    [pubArc.getCode({ address: CCTP_TOKEN_MESSENGER }), "TokenMessengerV2@Arc"],
    [pubBase.getCode({ address: CCTP_MESSAGE_TRANSMITTER }), "MessageTransmitterV2@Base"],
  ];
  for (const [p, name] of checks) {
    const code = await p;
    if (!code || code === "0x") throw new Error(`no bytecode at ${name} — address wrong or RPC broken`);
  }
  log("contract bytecode verified: USDC@Arc, TokenMessengerV2@Arc, MessageTransmitterV2@Base");
}

async function balances(): Promise<{ arcUsdc: bigint; baseEth: bigint; baseUsdc: bigint }> {
  const { pub: pubArc, acct: src } = arcClients();
  const { pub: pubBase, acct: buyer } = await baseClients();
  const arcUsdc = await pubArc.readContract({
    address: USDC_ARC, abi: ERC20, functionName: "balanceOf", args: [src.address],
  });
  const baseEth = await pubBase.getBalance({ address: buyer.address });
  const baseUsdc = await pubBase.readContract({
    address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    abi: ERC20, functionName: "balanceOf", args: [buyer.address],
  });
  return { arcUsdc, baseEth, baseUsdc };
}

// ─── Attestation polling ──────────────────────────────────────────────
export async function pollAttestation(burnTx: string, maxPolls = 180): Promise<{ msg: Hex; att: Hex }> {
  for (let i = 0; i < maxPolls; i++) {
    const r = await fetch(`${IRIS_API}/v2/messages/${ARC_DOMAIN}?transactionHash=${burnTx}`);
    const j = (await r.json()) as { messages?: { status?: string; attestation?: string | null; message?: string | null }[] };
    const m = j.messages?.[0];
    const st = classifyAttestation(m);
    if (st === "failed") throw new Error(`attestation FAILED for ${burnTx} — inspect iris before retry`);
    if (st === "ready") return { msg: m!.message as Hex, att: m!.attestation as Hex };
    if (i % 6 === 0) log(`iris: ${m?.status ?? r.status} (poll ${i})`);
    await new Promise((r2) => setTimeout(r2, 10_000));
  }
  throw new Error("attestation timeout — use resume later; funds NOT lost, burn already attested or pending");
}

// ─── Modes ────────────────────────────────────────────────────────────
function submit(argv: string[]): boolean {
  return argv.includes("--submit");
}

function txArg(argv: string[], state: FundingState): string {
  const t = argv.find((a) => a.startsWith("--tx="))?.split("=", 2)[1] ?? state.burn_tx;
  if (!t || !/^0x[0-9a-fA-F]{64}$/.test(t)) throw new Error("no burn tx — pass --tx=<hash> or run burn first");
  return t;
}

async function cmdPlan(argv: string[]): Promise<void> {
  const amount = parseUsdcAmount(
    argv.find((a) => a.startsWith("--amount="))?.split("=", 2)[1] ?? BURN_AMOUNT_USDC_DEFAULT,
  );
  await verifyContracts();
  const { acct: src } = arcClients();
  const b = await balances();
  log(`src ${src.address} Arc USDC: ${Number(b.arcUsdc) / 1e6} (need ${Number(amount) / 1e6} + fees)`);
  log(`buyer ${BUYER_ADDRESS} Base ETH: ${Number(b.baseEth) / 1e18}, Base USDC: ${Number(b.baseUsdc) / 1e6}`);
  if (b.arcUsdc < amount) throw new Error("insufficient Arc USDC for burn");
  if (b.baseEth === 0n) throw new Error("buyer has NO Base ETH — cannot submit receiveMessage");
  const args = buildDepositForBurnArgs(amount, BUYER_ADDRESS);
  log("planned depositForBurn:", JSON.stringify({
    amount_minor: args[0].toString(), destinationDomain: args[1], mintRecipient: args[2],
    burnToken: args[3], destinationCaller: args[4], maxFee: args[5].toString(),
    minFinalityThreshold: args[6],
  }, null, 2));
  log(`net on Base ≥ ${(Number(amount - MAX_FEE_MINOR) / 1e6).toFixed(6)} USDC`);
  log("PLAN OK — pass burn --submit to execute (gated to 209-5, post-audit)");
}

async function cmdBurn(argv: string[]): Promise<void> {
  const statePath = defaultFundingStatePath();
  const state = loadFundingState(statePath);
  if (state.burn_tx) {
    log(`burn already sent: ${state.burn_tx} — idempotent skip (use resume)`);
    return;
  }
  const amount = parseUsdcAmount(
    argv.find((a) => a.startsWith("--amount="))?.split("=", 2)[1] ?? BURN_AMOUNT_USDC_DEFAULT,
  );
  await verifyContracts();
  const { wal, pub, acct } = arcClients();
  const bal = await balances();
  if (bal.arcUsdc < amount) throw new Error("insufficient Arc USDC for burn");
  if (!submit(argv)) { log("dry-run — pass --submit to send REAL burn (209-5 only)"); return; }

  const allowance = await pub.readContract({
    address: USDC_ARC, abi: ERC20, functionName: "allowance",
    args: [acct.address, CCTP_TOKEN_MESSENGER],
  });
  if (allowance < amount) {
    const tx = await wal.writeContract({
      address: USDC_ARC, abi: ERC20, functionName: "approve",
      args: [CCTP_TOKEN_MESSENGER, amount],
    });
    log("approve tx:", tx);
    const rc = await pub.waitForTransactionReceipt({ hash: tx });
    if (rc.status !== "success") throw new Error(`approve failed: ${tx}`);
  }
  const burnTx = await wal.writeContract({
    address: CCTP_TOKEN_MESSENGER, abi: TM, functionName: "depositForBurn",
    args: buildDepositForBurnArgs(amount, BUYER_ADDRESS),
  });
  log("burn tx:", burnTx, `https://explorer.arc.io/tx/${burnTx}`);
  const rc = await pub.waitForTransactionReceipt({ hash: burnTx });
  if (rc.status !== "success") throw new Error(`depositForBurn reverted: ${burnTx}`);
  saveFundingState(statePath, {
    ...state, burn_tx: burnTx, amount_minor: amount.toString(), recipient: BUYER_ADDRESS,
  });
  log(`state → ${statePath}; next: attest/poll, then mint --submit`);
}

async function cmdAttest(argv: string[]): Promise<void> {
  const state = loadFundingState(defaultFundingStatePath());
  const burnTx = txArg(argv, state);
  const { msg, att } = await pollAttestation(burnTx);
  log("attestation ready:", { message: `${msg.slice(0, 42)}…`, attestation: `${att.slice(0, 42)}…` });
}

async function cmdMint(argv: string[]): Promise<void> {
  const statePath = defaultFundingStatePath();
  const state = loadFundingState(statePath);
  if (state.mint_tx) {
    log(`mint already done: ${state.mint_tx} — idempotent skip`);
    return;
  }
  const burnTx = txArg(argv, state);
  const { pub: pubBase, acct } = await baseClients();
  const eth = await pubBase.getBalance({ address: acct.address });
  if (eth === 0n) throw new Error("buyer has NO Base ETH — cannot submit receiveMessage");
  const { msg, att } = await pollAttestation(burnTx);
  if (!submit(argv)) { log("dry-run — pass --submit to send REAL receiveMessage (209-5 only)"); return; }
  const { wal } = await baseClients();
  const mintTx = await wal.writeContract({
    address: CCTP_MESSAGE_TRANSMITTER, abi: MT, functionName: "receiveMessage",
    args: [msg, att],
  });
  log("mint tx:", mintTx);
  const rc = await pubBase.waitForTransactionReceipt({ hash: mintTx });
  if (rc.status !== "success") throw new Error(`receiveMessage reverted: ${mintTx}`);
  saveFundingState(statePath, { ...state, burn_tx: burnTx, mint_tx: mintTx });
  log(`USDC minted on Base → ${BUYER_ADDRESS}`);
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
    case "mint": return cmdMint(argv);
    case "resume": {
      const state = loadFundingState(defaultFundingStatePath());
      const burnTx = txArg(argv, state);
      const { msg, att } = await pollAttestation(burnTx);
      log("attestation ready");
      if (!submit(argv)) { log("dry-run — pass --submit to mint"); return; }
      const { wal, pub } = await baseClients();
      const mintTx = await wal.writeContract({
        address: CCTP_MESSAGE_TRANSMITTER, abi: MT, functionName: "receiveMessage",
        args: [msg, att],
      });
      log("mint tx:", mintTx);
      const rc = await pub.waitForTransactionReceipt({ hash: mintTx });
      if (rc.status !== "success") throw new Error(`receiveMessage reverted: ${mintTx}`);
      saveFundingState(defaultFundingStatePath(), {
        ...loadFundingState(defaultFundingStatePath()), burn_tx: burnTx, mint_tx: mintTx,
      });
      return;
    }
    case "status": return cmdStatus();
    default:
      console.error("usage: bun run scripts/gec-funding-cctp.mts plan|burn|attest|mint|resume|status [--amount=] [--tx=] [--submit]");
      process.exit(1);
  }
}

// Test import skips main — VITEST env is set by the runner (argv name
// varies under bunx vitest).
if (!process.env.VITEST) {
  main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
}
