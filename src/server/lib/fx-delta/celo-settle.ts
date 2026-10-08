/**
 * Celo x402 self-settle facilitator (EPIC-191, SLICE-191-6, D-191-1/8/9).
 *
 * Unlike arc-self-settle (client broadcasts, we verify the receipt) here
 * WE submit `transferWithAuthorization` — every settle is OUR tagged tx
 * (ERC-8021 suffix → loops.house leaderboard attribution).
 *
 * Flow: PAYMENT-SIGNATURE → verify EIP-3009 authorization (asset allowlist,
 * payTo, window, EIP-712 sig per-asset domain) → nonce claim (replay) →
 * submit tagged tx → wait receipt → serve.
 *
 * X402_MODE=facilitator falls back to api.x402.celo.org (no tag — we
 * don't submit in that mode; difference recorded in decisions.md).
 *
 * Constants/parsers live in ./celo-assets.ts.
 */

import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  concat,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo, celoSepolia } from "viem/chains";
import { Attribution } from "ox/erc8021";
import { logger } from "@agentbadge/passport";
import { auditFxDeltaPayment } from "./index";
import type {
  BstockFacilitator,
  BstockPaymentRequirements,
} from "../../middleware/bstock-freemium";
import {
  TWITH_AUTH_ABI,
  assetByAddress,
  checkAuthorization,
  decodePaymentHeader,
  extractAuth,
  remoteFacilitatorCall,
  InMemoryNonceStore,
  type NonceStore,
} from "./celo-assets";

export {
  CELO_X402_ASSETS,
  CELO_X402_NETWORK,
  CELO_X402_SCHEME,
} from "./celo-assets";

export interface CeloSettleConfig {
  /** Our seller address — payTo (we submit settle txs too). */
  sellerAddress: `0x${string}`;
  /** Self-settle submitter key (mode=self). */
  privateKey?: `0x${string}`;
  /** ERC-8021 attribution code appended to every settle calldata. */
  attributionCode?: string;
  /** Celo RPC (default forno mainnet / sepolia by network). */
  rpcUrl?: string;
  /** eip155 chain id — 42220 mainnet, 11142220 sepolia. */
  chainId?: number;
  /** self (default, tagged) | facilitator (api.x402.celo.org). */
  mode?: "self" | "facilitator";
  facilitatorUrl?: string;
  facilitatorApiKey?: string;
  nonceStore?: NonceStore;
  /** Injectable for tests. */
  publicClient?: {
    verifyTypedData(args: unknown): Promise<boolean>;
    waitForTransactionReceipt(args: {
      hash: `0x${string}`;
    }): Promise<{ status: string }>;
  };
  walletClient?: {
    sendTransaction(args: {
      to: `0x${string}`;
      data: Hex;
    }): Promise<`0x${string}`>;
  };
  fetcher?: typeof fetch;
  now?: () => number;
}

// Env-driven singleton lives in ./facilitator-env.ts (file cap).

