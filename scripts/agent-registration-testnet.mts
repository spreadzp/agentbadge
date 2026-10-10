/**
 * SLICE-184-8: self-serve registration e2e against **Arc testnet** (5042002).
 *
 * Boots the real server with testnet wiring (real mint — no stub), then
 * exercises the C20 flow: self-pay register, Bearer /me, sponsored
 * register (EIP-191 intent) + on-chain ownerOf/tokenURI verification.
 *
 *   bun scripts/agent-registration-testnet.mts
 *
 * Writes results JSON to ../../out/arc-studio/c20-testnet-run.json.
 */
import { spawn, type Subprocess } from "bun";
import {
  createPublicClient,
  http,
  getAddress,
  parseAbi,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const PORT = 4321;
const BASE = `http://127.0.0.1:${PORT}`;
const RPC = "https://rpc.testnet.arc.network";
const CHAIN_ID = 5042002;
const REGISTRY = "0x8004A818BFB912233c491871b3d84c89A494BD9e" as const;
const OUT = new URL("../../../out/arc-studio/c20-testnet-run.json", import.meta.url).pathname;

const log = (...a: unknown[]) => console.log("[tnet]", ...a);
const fail = (msg: string): never => { console.error("[tnet] FAIL:", msg); process.exit(1); };

let server: Subprocess | null = null;
async function waitReady(timeoutMs = 60_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(`${BASE}/api/v1/agents/register`, { method: "OPTIONS" });
      if (r.status < 500) return;
    } catch { /* not up yet */ }
    await Bun.sleep(500);
  }
  fail("server did not come up in 60s");
}

async function main() {
  // --- boot server with testnet env (bun auto-loads .env; we override) ---
  server = spawn({
    cmd: ["bun", "src/server/index.ts"],
    cwd: new URL("..", import.meta.url).pathname,
    env: {
      ...process.env,
      ARC_NETWORK: "testnet",
      AGENT_REGISTER_ENABLED: "true",
      REGISTER_SPONSORED: "true",
      AGENT_REGISTER_STORE: "memory",
      PORT: String(PORT),
      NODE_ENV: "test",
    },
    stdout: "ignore",
    stderr: "inherit",
  });
  process.on("exit", () => server?.kill());
  await waitReady();
  log("server up on", BASE);

  const pub = createPublicClient({ transport: http(RPC) });
  const regAbi = parseAbi([
    "function ownerOf(uint256) view returns (address)",
    "function tokenURI(uint256) view returns (string)",
  ]);
  const results: Record<string, unknown> = { chainId: CHAIN_ID, registry: REGISTRY };

  // --- 1) self-pay register ---
  const r1 = await fetch(`${BASE}/api/v1/agents/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: `tnet-selfpay-${Date.now()}` }),
  });
  const j1 = await r1.json() as Record<string, unknown>;
  if (r1.status !== 201) fail(`self-pay register → ${r1.status} ${JSON.stringify(j1)}`);
  results.selfPay = j1;
  log("self-pay 201:", j1.agent_id, "tx:", j1.registry_tx);

  const receipt1 = await pub.waitForTransactionReceipt({ hash: j1.registry_tx as Hex });
  if (receipt1.status !== "success") fail("self-pay mint tx reverted");
  results.selfPayTxStatus = receipt1.status;
  results.selfPayBlock = Number(receipt1.blockNumber);

  // --- 2) Bearer /me ---
  const me = await fetch(`${BASE}/api/v1/agents/me`, {
    headers: { authorization: `Bearer ${j1.api_key}` },
  });
  const meJ = await me.json() as Record<string, unknown>;
  if (me.status !== 200 || meJ.agent_id !== j1.agent_id)
    fail(`/me → ${me.status} ${JSON.stringify(meJ)}`);
  results.me = meJ;
  log("/me 200 for", meJ.agent_id);

  // --- 3) sponsored register (EIP-191 intent) ---
  const ownerKey = generatePrivateKey();
  const owner = privateKeyToAccount(ownerKey);
  const sname = `tnet-sponsored-${Date.now()}`;
  const expiresAt = Math.floor(Date.now() / 1000) + 300;
  const intent = [
    "agentbadge:register:v2",
    `eip155:${CHAIN_ID}`,
    REGISTRY.toLowerCase(),
    owner.address.toLowerCase(),
    sname,
    String(expiresAt),
  ].join("\n");
  const signature = await owner.signMessage({ message: intent });

  const r2 = await fetch(`${BASE}/api/v1/agents/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: sname, owner: owner.address, signature, expiresAt }),
  });
  const j2 = await r2.json() as Record<string, unknown>;
  if (r2.status !== 201) fail(`sponsored register → ${r2.status} ${JSON.stringify(j2)}`);
  results.sponsored = j2;
  log("sponsored 201:", j2.agent_id, "tx:", j2.registry_tx, "owner_tx:", j2.owner_tx);

  const tokenId = BigInt(String(j2.agent_id).split(":").pop()!);
  const onchainOwner = await pub.readContract({
    address: REGISTRY, abi: regAbi, functionName: "ownerOf", args: [tokenId],
  });
  if (getAddress(onchainOwner) !== getAddress(owner.address))
    fail(`ownerOf=${onchainOwner} != ${owner.address}`);
  results.sponsoredOwnerOk = true;
  log("ownerOf ✓", onchainOwner);

  const uri = await pub.readContract({
    address: REGISTRY, abi: regAbi, functionName: "tokenURI", args: [tokenId],
  });
  const meta = JSON.parse(Buffer.from(uri.split(",")[1], "base64").toString());
  if (meta.name !== sname) fail(`tokenURI name=${meta.name} != ${sname}`);
  results.sponsoredMetadata = meta;
  log("tokenURI ✓ name:", meta.name);

  // --- 4) negatives ---
  const bad = await fetch(`${BASE}/api/v1/agents/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: `tnet-bad-${Date.now()}`, owner: owner.address, signature: "0xdead" }),
  });
  if (bad.status === 201) fail("bad signature accepted!");
  results.badSignatureStatus = bad.status;
  log("bad signature →", bad.status, "✓");

  // --- persist ---
  const { mkdirSync, writeFileSync } = await import("node:fs");
  const { dirname } = await import("node:path");
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(results, null, 2));
  log("results →", OUT);
  console.log("\n=== TESTNET RUN GREEN ===");
  server.kill();
  process.exit(0);
}

main().catch((e) => { server?.kill(); fail(String(e?.message ?? e)); });
