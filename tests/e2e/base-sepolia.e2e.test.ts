/**
 * E2E Test: Base Sepolia full flow.
 *
 * SLICE-90-10: Verifies passport mint → DID resolve → signature verify →
 * USDC balance → escrow create/release on Base Sepolia testnet.
 *
 * Skips gracefully when CHAIN_MODE != base or BASE_OPERATOR_KEY not set.
 *
 * Run: bunx vitest run --run tests/e2e/base-sepolia.e2e.test.ts
 */

import { describe, it, expect, beforeAll } from "vitest";
import { ethers } from "ethers";
import { BaseChainAdapter } from "@agentgate-hedera/base-core";
import {
  isBaseE2EEnabled,
  getBaseTestConfig,
} from "./base-sepolia.config";

const shouldRun = isBaseE2EEnabled();

describe.skipIf(!shouldRun)("Base Sepolia E2E", () => {
  let adapter: BaseChainAdapter;
  let operatorAddress: string;
  let mintedTokenId: number;
  let mintedTokenAddress: string;
  let escrowId: string;
  let escrowTxHash: string;

  beforeAll(() => {
    const cfg = getBaseTestConfig();
    adapter = new BaseChainAdapter(cfg);
    operatorAddress = new ethers.Wallet(cfg.operatorKey).address;
  });

  // ── Step 1: Mint passport NFT ──────────────────────────────────────

  it("mints a passport NFT and receives tokenId", async () => {
    const cfg = getBaseTestConfig();
    const metadataUri = `ipfs://e2e-test-${Date.now()}`;
    const result = await adapter.mintPassport(cfg.passportNft, metadataUri);
    expect(result.tokenId).toBe(cfg.passportNft);
    expect(result.serial).toBeGreaterThan(0);
    mintedTokenId = result.serial;
    mintedTokenAddress = cfg.passportNft;
  }, 60000);

  // ── Step 2: Get passport info ──────────────────────────────────────

  it("retrieves passport info for minted NFT", async () => {
    const info = await adapter.getPassportInfo(mintedTokenAddress, mintedTokenId);
    expect(info).not.toBeNull();
    expect(info!.account_id).toBe(operatorAddress);
    expect(info!.deleted).toBe(false);
  }, 30000);

  // ── Step 3: Build DID ───────────────────────────────────────────────

  it("builds a valid DID for minted passport", () => {
    const did = adapter.buildDid(mintedTokenAddress, mintedTokenId);
    expect(did).toContain("did:eip155:84532:passport:");
    expect(did).toContain(mintedTokenAddress.toLowerCase());
    expect(did).toContain(String(mintedTokenId));
  });

  // ── Step 4: Resolve DID ─────────────────────────────────────────────

  it("resolves DID and returns correct owner", async () => {
    const did = adapter.buildDid(mintedTokenAddress, mintedTokenId);
    const owner = await adapter.resolveDid(did);
    expect(owner).not.toBeNull();
    expect(owner!.toLowerCase()).toBe(operatorAddress.toLowerCase());
  }, 30000);

  // ── Step 5: Verify ownership signature ──────────────────────────────

  it("verifies ownership signature successfully", async () => {
    const cfg = getBaseTestConfig();
    const did = adapter.buildDid(mintedTokenAddress, mintedTokenId);
    const wallet = new ethers.Wallet(cfg.operatorKey);
    const message = `e2e-test-${Date.now()}`;
    const signature = await wallet.signMessage(message);
    const valid = await adapter.verifyOwnershipSignature(did, signature, message);
    expect(valid).toBe(true);
  }, 30000);

  it("rejects invalid ownership signature", async () => {
    const did = adapter.buildDid(mintedTokenAddress, mintedTokenId);
    const fakeSignature = "0x" + "ab".repeat(65);
    const valid = await adapter.verifyOwnershipSignature(did, fakeSignature, "test");
    expect(valid).toBe(false);
  }, 30000);

  // ── Step 6: USDC balance ────────────────────────────────────────────

  it("gets USDC balance for operator address", async () => {
    const balance = await adapter.getBalance(operatorAddress);
    expect(balance).toBeGreaterThanOrEqual(0);
  }, 30000);

  // ── Step 7: Create escrow hold ──────────────────────────────────────

  it("creates escrow hold with USDC", async () => {
    const cfg = getBaseTestConfig();
    const recipient = ethers.Wallet.createRandom().address;
    const result = await adapter.createEscrowHold({
      from: operatorAddress,
      to: recipient,
      amount: BigInt(1000000), // 1 USDC
      tokenAddress: cfg.usdcAddress,
    });
    expect(result.escrowId).toBeTruthy();
    expect(result.txHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
    escrowId = result.escrowId;
    escrowTxHash = result.txHash!;
  }, 60000);

  // ── Step 8: Release escrow ──────────────────────────────────────────

  it("releases escrow to claimer", async () => {
    await adapter.releaseEscrow(escrowId);
  }, 60000);

  // ── Step 9: Verify transactions on Basescan ─────────────────────────

  it("escrow transaction is verifiable on Basescan", () => {
    const cfg = getBaseTestConfig();
    const url = adapter.explorer.tx(escrowTxHash);
    expect(url).toContain(cfg.explorerUrl);
    expect(url).toContain(escrowTxHash);
  });

  it("passport NFT is verifiable on Basescan", () => {
    const cfg = getBaseTestConfig();
    const url = adapter.explorer.nft(mintedTokenAddress, mintedTokenId);
    expect(url).toContain(cfg.explorerUrl);
    expect(url).toContain(mintedTokenAddress);
  });

  // ── Step 10: Cleanup ────────────────────────────────────────────────

  it("revokes minted passport (cleanup)", async () => {
    await adapter.revokePassport(mintedTokenAddress, mintedTokenId);
    const info = await adapter.getPassportInfo(mintedTokenAddress, mintedTokenId);
    expect(info).not.toBeNull();
    expect(info!.deleted).toBe(true);
  }, 60000);
});

describe.skipIf(shouldRun)("Base Sepolia E2E (skipped)", () => {
  it("skips when CHAIN_MODE != base or BASE_OPERATOR_KEY not set", () => {
    expect(isBaseE2EEnabled()).toBe(false);
  });
});
