/**
 * SLICE-151-9: venue chain layer — single active network via ARC_NETWORK
 * (D13-151). Read-only: getJob status pull for the htmx poll + ERC-8004
 * ownerOf for the provider gate (D5). No indexer — direct readContract.
 */
import {
  createPublicClient,
  decodeEventLog,
  http,
  parseAbi,
  type PublicClient,
} from "viem";
import {
  ARC_MAINNET,
  ARC_TESTNET,
  ARC_CONTRACTS,
  ARC_MAINNET_CONTRACTS,
  ERC8183_ACP_ABI,
  ERC8183_ABI,
  type SupportedChain,
} from "@agentbadge/circle-payments";

export type VenueNetworkName = "mainnet" | "testnet";

export interface VenueNetwork {
  name: VenueNetworkName;
  chain: SupportedChain;
  /** ACPCore (our deploy, acp ABI) on mainnet; Circle protocol deploy on testnet. */
  agenticCommerce: `0x${string}`;
  identityRegistry: `0x${string}`;
  /** ERC-8004 reputation registry — giveFeedback target (152-3). */
  reputationRegistry: `0x${string}`;
  /** Memo wrapper contract — feedback+Memo in one tx (152-3). */
  memo: `0x${string}`;
  /** getJob tuple shape differs between deploys. */
  variant: "circle" | "acp";
  abi: typeof ERC8183_ACP_ABI | typeof ERC8183_ABI;
  explorerTx: (hash: string) => string;
  explorerAddr: (addr: string) => string;
}

const OWNER_OF_ABI = parseAbi([
  "function ownerOf(uint256 tokenId) view returns (address)",
]);

const IDENTITY_LOOKUP_ABI = parseAbi([
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function tokenURI(uint256 tokenId) view returns (string)",
]);

const arcExplorers: Record<VenueNetworkName, string> = {
  mainnet: "https://explorer.arc.io",
  testnet: "https://testnet.arcscan.app",
};

export function resolveVenueNetwork(): VenueNetwork {
  const name: VenueNetworkName =
    process.env.ARC_NETWORK === "mainnet" ? "mainnet" : "testnet";
  const base = arcExplorers[name];
  if (name === "mainnet") {
    return {
      name,
      chain: ARC_MAINNET,
      agenticCommerce: ARC_MAINNET_CONTRACTS.agenticCommerce,
      identityRegistry: ARC_MAINNET_CONTRACTS.identityRegistry,
      reputationRegistry: ARC_MAINNET_CONTRACTS.reputationRegistry,
      memo: ARC_MAINNET_CONTRACTS.memo,
      variant: "acp",
      abi: ERC8183_ACP_ABI,
      explorerTx: (h) => `${base}/tx/${h}`,
      explorerAddr: (a) => `${base}/address/${a}`,
    };
  }
  return {
    name,
    chain: ARC_TESTNET,
    agenticCommerce: ARC_CONTRACTS.agenticCommerce,
    identityRegistry: ARC_CONTRACTS.identityRegistry,
    reputationRegistry: ARC_CONTRACTS.reputationRegistry,
    memo: ARC_CONTRACTS.memo,
    variant: "circle",
    abi: ERC8183_ABI,
    explorerTx: (h) => `${base}/tx/${h}`,
    explorerAddr: (a) => `${base}/address/${a}`,
  };
}

let _client: { network: VenueNetworkName; pub: PublicClient } | null = null;

export function publicClient(net: VenueNetwork): PublicClient {
  if (!_client || _client.network !== net.name) {
    _client = {
      network: net.name,
      pub: createPublicClient({
        transport: http(net.chain.rpcUrl, { timeout: 30_000 }),
      }) as PublicClient,
    };
  }
  return _client.pub;
}

// ─── getJob status pull (F1: readContract primary) ───────────────

export interface OnchainJob {
  client: `0x${string}`;
  provider: `0x${string}`;
  evaluator: `0x${string}`;
  budget: bigint;
  status: number;
  expiredAt: bigint;
}

const ZERO_ADDR = "0x0000000000000000000000000000000000000000";

/**
 * Extract onchain jobId from a confirmed createJob tx — decodes the
 * JobCreated event (topics[1] is jobId in both ABI flavors). Returns
 * null when the receipt is missing or the event is not found — callers
 * treat it as non-fatal (status sync can retry later).
 */
export async function fetchCreatedJobId(
  txHash: `0x${string}`,
  net: VenueNetwork = resolveVenueNetwork(),
): Promise<number | null> {
  try {
    const pub = publicClient(net);
    const receipt = await pub.getTransactionReceipt({ hash: txHash });
    for (const log of receipt.logs) {
      try {
        const decoded = decodeEventLog({
          abi: net.abi,
          data: log.data,
          topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
        });
        if (decoded.eventName === "JobCreated") {
          return Number((decoded.args as { jobId: bigint }).jobId);
        }
      } catch {
        continue;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/** Returns null when the job does not exist onchain or the call reverts. */
export async function fetchOnchainJob(
  onchainJobId: number,
  net: VenueNetwork = resolveVenueNetwork(),
): Promise<OnchainJob | null> {
  try {
    const pub = publicClient(net);
    const raw = await pub.readContract({
      address: net.agenticCommerce,
      abi: net.abi,
      functionName: "getJob",
      args: [BigInt(onchainJobId)],
    } as never);
    // Both ABIs return a tuple {client, provider, evaluator, hook, token,
    // budget, expiredAt, status} — field order identical across variants.
    const j = raw as unknown as {
      client: `0x${string}`;
      provider: `0x${string}`;
      evaluator: `0x${string}`;
      budget: bigint;
      expiredAt: bigint;
      status: number;
    };
    if (j.client === ZERO_ADDR) return null;
    return j;
  } catch {
    return null;
  }
}

/** ERC-8004 provider gate (D5): agentId owner must equal the signer wallet. */
export async function fetchAgentOwner(
  agentId: number,
  net: VenueNetwork = resolveVenueNetwork(),
): Promise<`0x${string}` | null> {
  try {
    const pub = publicClient(net);
    return (await pub.readContract({
      address: net.identityRegistry,
      abi: OWNER_OF_ABI,
      functionName: "ownerOf",
      args: [BigInt(agentId)],
    })) as `0x${string}`;
  } catch {
    return null;
  }
}

/** Test hook: drop the cached client (e.g. after ARC_NETWORK change). */
export function resetVenueClientForTesting(): void {
  _client = null;
}

export interface AgentLookup {
  owner: `0x${string}` | null;
  metadataURI: string | null;
}

/**
 * SLICE-152-6: ERC-8004 identity read — ownerOf + tokenURI on
 * IdentityRegistry. Both legs tolerate failure (unregistered agentId →
 * nulls, not a throw) so profiles degrade to index-only data.
 */
export async function fetchAgentLookup(
  agentId: number,
  net: VenueNetwork = resolveVenueNetwork(),
): Promise<AgentLookup> {
  const pub = publicClient(net);
  const [owner, metadataURI] = await Promise.all([
    pub
      .readContract({
        address: net.identityRegistry,
        abi: IDENTITY_LOOKUP_ABI,
        functionName: "ownerOf",
        args: [BigInt(agentId)],
      })
      .then((o) => o as `0x${string}`)
      .catch(() => null),
    pub
      .readContract({
        address: net.identityRegistry,
        abi: IDENTITY_LOOKUP_ABI,
        functionName: "tokenURI",
        args: [BigInt(agentId)],
      })
      .then((u) => u as string)
      .catch(() => null),
  ]);
  return { owner, metadataURI };
}
