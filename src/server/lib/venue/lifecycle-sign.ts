/**
 * SLICE-152-2: server-sign mode — role EOA resolution, ARC_VENUE_SERVER_WALLETS
 * allowlist, and the default sequential tx sender. Extracted from
 * lifecycle.ts to keep files under max-lines.
 *
 * sign:"server" is honoured only when a role key exists (ROLE_KEY_ENV) AND,
 * if the allowlist env is set, the derived address matches the role entry.
 * Role→key mapping is MVP: client/provider/evaluator envs fall back to
 * DEPLOYER_PRIVATE_KEY for the demo wallet.
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { PreparedTx } from "./lifecycle";

export type VenueRole = "client" | "provider" | "evaluator";

/** role → private key env var (MVP mapping; evaluator reuses 151 key). */
const ROLE_KEY_ENV: Record<VenueRole, string[]> = {
  client: ["ARC_VENUE_CLIENT_KEY", "DEPLOYER_PRIVATE_KEY"],
  provider: ["ARC_VENUE_PROVIDER_KEY", "DEPLOYER_PRIVATE_KEY"],
  evaluator: ["ARC_EVALUATOR_KEY", "DEPLOYER_PRIVATE_KEY"],
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
  return null;
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
  return {
    address: account.address,
    send: async (tx) =>
      wallet.sendTransaction({
        account,
        to: tx.to,
        data: tx.data,
        chain: null,
      }),
  };
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
    await publicClient.waitForTransactionReceipt({ hash });
    hashes.push(hash);
  }
  return hashes;
}
