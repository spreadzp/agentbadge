/**
 * Arc-native agentic commerce demo (EPIC-129, ARC-FLOW.md).
 *
 * Full ERC-8183 escrow lifecycle on Arc testnet — every step is a real tx:
 *   0. provider registers passport mirror in ERC-8004 IdentityRegistry
 *   1. client   createJob(provider, evaluator, expiredAt, description)
 *   2. provider setBudget(jobId, budget)
 *   3. client   approve USDC + fund(jobId)           — escrow funded
 *   4. provider submit(jobId, deliverableHash)
 *   5. evaluator verify → settleWithMemo(complete)   — escrow → provider
 *   6. provider collectFee → treasury sweep          — platform fee
 *   7. balances after + tx summary with explorer links
 *
 * Usage:
 *   AGENT_PRIVATE_KEY=0x… DEPLOYER_PRIVATE_KEY=0x… \
 *   CIRCLE_TREASURY_ADDRESS=0x… CIRCLE_PLATFORM_FEE_BPS=250 \
 *   bun scripts/arc-commerce-demo.mts
 */

import {
  createPublicClient,
  createWalletClient,
  defineChain,
  formatUnits,
  http,
  keccak256,
  parseAbi,
  toBytes,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  ARC_TESTNET,
  createCommissionSplitter,
  createErc8004,
  createErc8183,
  createMemoClient,
  jobDescription,
  memoIdFor,
  splitPayout,
  type ReadClient,
  type WriteClient,
} from "@agentbadge/circle-payments";

// ── env ─────────────────────────────────────────────────────────────

const CLIENT_KEY = process.env.AGENT_PRIVATE_KEY as Hex | undefined;
const PROVIDER_KEY = process.env.DEPLOYER_PRIVATE_KEY as Hex | undefined;
const TREASURY = process.env.CIRCLE_TREASURY_ADDRESS as `0x${string}` | undefined;
const FEE_BPS = Number(process.env.CIRCLE_PLATFORM_FEE_BPS ?? "250");
const BUDGET = BigInt(process.env.DEMO_BUDGET_USDC ?? "1000000"); // 1 USDC

if (!CLIENT_KEY || !PROVIDER_KEY || !TREASURY) {
  console.error(
    "Missing env: AGENT_PRIVATE_KEY, DEPLOYER_PRIVATE_KEY, CIRCLE_TREASURY_ADDRESS",
  );
  process.exit(1);
}

// ── chain + clients ─────────────────────────────────────────────────

const arc = defineChain({
  id: ARC_TESTNET.chainId,
  name: ARC_TESTNET.name,
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.ARC_RPC_URL ?? ARC_TESTNET.rpcUrl] },
  },
});

const ARC_MIN_FEE = 20_000_000_000n; // 20 Gwei floor per docs.arc.io
const ARC_TIP = 1_000_000_000n; // 1 Gwei priority

const pub = createPublicClient({ chain: arc, transport: http() });
const clientAcct = privateKeyToAccount(CLIENT_KEY);
const providerAcct = privateKeyToAccount(PROVIDER_KEY);

/** Wrap a viem WalletClient so every write carries Arc gas params. */
function withArcGas(account: typeof clientAcct): WriteClient {
  const w = createWalletClient({ account, chain: arc, transport: http() });
  return {
    writeContract: (args) =>
      w.writeContract({
        ...args,
        maxFeePerGas: ARC_MIN_FEE,
        maxPriorityFeePerGas: ARC_TIP,
      } as Parameters<typeof w.writeContract>[0]),
  };
}

const clientWallet = withArcGas(clientAcct);
const providerWallet = withArcGas(providerAcct);
// Evaluator = server EOA (D12) — same key as provider in this demo.
const evaluatorWallet = providerWallet;

const USDC = ARC_TESTNET.usdc;
const ERC20_BALANCE = parseAbi([
  "function balanceOf(address) view returns (uint256)",
]);
const EXPLORER = ARC_TESTNET.explorerUrl ?? "https://testnet.arcscan.io";