export function createCeloX402Facilitator(
  cfg: CeloSettleConfig,
): BstockFacilitator {
  const chainId = cfg.chainId ?? 42220;
  const chain = chainId === 42220 ? celo : celoSepolia;
  const rpcUrl = cfg.rpcUrl ?? "https://forno.celo.org";
  const mode = cfg.mode ?? "self";
  const nonces = cfg.nonceStore ?? new InMemoryNonceStore();
  const now = cfg.now ?? Date.now;
  const fetcher = cfg.fetcher ?? fetch;

  const publicClient =
    cfg.publicClient ??
    (createPublicClient({ chain, transport: http(rpcUrl) }) as never);

  const walletClient =
    cfg.walletClient ??
    (cfg.privateKey
      ? createWalletClient({
          account: privateKeyToAccount(cfg.privateKey),
          chain,
          transport: http(rpcUrl),
        })
      : undefined);

  const tagSuffix: Hex | undefined = cfg.attributionCode
    ? (Attribution.toDataSuffix({
        codes: [cfg.attributionCode],
      }) as Hex)
    : undefined;

  /** Static checks + signature — returns payer or reason. No nonce claim. */
  const checkAuth = (
    requirements: BstockPaymentRequirements,
    paymentHeader: string,
  ) =>
    checkAuthorization(
      decodePaymentHeader(paymentHeader),
      requirements,
      publicClient,
      chainId,
      Math.floor(now() / 1000),
    );

  /** Remote facilitator fallback (D-191-1): verify+settle via
   *  api.x402.celo.org — no tag on settle tx (facilitator submits). */
  const remoteCall = (
    path: "verify" | "settle",
    paymentHeader: string,
    requirements: BstockPaymentRequirements,
  ) =>
    remoteFacilitatorCall(
      cfg.facilitatorUrl ?? "https://api.x402.celo.org",
      path,
      paymentHeader,
      requirements,
      cfg.facilitatorApiKey,
      fetcher,
    );

  return {
    async peekPayer(paymentHeader) {
      const decoded = decodePaymentHeader(paymentHeader);
      const ex = decoded && extractAuth(decoded);
      return ex?.auth.from.toLowerCase();
    },

    async verify(paymentHeader, requirements) {
      if (mode === "facilitator") {
        try {
          const r = await remoteCall("verify", paymentHeader, requirements);
          return {
            valid: r.isValid === true,
            error: r.invalidReason as string | undefined,
            payer: r.payer as string | undefined,
          };
        } catch (err) {
          return { valid: false, error: `facilitator: ${(err as Error).message}` };
        }
      }
      const chk = await checkAuth(requirements, paymentHeader);
      if (!chk.ok) return { valid: false, error: chk.reason };
      // Replay: nonce is single-use per (asset, payer). Claim at verify
      // so a doubled request never reaches settle.
      const nonceKey = `${requirements.asset}:${chk.payer}:${chk.auth.nonce}`;
      if (!(await nonces.claim(nonceKey))) {
        return { valid: false, error: "nonce_replayed" };
      }
      return { valid: true, payer: chk.payer };
    },

    async settle(paymentHeader, requirements) {
      if (mode === "facilitator") {
        try {
          const r = await remoteCall("settle", paymentHeader, requirements);
          return {
            success: r.success === true,
            transaction: r.transaction as string | undefined,
            payer: r.payer as string | undefined,
            error: r.errorReason as string | undefined,
          };
        } catch (err) {
          return { success: false, error: `facilitator: ${(err as Error).message}` };
        }
      }

      const decoded = decodePaymentHeader(paymentHeader);
      const ex = decoded && extractAuth(decoded);
      if (!decoded || !ex) {
        return { success: false, error: "bad_payment_header" };
      }
      if (!walletClient) {
        return {
          success: false,
          error: "self_settle_unconfigured: SELLER_PRIVATE_KEY missing",
        };
      }
      const { auth, signature } = ex;
      // Gate (191-0): every settle tx carries the ERC-8021 tag —
      // refuse to submit untagged.
      if (!tagSuffix) {
        return {
          success: false,
          error: "attribution_code_missing: settle tx must carry ERC-8021 tag",
        };
      }
      const asset = assetByAddress(requirements.asset);
      if (!asset) {
        return { success: false, error: "asset_not_accepted" };
      }
      // Split sig → v/r/s
      const sig = signature.slice(2);
      const rr = `0x${sig.slice(0, 64)}` as Hex;
      const ss = `0x${sig.slice(64, 128)}` as Hex;
      const vv = parseInt(sig.slice(128, 130), 16);

      try {
        const data = encodeFunctionData({
          abi: TWITH_AUTH_ABI,
          functionName: "transferWithAuthorization",
          args: [
            auth.from as `0x${string}`,
            auth.to as `0x${string}`,
            BigInt(auth.value),
            BigInt(auth.validAfter),
            BigInt(auth.validBefore),
            auth.nonce as `0x${string}`,
            vv,
            rr,
            ss,
          ],
        });
        const txHash = await walletClient.sendTransaction({
          to: asset.address as `0x${string}`,
          data: concat([data, tagSuffix]),
        });
        const receipt = await publicClient.waitForTransactionReceipt({
          hash: txHash,
        });
        if (receipt.status !== "success") {
          return { success: false, transaction: txHash, error: "tx_reverted" };
        }
        auditFxDeltaPayment({
          txHash,
          payer: auth.from,
          amount: requirements.amount,
          asset: requirements.asset,
          network: requirements.network,
          mode,
        });
        return { success: true, transaction: txHash, payer: auth.from.toLowerCase() };
      } catch (err) {
        logger.error("fxdelta self-settle failed", {
          err: (err as Error).message,
        });
        return { success: false, error: `settle_failed: ${(err as Error).message}` };
      }
    },
  };
}
