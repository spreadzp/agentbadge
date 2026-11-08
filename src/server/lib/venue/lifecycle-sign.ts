/**
 * SLICE-152-2: server-sign mode — role EOA resolution, ARC_VENUE_SERVER_WALLETS
 * allowlist, and the default sequential tx sender. Extracted from
 * lifecycle.ts to keep files under max-lines.
 *
 * sign:"server" is honoured only when a role key exists (ROLE_KEY_ENV) AND,
 * if the allowlist env is set, the derived address matches the role entry.
 * EPIC-173 (D-173-1): DEPLOYER_PRIVATE_KEY fallback is gone — role-specific
 * keys first, then the shared ops authority (ARC_OPS_KEY; the deprecated
 * ARC_EVALUATOR_KEY still maps there with a warn for one release).
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  type Hex,
} from "viem";
import { privateKeyToAccount, type LocalAccount } from "viem/accounts";
import { opsKey } from "../eaas/keys";
import type { PreparedTx } from "./lifecycle";

export type VenueRole = "client" | "provider" | "evaluator";

/** role → dedicated private key env var (ops authority is the fallback). */
const ROLE_KEY_ENV: Record<VenueRole, string[]> = {
  client: ["ARC_VENUE_CLIENT_KEY"],
  provider: ["ARC_VENUE_PROVIDER_KEY"],
  evaluator: ["ARC_VENUE_EVALUATOR_KEY"],
};

/** Parse ARC_VENUE_SERVER_WALLETS="client:0x…,provider:0x…" allowlist. */
export function serverWalletAllowlist(): Partial<Record<VenueRole, string>> {
  const raw = process.env.ARC_VENUE_SERVER_WALLETS ?? "";
  const out: Partial<Record<VenueRole, string>> = {};
  for (const part of raw.split(",")) {
    const [role, addr] = part.split(":").map((s) => s.trim());
    if (role && addr && /^0x[0-9a-fA-F]{40}$/.test(addr)) {
      out[role as VenueRole] = addr.toLowerCase();
    }
  }
  return out;
}

function roleKey(role: VenueRole): `0x${string}` | null {
  for (const env of ROLE_KEY_ENV[role]) {
    const k = process.env[env];
    if (k && /^0x[0-9a-fA-F]{64}$/.test(k)) return k as `0x${string}`;
  }
  // Venue server-signing is an ops authority (D-173-1) — role-specific
  // key absent → shared ops key; the legacy ARC_EVALUATOR_KEY maps in
  // there with a deprecation warn. No DEPLOYER_PRIVATE_KEY fallback.
  return opsKey();
}

/**
 * Role EOA without a wallet client — same key + allowlist resolution
 * as serverSigner (returns null when no key or the derived address is
 * not in the ARC_VENUE_SERVER_WALLETS allowlist). 197-19: needed to
 * put a real evaluator address into createJob — the circle deploy
 * reverts on evaluator=0x0.
 */
export function serverRoleAddress(role: VenueRole): `0x${string}` | null {
  const key = roleKey(role);
  if (!key) return null;
  const account = privateKeyToAccount(key);
  const allow = serverWalletAllowlist();
  if (Object.keys(allow).length > 0 && allow[role] !== account.address.toLowerCase()) {
    return null;
  }
  return account.address;
}

export function serverSigner(
  role: VenueRole,
  rpcUrl: string,
): { address: `0x${string}`; send: (tx: PreparedTx) => Promise<Hex> } | null {
  const address = serverRoleAddress(role);
  if (!address) return null;
  const key = roleKey(role);
  const account = privateKeyToAccount(key as `0x${string}`);
  const wallet = createWalletClient({ account, transport: http(rpcUrl) });
  const publicClient = createPublicClient({ transport: http(rpcUrl) });
  return {
    address: account.address,
    send: (tx) => signAndSendRaw(account, wallet, publicClient, tx),
  };
}

/** Sign locally, broadcast raw, return the tx hash.
 * Sign first so the tx hash is known BEFORE broadcast: flaky
 * load-balanced RPCs (blockdaemon) can accept a raw tx on one
 * backend, then answer a viem internal retry with "already
 * known" — the error kills the caller while the tx still
 * mines. Precompute the hash and treat "already known" as
 * submitted; the receipt wait downstream confirms the outcome. */
async function signAndSendRaw(
  account: LocalAccount,
  wallet: ReturnType<typeof createWalletClient>,
  publicClient: ReturnType<typeof createPublicClient>,
  tx: PreparedTx,
): Promise<Hex> {
  const { account: _omit, ...serializable } =
    await wallet.prepareTransactionRequest({
      account,
      to: tx.to,
      data: tx.data,
      chain: null,
    });
  const signed = await account.signTransaction(
    serializable as Parameters<typeof account.signTransaction>[0],
  );
  const hash = keccak256(signed);
  try {
    await publicClient.sendRawTransaction({
      serializedTransaction: signed,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/already known/i.test(msg)) throw err;
  }
  return hash;
}

/** Sequential send + receipt-wait as an explicit local account —
 * for signers that are NOT venue ROLE keys (per-hop providers
 * signing their own setBudget in the supply-chain dogfood). Same
 * ordering + success semantics as sendAsRole. */
export async function sendAsAccount(
  account: LocalAccount,
  txs: PreparedTx[],
  rpcUrl: string,
): Promise<Hex[] | null> {
  const wallet = createWalletClient({ account, transport: http(rpcUrl) });
  const publicClient = createPublicClient({ transport: http(rpcUrl) });
  const hashes: Hex[] = [];
  for (const tx of txs) {
    const hash = await signAndSendRaw(account, wallet, publicClient, tx);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") return null;
    hashes.push(hash);
  }
  return hashes;
}

/** Default server-sign sender — sends each tx sequentially as `role`.
 * Waits for each receipt before broadcasting the next: multi-tx batches
 * (approve→fund, createJob→setBudget) need onchain ordering — some RPCs
 * simulate the follow-up tx before its predecessor is mined and revert. */
export async function sendAsRole(
  role: VenueRole,
  txs: PreparedTx[],
  rpcUrl: string,
): Promise<Hex[] | null> {
  const signer = serverSigner(role, rpcUrl);
  if (!signer) return null;
  const publicClient = createPublicClient({ transport: http(rpcUrl) });
  const hashes: Hex[] = [];
  for (const tx of txs) {
    const hash = await signer.send(tx);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    // A mined-but-reverted tx still has a hash — treating it as success
    // would confirm outbox legs that never executed onchain.
    if (receipt.status !== "success") return null;
    hashes.push(hash);
  }
  return hashes;
}
