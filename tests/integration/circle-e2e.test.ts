/**
 * SLICE-129-22: E2E opt-in suite — real testnets (D15).
 *
 * Gated on CIRCLE_E2E=1 — skipped in CI. Hits a RUNNING server with
 * circle payments enabled and performs real 402 negotiation.
 *
 * Prerequisites:
 *   - Server running with CIRCLE_PAYMENTS_ENABLED=true (+ gateway/arc/
 *     identity flags as needed)
 *   - Buyer wallet funded:
 *       Gateway flow: USDC deposited into GatewayWallet on the chain
 *       Arc flow:     Arc Testnet USDC (faucet.circle.com → Arc Testnet)
 *   - VPN on (Circle API geo-restrictions may apply)
 *
 * Env:
 *   CIRCLE_E2E=1              master gate
 *   E2E_TARGET_URL            server base (default http://localhost:4021)
 *   CIRCLE_E2E_BUYER_KEY      buyer private key 0x… (required)
 *   CIRCLE_E2E_CHAIN          gateway chain name (default "baseSepolia")
 *   CIRCLE_E2E_IDENTITY_ADDR  address to query (default: buyer address)
 *   CIRCLE_E2E_ARC=1          also run Arc self-settle flow (needs Arc USDC)
 *
 * Run:
 *   CIRCLE_E2E=1 CIRCLE_E2E_BUYER_KEY=0x… bunx vitest run tests/e2e/circle.test.ts
 */

import { describe, expect, it } from "vitest";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const E2E = process.env.CIRCLE_E2E === "1";
const ARC_E2E = process.env.CIRCLE_E2E_ARC === "1";
const BASE_URL = process.env.E2E_TARGET_URL ?? "http://localhost:4021";
const BUYER_KEY = process.env.CIRCLE_E2E_BUYER_KEY as Hex | undefined;
const GATEWAY_CHAIN = process.env.CIRCLE_E2E_CHAIN ?? "baseSepolia";

const ARC_RPC = "https://rpc.testnet.arc.network";
const ARC_CHAIN_ID = 5042002;
const ARC_USDC = "0x3600000000000000000000000000000000000000" as const;

const buyer = BUYER_KEY ? privateKeyToAccount(BUYER_KEY) : undefined;
const IDENTITY_ADDR =
  process.env.CIRCLE_E2E_IDENTITY_ADDR ?? buyer?.address ?? "";
const PAID_URL = `${BASE_URL}/api/identity/${IDENTITY_ADDR}`;

function decode402(res: Response) {
  const h = res.headers.get("PAYMENT-REQUIRED");
  expect(h).toBeTruthy();
  return JSON.parse(Buffer.from(h!, "base64").toString("utf-8"));
}

describe.skipIf(!E2E)("circle e2e (CIRCLE_E2E=1)", () => {
  it("unpaid → 402 with accepts[] + identity extension", async () => {
    const res = await fetch(PAID_URL);
    expect(res.status).toBe(402);
    const pr = decode402(res);
    expect(pr.accepts.length).toBeGreaterThan(0);
    for (const a of pr.accepts) {
      expect(a.payTo).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(a.amount).toBe("1000"); // $0.001
    }
    // identity extension present when flag on
    if (pr.extensions?.identity) {
      expect(pr.extensions.identity.verifyUrl).toContain("/api/identity/");
    }
  });

  it("wrong-network payment → rejected (still 402)", async () => {
    const res = await fetch(PAID_URL);
    const pr = decode402(res);
    const bogus = {
      x402Version: pr.x402Version ?? 2,
      resource: pr.resource,
      accepted: { ...pr.accepts[0], network: "eip155:1" },
      payload: { signature: "0xdeadbeef" },
    };
    const paid = await fetch(PAID_URL, {
      headers: {
        "Payment-Signature": Buffer.from(JSON.stringify(bogus)).toString(
          "base64",
        ),
      },
    });
    expect(paid.status).toBe(402);
  });

  it.skipIf(!BUYER_KEY)(
    "gateway batch payment → 200 + content",
    async () => {
      const { GatewayClient } = await import(
        "@circle-fin/x402-batching/client"
      );
      const gateway = new GatewayClient({
        chain: GATEWAY_CHAIN as never,
        privateKey: BUYER_KEY!,
      });
      const result = await gateway.pay(PAID_URL);
      expect(result.status).toBe(200);
      expect(result.amount).toBeGreaterThan(0n);
      expect(result.data).toBeTruthy();
    },
    120_000,
  );

  it.skipIf(!BUYER_KEY || !ARC_E2E)(
    "arc self-settle → EIP-3009 broadcast → 200",
    async () => {
      // 1. get 402, find eip3009-client-broadcast accept entry
      const res = await fetch(PAID_URL);
      const pr = decode402(res);
      const arcReq = pr.accepts.find(
        (a: { scheme: string }) => a.scheme === "eip3009-client-broadcast",
      );
      expect(arcReq).toBeTruthy();

      // 2. sign + broadcast transferWithAuthorization on Arc
      const account = buyer!;
      const wallet = createWalletClient({
        account,
        chain: {
          id: ARC_CHAIN_ID,
          name: "Arc Testnet",
          nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
          rpcUrls: { default: { http: [ARC_RPC] } },
        },
        transport: http(ARC_RPC),
      });
      const pub = createPublicClient({
        chain: wallet.chain,
        transport: http(ARC_RPC),
      });
      const nonce = `0x${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex")}` as Hex;
      const now = Math.floor(Date.now() / 1000);
      const signature = await account.signTypedData({
        domain: {
          name: "USDC",
          version: "2",
          chainId: ARC_CHAIN_ID,
          verifyingContract: ARC_USDC,
        },
        types: {
          TransferWithAuthorization: [
            { name: "from", type: "address" },
            { name: "to", type: "address" },
            { name: "value", type: "uint256" },
            { name: "validAfter", type: "uint256" },
            { name: "validBefore", type: "uint256" },
            { name: "nonce", type: "bytes32" },
          ],
        },
        primaryType: "TransferWithAuthorization",
        message: {
          from: account.address,
          to: arcReq.payTo as Hex,
          value: BigInt(arcReq.amount),
          validAfter: 0n,
          validBefore: BigInt(now + 3600),
          nonce,
        },
      });
      const r = signature.slice(2);
      const txHash = await wallet.writeContract({
        address: ARC_USDC,
        abi: parseAbi([
          "function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)",
        ]),
        functionName: "transferWithAuthorization",
        args: [
          account.address,
          arcReq.payTo as Hex,
          BigInt(arcReq.amount),
          0n,
          BigInt(now + 3600),
          nonce,
          parseInt(`0x${r.slice(128, 130)}`, 16),
          `0x${r.slice(0, 64)}` as Hex,
          `0x${r.slice(64, 128)}` as Hex,
        ],
      });
      await pub.waitForTransactionReceipt({ hash: txHash });

      // 3. retry with txHash payload
      const paid = await fetch(PAID_URL, {
        headers: {
          "Payment-Signature": Buffer.from(
            JSON.stringify({
              x402Version: pr.x402Version ?? 2,
              resource: pr.resource,
              accepted: arcReq,
              payload: { txHash },
            }),
          ).toString("base64"),
        },
      });
      expect(paid.status).toBe(200);
      expect(await paid.json()).toBeTruthy();
    },
    180_000,
  );
});
