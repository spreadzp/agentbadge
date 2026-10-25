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
 * SIGNER_BACKEND: "env" (default) | "socket". "socket" is the SLICE-173-2
 * backend — declaring it now makes the unsupported state fail fast
 * instead of silently falling back to an env key (D-173-4: fail
 * closed, never fake).
 */
import {
  createWalletClient,
  http,
  type Account,
  type Chain,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
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
 * Declared signer backend. "socket" throws — the unix-socket signer
 * service lands in SLICE-173-2; until then the env backend is the only
 * valid answer and pretending otherwise would hide custody.
 */
export function signerBackend(): "env" {
  const raw = (process.env.SIGNER_BACKEND ?? "env").toLowerCase();
  if (raw === "env") return "env";
  if (raw === "socket") {
    throw new Error(
      "SIGNER_BACKEND=socket is not supported yet — unix-socket signer " +
        "service lands in SLICE-173-2; use 'env' until then",
    );
  }
  throw new Error(`Unknown SIGNER_BACKEND "${raw}" (env | socket)`);
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
