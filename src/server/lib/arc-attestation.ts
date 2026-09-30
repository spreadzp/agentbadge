/**
 * SLICE-151-3: Arc attestation chain writer.
 *
 * Writes a scan attestation on-chain:
 *   1. ERC-8004 giveFeedback(agentId, score, tag1="readiness", …) on the
 *      ReputationRegistry — signed by ARC_EVALUATOR_KEY.
 *   2. Memo contract wrap of identity ownerOf(agentId) carrying
 *      memoId = keccak256(reportHash) + ASCII score summary (audit trail).
 *
 * Two-wallet rule (D6-151): feedback MUST come from the evaluator EOA —
 * never from the agent-owner key (ERC-8004 self-deal ban, F-verified on
 * testnet in SLICE-151-2 smoke run).
 *
 * Oracle agent: site attestations default to OUR oracle agentId
 * (ARC_ORACLE_AGENT_ID). The oracle agent is registered once under the
 * OPERATOR key — it cannot be created by the evaluator key (self-deal).
 * Clients may pass their own registered `agentId` in the POST body.
 */

import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  keccak256,
  stringToHex,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  createErc8004,
  createMemoClient,
  type Erc8004,
  type MemoClient,
} from "@agentbadge/circle-payments";
import { parseAbi } from "viem";

const IDENTITY_READ_ABI = parseAbi([
  "function ownerOf(uint256 tokenId) view returns (address)",
]);

export interface ArcAttestationConfig {
  /** Hex chain id target (5042002 testnet / 5042 mainnet). */
  chainId: number;
  rpcUrl: string;
  /** Evaluator EOA key — writes giveFeedback. MUST differ from the
   *  oracle agent's owner key (ERC-8004 self-deal ban). */
  evaluatorKey: `0x${string}`;
  /** Default oracle agentId for site attestations. */
  oracleAgentId?: bigint;
  usdc: `0x${string}`;
  identityRegistry: `0x${string}`;
  reputationRegistry: `0x${string}`;
  memoContract: `0x${string}`;
}

export interface AttestationWriteInput {
  /** Target agentId — defaults to the oracle agent when omitted. */
  agentId?: bigint;
  url: string;
  domain: string;
  /** 0–100 readiness score. */
  score: number;
  /** "ready" | "needs-work" | … scanner status. */
  status: string;
  /** bytes32 report hash — becomes feedback hash + memoId seed. */
  reportHash: `0x${string}`;
}

export interface AttestationWriteResult {
  agentId: bigint;
  feedbackTx: Hex;
  memoTx: Hex;
}

export interface ArcAttestationWriter {
  write(input: AttestationWriteInput): Promise<AttestationWriteResult>;
}

export function createArcAttestationWriter(
  cfg: ArcAttestationConfig,
): ArcAttestationWriter {
  const chain = {
    id: cfg.chainId,
    name: cfg.chainId === 5042 ? "arc" : "arc-testnet",
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
    rpcUrls: { default: { http: [cfg.rpcUrl] } },
  } as const;
  const pub = createPublicClient({ chain, transport: http() });
  const evaluator = createWalletClient({
    account: privateKeyToAccount(cfg.evaluatorKey),
    chain,
    transport: http(),
  });
  const identity: Erc8004 = createErc8004({
    read: pub as never,
    identity: cfg.identityRegistry,
    reputation: cfg.reputationRegistry,
  });
  const memo: MemoClient = createMemoClient({
    read: pub as never,
    memo: cfg.memoContract,
  });

  return {
    async write(input) {
      const agentId = input.agentId ?? cfg.oracleAgentId;
      if (agentId === undefined) {
        throw new Error(
          "no agentId: set ARC_ORACLE_AGENT_ID or pass agentId in the request",
        );
      }
      // Scanner scores can be fractional — int256 feedback needs an int.
      const score = Math.round(input.score);

      // 1. ERC-8004 reputation feedback — evaluator key signs.
      const feedbackTx = await identity.giveFeedback(evaluator as never, {
        agentId,
        value: BigInt(score),
        decimals: 0,
        tag1: "readiness",
        tag2: input.status,
        endpoint: input.url,
        feedbackURI: `agentbadge:attestation:${input.domain}`,
        hash: input.reportHash,
      });
      await pub.waitForTransactionReceipt({ hash: feedbackTx });

      // 2. Memo event — memoId = keccak256(reportHash), ASCII summary.
      //    Inner call ownerOf(agentId) doubles as an onchain liveness check.
      const memoTx = await memo.callWithMemo(evaluator as never, {
        target: cfg.identityRegistry,
        data: encodeFunctionData({
          abi: IDENTITY_READ_ABI,
          functionName: "ownerOf",
          args: [agentId],
        }),
        memoId: keccak256(input.reportHash),
        memoData: stringToHex(
          `attestation score=${input.score} status=${input.status} domain=${input.domain}`,
        ),
      });
      await pub.waitForTransactionReceipt({ hash: memoTx });

      return { agentId, feedbackTx, memoTx };
    },
  };
}
