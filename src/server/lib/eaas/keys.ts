/**
 * EPIC-173 (SLICE-173-1): signing-authority resolution.
 *
 * Three distinct authorities — never resolved to the same key silently:
 *   settleKey()  → ARC_SETTLE_KEY            (money: escrow settle)
 *   opsKey()     → ARC_OPS_KEY               (ops: attestations, feedback,
 *                                             anchors, mints, venue-eval)
 *   reputation   → ARC_VERDICT_SIGNER_KEY    (EIP-712 verdicts — lives in
 *                                             config/env/eaas.ts)
 *
 * ARC_EVALUATOR_KEY is DEPRECATED (one release): it maps to the settle
 * authority first, then the ops authority, with a warn on each use.
 * DEPLOYER_PRIVATE_KEY fallback is GONE — no dev-key fallback may spend
 * money or sign for the platform (D-173-1, D-173-5).
 *
 * SIGNER_BACKEND: "env" (default) | "socket". "socket" (SLICE-173-2)
 * moves the money key into the unix-socket signer service — the API
 * holds no key material, settle ops are JSON-RPC round-trips on
 * SIGNER_SOCKET_PATH (D-173-2; fail fast, never fake, D-173-4).
 */
import {
  createWalletClient,
  http,
  type Account,
  type Chain,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  arcSignerAsWriteClient,
  createSocketSigner,
  type SocketSigner,
} from "@agentbadge/circle-payments";
import { logger } from "@agentbadge/passport/logger";

const KEY_RE = /^0x[0-9a-fA-F]{64}$/;
const LEGACY_EVAL_ENV = "ARC_EVALUATOR_KEY";
const warnedDeprecated = new Set<string>();

function readKey(env: string): `0x${string}` | null {
  const k = process.env[env];
  return k && KEY_RE.test(k) ? (k as `0x${string}`) : null;
}

function deprecatedMap(authority: string): `0x${string}` | null {
  const k = readKey(LEGACY_EVAL_ENV);
  if (k && !warnedDeprecated.has(authority)) {
    warnedDeprecated.add(authority);
    logger.warn(
      `${LEGACY_EVAL_ENV} is deprecated — set the dedicated key for the ` +
        `${authority} authority (one-release compatibility window)`,
    );
  }
  return k;
}

/** Money authority — escrow/payment settlement (EaaS job evaluator). */
export function settleKey(): `0x${string}` | null {
  return readKey("ARC_SETTLE_KEY") ?? deprecatedMap("settle");
}

/** Ops authority — attestations, feedback, anchors, mints, venue-eval. */
export function opsKey(): `0x${string}` | null {
  return readKey("ARC_OPS_KEY") ?? deprecatedMap("ops");
}

/** Key → account+wallet pair for chain writes (null-safe convenience). */
export function keyWallet(
  key: `0x${string}` | null,
  chain: Chain,
  rpcUrl: string,
): { account: Account | null; wallet: WalletClient | null } {
  const account = key ? privateKeyToAccount(key) : null;
  const wallet = account
    ? createWalletClient({ account, chain, transport: http(rpcUrl) })
    : null;
  return { account, wallet };
}

/**
 * Declared signer backend: "env" (key in process env) | "socket"
 * (money key inside the unix-socket signer service — SLICE-173-2).
 */
export function signerBackend(): "env" | "socket" {
  const raw = (process.env.SIGNER_BACKEND ?? "env").toLowerCase();
  if (raw === "env" || raw === "socket") return raw;
  throw new Error(`Unknown SIGNER_BACKEND "${raw}" (env | socket)`);
}

/**
 * Settle authority for the declared backend (SLICE-173-2).
 * env → viem wallet from ARC_SETTLE_KEY as before.
 * socket → SocketSigner WriteClient; no key material in this process.
 * `account` is env-backend only; `settlerAddress` may be a lazy getter
 * (socket resolves the EOA once connected — throws while down, so
 * call sites must sit behind the signer health-gate anyway).
 */
export interface SettleAuthority {
  wallet: WalletClient | { writeContract: (c: never) => Promise<never> } | null;
  account: Account | null;
  settlerAddress: `0x${string}` | (() => `0x${string}`);
  /** Ping the service — wired into the paid-route health-gate. */
  signerPing?: () => Promise<unknown>;
  /** Socket backend: close() on shutdown (kept for lifecycle hooks). */
  socketSigner?: SocketSigner;
}

export function resolveSettleAuthority(
  chain: Chain,
  rpcUrl: string,
): SettleAuthority {
  if (signerBackend() === "socket") {
    const signer = createSocketSigner({
      socketPath: process.env.SIGNER_SOCKET_PATH,
    });
    return {
      wallet: arcSignerAsWriteClient(signer) as never,
      account: null,
      settlerAddress: () => signer.address,
      signerPing: () => signer.ping(),
      socketSigner: signer,
    };
  }
  const { account, wallet } = keyWallet(settleKey(), chain, rpcUrl);
  return {
    wallet,
    account,
    settlerAddress: account?.address ?? "0x0000000000000000000000000000000000000000",
  };
}

/** Resolve settler EOA — env is a plain address; socket backend (173-2)
 *  is a lazy getter that throws while the service is down (503 via gate). */
export function settlerAddressOf(deps: {
  settlerAddress: `0x${string}` | (() => `0x${string}`);
}): `0x${string}` {
  return typeof deps.settlerAddress === "function"
    ? deps.settlerAddress()
    : deps.settlerAddress;
}

/**
 * Boot-time collision check (AC1): distinct authorities resolving to the
 * same EOA warn loudly — the legacy ARC_EVALUATOR_KEY mapping makes this
 * expected during transition, but it must never be silent.
 */
export function warnKeyOverlap(): void {
  const settle = settleKey();
  const ops = opsKey();
  const settleAddr = settle ? privateKeyToAccount(settle).address : null;
  const opsAddr = ops ? privateKeyToAccount(ops).address : null;
  if (settleAddr && opsAddr && settleAddr === opsAddr) {
    logger.warn(
      `signing-authority overlap: settle and ops resolve to the same EOA ` +
        `(${settleAddr}) — split ARC_SETTLE_KEY / ARC_OPS_KEY (D-173-1)`,
    );
  }
}