const usdcBalance = (addr: `0x${string}`) =>
  pub.readContract({
    address: USDC,
    abi: ERC20_BALANCE,
    functionName: "balanceOf",
    args: [addr],
  }) as Promise<bigint>;

const fmt = (v: bigint | string) => `${formatUnits(BigInt(v), 6)} USDC`;
const txLink = (h: Hex) => `${EXPLORER}/tx/${h}`;

function line(s = "") {
  console.log(s);
}

async function balances(tag: string) {
  const [c, p, t] = await Promise.all([
    usdcBalance(clientAcct.address),
    usdcBalance(providerAcct.address),
    usdcBalance(TREASURY!),
  ]);
  line(`── balances ${tag}`);
  line(`   client   ${clientAcct.address}  ${fmt(c)}`);
  line(`   provider ${providerAcct.address}  ${fmt(p)}`);
  line(`   treasury ${TREASURY}  ${fmt(t)}`);
  return { client: c, provider: p, treasury: t };
}

// ── demo ────────────────────────────────────────────────────────────

const read = pub as unknown as ReadClient;
const escrow = createErc8183({ read, usdc: USDC });
const memo = createMemoClient({ read });
const erc8004 = createErc8004({ read });
const splitter = createCommissionSplitter({
  usdc: USDC,
  treasury: TREASURY!,
  feeBps: FEE_BPS,
});

const orderId = `arc-demo-${Date.now()}`;
const txs: Array<{ step: string; hash: Hex }> = [];

line("════════════════════════════════════════════════════════");
line(" Arc-native agentic commerce — ERC-8183 escrow end-to-end");
line("════════════════════════════════════════════════════════");
line(`chain:     ${arc.name} (eip155:${arc.id})`);
line(`escrow:    ${escrow.contract}`);
line(`memo:      ${memo.contract}`);
line(`identity:  ${erc8004.identity}`);
line(`orderId:   ${orderId}`);
line(`budget:    ${fmt(BUDGET)}  fee: ${FEE_BPS} bps`);
line("");

await balances("before");
line("");

// ── step 0: ERC-8004 passport mirror (provider identity on Arc) ──────

line("── STEP 0 · ERC-8004 identity mirror (provider)");
const metadataURI = `https://agentbadge.xyz/api/passport/0.0.9681741:29.json`;
const mirror = await erc8004.registerMirror(providerWallet, metadataURI);
txs.push({ step: "erc8004 register", hash: mirror.txHash });
line(`   agentId=${mirror.agentId}  tx=${mirror.txHash}`);
line(`   ${txLink(mirror.txHash)}`);
line("");

// ── step 1: createJob (client) ───────────────────────────────────────

line("── STEP 1 · createJob (client → Open)");
const expiredAt = BigInt(Math.floor(Date.now() / 1000) + 3600);
const description = jobDescription(orderId, "agent-readiness report");
const job = await escrow.createJob(clientWallet, {
  provider: providerAcct.address,
  evaluator: providerAcct.address,
  expiredAt,
  description,
});
txs.push({ step: "createJob", hash: job.txHash });
line(`   jobId=${job.jobId}  tx=${job.txHash}`);
line(`   ${txLink(job.txHash)}`);
line(`   description: "${description}"`);
line("");

// ── step 2: setBudget (provider) ─────────────────────────────────────

line("── STEP 2 · setBudget (provider)");
const budgetTx = await escrow.setBudget(providerWallet, {
  jobId: job.jobId,
  amount: BUDGET,
});
txs.push({ step: "setBudget", hash: budgetTx });
line(`   budget=${fmt(BUDGET)}  tx=${budgetTx}`);
line(`   ${txLink(budgetTx)}`);
line("");

// ── step 3: approve + fund (client) ──────────────────────────────────

line("── STEP 3 · approve USDC + fund (client → Funded)");
const fund = await escrow.fundJob(clientWallet, {
  jobId: job.jobId,
  amount: BUDGET,
});
txs.push({ step: "approve", hash: fund.approveTx });
txs.push({ step: "fund", hash: fund.fundTx });
line(`   approve tx=${fund.approveTx}`);
line(`   fund    tx=${fund.fundTx}`);
line(`   ${txLink(fund.fundTx)}`);
await pub.waitForTransactionReceipt({ hash: fund.fundTx });
const afterFund = await escrow.getJob(job.jobId);
line(`   status=${afterFund.status}  escrow holds ${fmt(afterFund.budget)}`);
line("");

