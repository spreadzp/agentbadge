// SLICE-151-3 live verify: real POST /api/attestations → real txs on Arc testnet.
import { readFileSync } from "node:fs";
import { Hono } from "hono";
import {
  createPublicClient, createWalletClient, http, keccak256, toBytes, parseUnits,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  attestationRoutes, setAttestationRouteConfig,
} from "../src/server/routes/attestation-api";
import { createArcAttestationWriter } from "../src/server/lib/arc-attestation";
import { createVenueStore } from "../src/server/lib/attestation-store";
import { ARC_CONTRACTS } from "@agentbadge/circle-payments";

const RPC = "https://rpc.blockdaemon.testnet.arc.network";
const CHAIN_ID = 5042002;
const chain = {
  id: CHAIN_ID, name: "arc-testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
} as const;

// operator key from .env.deployer
const env = readFileSync(
  ".env.deployer", "utf8");
const opPk = env.match(/DEPLOYER_PRIVATE_KEY=["']?([0-9a-fA-Fx]+)/)?.[1];
if (!opPk) throw new Error("DEPLOYER_PRIVATE_KEY missing");
const pub = createPublicClient({ chain, transport: http() });
const operator = createWalletClient({
  account: privateKeyToAccount((opPk.startsWith("0x") ? opPk : `0x${opPk}`) as `0x${string}`),
  chain, transport: http(),
});

// fresh evaluator EOA + gas top-up (must differ from agent owner)
const evaluatorKey = generatePrivateKey();
const evaluatorAddr = privateKeyToAccount(evaluatorKey).address;
const gasTx = await operator.sendTransaction({
  to: evaluatorAddr, value: parseUnits("0.4", 18),
});
await pub.waitForTransactionReceipt({ hash: gasTx });
console.log("evaluator funded:", evaluatorAddr, gasTx);

const writer = createArcAttestationWriter({
  chainId: CHAIN_ID,
  rpcUrl: RPC,
  evaluatorKey,
  oracleAgentId: 896908n, // operator-owned agent from smoke run
  usdc: "0x3600000000000000000000000000000000000000",
  identityRegistry: ARC_CONTRACTS.identityRegistry,
  reputationRegistry: ARC_CONTRACTS.reputationRegistry,
  memoContract: ARC_CONTRACTS.memo,
});

const store = createVenueStore();
setAttestationRouteConfig({
  network: "eip155:5042002",
  explorerUrl: "https://explorer.testnet.arc.io",
  scan: async (url) => ({
    score: 87,
    status: "ready",
    reportHash: keccak256(toBytes(`live-attest-${url}-${Date.now()}`)),
  }),
  writeAttestation: writer.write,
  store,
});

const app = new Hono();
app.route("/", attestationRoutes);

const res = await app.request("/api/attestations", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ url: "https://example.com" }),
});
console.log("POST status:", res.status);
console.log(JSON.stringify(await res.json(), null, 2));

const list = await app.request("/api/attestations");
console.log("GET /api/attestations:", list.status, (await list.json()).count, "entries");

const page = await app.request("/attestations");
const html = await page.text();
console.log("GET /attestations:", page.status, "| has entry:", html.includes("example.com"), "| has tx link:", html.includes("explorer.testnet.arc.io/tx/"));
console.log("EVALUATOR_KEY=" + evaluatorKey);
