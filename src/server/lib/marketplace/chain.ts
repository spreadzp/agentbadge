// ─── Marketplace chain constants + helpers (SLICE-140-22) ──────
import {
  defineChain,
  keccak256,
  encodePacked,
  stringToHex,
} from "viem";

export const arcTestnet = defineChain({
  id: 5042002,
  name: "arc-testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: {
    default: {
      http: [
        process.env.ARC_RPC_URL ?? "https://rpc.blockdaemon.testnet.arc.network",
      ],
    },
  },
});

export const NFT_ABI = [
  {
    name: "mintPassport",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "metaURI", type: "string" },
      { name: "durationSec", type: "uint64" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "registerService",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "passportId", type: "uint256" },
      { name: "subId", type: "bytes32" },
      { name: "price", type: "uint256" },
      { name: "metaURI", type: "string" },
    ],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    name: "mintServicePass",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "serviceId", type: "bytes32" },
      { name: "durationSec", type: "uint64" },
      { name: "agentId_", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "passportOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "w", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "passportValid",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "passportId", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "ownerOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "services",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "serviceId", type: "bytes32" }],
    outputs: [
      { name: "passportId", type: "uint256" },
      { name: "price", type: "uint256" },
      { name: "metaURI", type: "string" },
      { name: "active", type: "bool" },
    ],
  },
  {
    name: "servicePassOf",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "w", type: "address" },
      { name: "serviceId", type: "bytes32" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "expiresAt",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "uint64" }],
  },
] as const;

export const SPLITTER_ABI = [
  {
    name: "receivePayment",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "serviceId", type: "bytes32" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

/** Deterministic serviceId — mirrors keccak256(passportId, subId) on-chain. */
export function serviceIdFor(
  passportId: bigint,
  subId: `0x${string}`,
): `0x${string}` {
  return keccak256(encodePacked(["uint256", "bytes32"], [passportId, subId]));
}

/** subId string ("api", "mcp") → bytes32 (right-padded, readable on-chain). */
export function subIdToBytes32(subId: string): `0x${string}` {
  return stringToHex(subId, { size: 32 });
}

/** USDC decimal string ("5", "5.50") → base units (6 dec). */
export function usdToBaseUnits(usd: string): bigint {
  const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(usd.trim());
  if (!m) throw new Error(`Invalid USDC amount: ${usd}`);
  const frac = (m[2] ?? "").padEnd(6, "0");
  return BigInt(m[1]) * 1_000_000n + BigInt(frac || "0");
}
