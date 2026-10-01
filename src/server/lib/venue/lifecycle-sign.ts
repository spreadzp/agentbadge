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
import { createWalletClient, http, type Hex } from "viem";
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
 * Resolve a server signer for role. Returns null when no key or the
 * derived address is not in the ARC_VENUE_SERVER_WALLETS allowlist
 * (allowlist unset = key presence is enough).
 */
export function serverSigner(
  role: VenueRole,
  rpcUrl: string,
): { address: `0x${string}`; send: (tx: PreparedTx) => Promise<Hex> } | null {
  const key = roleKey(role);
  if (!key) return null;
  const account = privateKeyToAccount(key);
  const allow = serverWalletAllowlist();
  if (Object.keys(allow).length > 0 && allow[role] !== account.address.toLowerCase()) {
    return null;
  }
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

/** Default server-sign sender — sends each tx sequentially as `role`. */
export async function sendAsRole(
  role: VenueRole,
  txs: PreparedTx[],
  rpcUrl: string,
): Promise<Hex[] | null> {
  const signer = serverSigner(role, rpcUrl);
  if (!signer) return null;
  const hashes: Hex[] = [];
  for (const tx of txs) hashes.push(await signer.send(tx));
  return hashes;
}
