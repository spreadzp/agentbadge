/**
 * SLICE-191-9: Arc writer — emitTopic on AgentEventLog (testnet
 * 0x1bb6A87D…4700). Writer key = the log's `writer` EOA
 * (ARC_PRIVATE_KEY deployer on testnet; FXDELTA_ANCHOR_KEY override).
 *
 * The verdict JSON is the event payload — anyone can recompute
 * sha256(canonical) from the onchain bytes (AC2).
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  stringToBytes,
  bytesToHex,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";

export const ARC_EVENT_LOG =
  "0x1bb6A87D18cbd4285b4d383F88f10a1Ed01B4700" as const;
export const ARC_EXPLORER = "https://testnet.arcscan.app";

const EVENT_LOG_ABI = parseAbi([
  "function emitTopic(string topic, bytes payload)",
  "function writer() view returns (address)",
]);

let cached: { writer: (payloadJson: string) => Promise<string> } | null =
  null;

/** Lazy singleton — null when no writer key configured. */
export function getArcEventLogWriter(): {
  writer: (payloadJson: string) => Promise<string>;
} | null {
  if (cached) return cached;
  const key =
    process.env.FXDELTA_ANCHOR_KEY ?? process.env.ARC_PRIVATE_KEY;
  if (!key) return null;

  const rpcUrl =
    process.env.ARC_RPC_URL ?? "https://rpc.testnet.arc.network";
  const account = privateKeyToAccount(key as Hex);
  const pub = createPublicClient({
    chain: arcTestnet,
    transport: http(rpcUrl),
  });
  const wallet = createWalletClient({
    account,
    chain: arcTestnet,
    transport: http(rpcUrl),
  });

  cached = {
    async writer(payloadJson: string) {
      const tx = await wallet.writeContract({
        address: ARC_EVENT_LOG,
        abi: EVENT_LOG_ABI,
        functionName: "emitTopic",
        args: ["fxdelta-verdict", bytesToHex(stringToBytes(payloadJson))],
      });
      await pub.waitForTransactionReceipt({ hash: tx });
      return tx;
    },
  };
  return cached;
}

/** Test hook. */
export function resetArcEventLogWriter(): void {
  cached = null;
}
