import { createPublicClient, http, type PublicClient } from "viem";
import { baseSepolia } from "viem/chains";
import { getConfig } from "../../config/env";

const TRUST_REGISTRY_ABI = [
  {
    inputs: [{ name: "siteUrl", type: "string" }],
    name: "latestScoreFor",
    outputs: [
      { name: "score", type: "uint256" },
      { name: "recordedAt", type: "uint256" },
      { name: "valid", type: "bool" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "getRecordCount",
    outputs: [{ name: "count", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "id", type: "uint256" }],
    name: "getRecord",
    outputs: [
      { name: "siteUrl", type: "string" },
      { name: "score", type: "uint256" },
      { name: "scannerVersion", type: "string" },
      { name: "rulesPassed", type: "uint256" },
      { name: "recordedAt", type: "uint256" },
      { name: "revoked", type: "bool" },
    ],
    stateMutability: "view",
    type: "function",
  },
] as const;

let publicClient: PublicClient | null = null;

function getClient(): PublicClient {
  if (!publicClient) {
    const cfg = getConfig();
    const rpcUrl = cfg.base?.rpcUrl ?? "https://sepolia.base.org";
    publicClient = createPublicClient({
      chain: { ...baseSepolia, id: cfg.base?.chainId ?? 84532, rpcUrls: { default: { http: [rpcUrl] } } },
      transport: http(rpcUrl),
    });
  }
  return publicClient;
}

export interface LatestScore {
  score: number;
  recordedAt: number;
  valid: boolean;
}

export async function readLatestScoreFor(registryAddress: string, siteUrl: string): Promise<LatestScore | null> {
  try {
    const client = getClient();
    const result = await client.readContract({
      address: registryAddress as `0x${string}`,
      abi: TRUST_REGISTRY_ABI,
      functionName: "latestScoreFor",
      args: [siteUrl],
    });
    const [score, recordedAt, valid] = result as [bigint, bigint, boolean];
    return { score: Number(score), recordedAt: Number(recordedAt), valid };
  } catch {
    return null;
  }
}

export interface OnchainRecord {
  id: number;
  siteUrl: string;
  score: number;
  recordedAt: number;
  revoked: boolean;
}

export async function readRecentRecords(registryAddress: string, count: number): Promise<OnchainRecord[] | null> {
  try {
    const client = getClient();
    const total = Number(
      await client.readContract({
        address: registryAddress as `0x${string}`,
        abi: TRUST_REGISTRY_ABI,
        functionName: "getRecordCount",
      }),
    );
    if (total === 0) return [];
    const from = Math.max(1, total - count + 1);
    const records: OnchainRecord[] = [];
    for (let id = total; id >= from; id--) {
      const r = (await client.readContract({
        address: registryAddress as `0x${string}`,
        abi: TRUST_REGISTRY_ABI,
        functionName: "getRecord",
        args: [BigInt(id)],
      })) as [string, bigint, string, bigint, bigint, boolean];
      records.push({ id, siteUrl: r[0], score: Number(r[1]), recordedAt: Number(r[4]), revoked: r[5] });
    }
    return records;
  } catch {
    return null;
  }
}

export function resetKeeperHubPublicClient(): void {
  publicClient = null;
}