// ── step 4: submit deliverable (provider) ────────────────────────────

line("── STEP 4 · submit (provider → Submitted)");
const deliverable = `deliverable:${orderId}:agent-readiness:score=87:tier=gold`;
const deliverableHash = keccak256(toBytes(deliverable));
const submitTx = await escrow.submitResult(providerWallet, {
  jobId: job.jobId,
  deliverableHash,
});
txs.push({ step: "submit", hash: submitTx });
line(`   deliverableHash=${deliverableHash}`);
line(`   tx=${submitTx}`);
line(`   ${txLink(submitTx)}`);
await pub.waitForTransactionReceipt({ hash: submitTx });
line("");

// ── step 5: evaluate + settle via Memo (evaluator) ───────────────────

line("── STEP 5 · evaluate + complete via Memo (evaluator → Completed)");
const submitted = await escrow.getJob(job.jobId);
// Evaluator re-computes the deliverable hash from the delivered payload
// and checks the job reached Submitted state.
const recomputed = keccak256(toBytes(deliverable));
const pass = submitted.status === "Submitted" && recomputed === deliverableHash;
const reason = pass
  ? `deliverable verified: hash match ${deliverableHash.slice(0, 18)}…`
  : `verification failed: status=${submitted.status}`;
const reasonHash = keccak256(toBytes(reason));
line(`   verify: deliverable hash match → ${pass ? "PASS" : "FAIL"}`);
line(`   reasonHash=${reasonHash}`);

const feeAmount = splitPayout(BUDGET, FEE_BPS).feeAmount;
const settleTx = await memo.settleWithMemo(evaluatorWallet, {
  escrowContract: escrow.contract,
  jobId: job.jobId,
  reason: reasonHash,
  memo: {
    orderId,
    jobId: job.jobId,
    verdictRef: reasonHash,
    feeAmount,
  },
});
txs.push({ step: "complete+memo", hash: settleTx });
line(`   settle tx=${settleTx}  (complete() wrapped in Memo)`);
line(`   ${txLink(settleTx)}`);
const settleReceipt = await pub.waitForTransactionReceipt({ hash: settleTx });
const memoEvents = memo.parseMemoEvents(settleReceipt);
for (const ev of memoEvents) {
  line(`   ✓ Memo event: memoId=${ev.memoId} index=${ev.memoIndex}`);
}
line(`   memoId=${memoIdFor("agentbadge", "settle", orderId, job.jobId)}`);
line("");

// ── step 6: commission sweep (provider → treasury) ───────────────────

line("── STEP 6 · commission sweep (provider → treasury)");
const fee = await splitter.collectFee(providerWallet, {
  jobId: job.jobId,
  budget: BUDGET,
});
if (fee.feeTx) {
  txs.push({ step: "fee→treasury", hash: fee.feeTx });
  line(`   fee=${fmt(fee.feeAmount)} (${FEE_BPS} bps)  tx=${fee.feeTx}`);
  line(`   ${txLink(fee.feeTx)}`);
  await pub.waitForTransactionReceipt({ hash: fee.feeTx });
} else {
  line(`   fee=0 — nothing swept`);
}
line(`   provider keeps ${fmt(fee.providerAmount)}`);
line("");

// ── final ────────────────────────────────────────────────────────────

const finalJob = await escrow.getJob(job.jobId);
await balances("after");
line("");
line("── job final state");
line(`   jobId=${finalJob.id}  status=${finalJob.status}`);
line(`   client=${finalJob.client}`);
line(`   provider=${finalJob.provider}  evaluator=${finalJob.evaluator}`);
line("");
line("── tx summary");
for (const t of txs) line(`   ${t.step.padEnd(18)} ${t.hash}`);
line("");
line(`✓ arc commerce demo complete — job ${job.jobId} ${finalJob.status}`);
