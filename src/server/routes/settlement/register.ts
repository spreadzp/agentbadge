/**
 * EPIC-227 — settlement route registration + prod seam wiring.
 *
 * Extracted from routes/index.ts (20KB staged-file cap). Wires:
 *  - receipt signer from ARC_RECEIPT_SIGNER_KEY ?? ARC_OPS_KEY
 *    (task-receipt EOA family), bound to the resolved Arc chain id;
 *  - memo-anchor send seam when ARC_SETTLEMENT_MEMO_ANCHOR=1 — EOA
 *    send over the ops wallet targeting net.memo (self-anchor);
 *    absent → POST anchor still enqueues durable PENDING rows.
 */
import type { Hono } from "hono";

import { getConfig } from "../../../config/env";
import { getDatabase } from "../../lib/database";
import { logger } from "@agentbadge/passport/logger";
import { invariants } from "../../lib/settlement/index.js";
import {
  byCodePoint,
  milestoneVector,
} from "../../lib/settlement/services/plan-terms.js";
import {
  type MilestoneInput,
  fail,
} from "../../lib/settlement/types.js";
import { mkEoaSend } from "../../lib/eaas/anchor";
import { keyWallet, opsKey } from "../../lib/eaas/keys";
import { arcChainFor } from "../../lib/marketplace/chain";
import { createSettlementReceiptSigner } from "../../lib/settlement/receipt";
import {
  createViemPayoutVerifier,
  treasuryPayerFromEnv,
} from "../../lib/settlement/verify-payout-tx-viem";
import { publicClient, resolveVenueNetwork } from "../../lib/venue/chain";

import type { SettlementRouteDeps } from "./helpers";
import { createSettlementAdminRoutes } from "./settlement-admin";
import { createSettlementReceiptRoutes } from "./settlement-receipts";
import { createSettlementRoutes } from "./settlement";

export function registerSettlementRoutes(app: Hono): void {
  const deps: SettlementRouteDeps = {
    // C1 — a public plan must match the commerce agreement it names:
    // same parties, same total. Anything else is a 403/404 — the plan
    // is the payout contract, it can't be authored around commerce.
    verifyAgreement: async (req) => {
      // M-H: resolve the DB through the injected seam, not the global.
      const db = deps.getDb?.() ?? getDatabase();
      const a = await db.commerce.agreements.getById(req.agreementRef);
      if (!a) {
        return fail(
          "NOT_FOUND",
          `commerce agreement not found: ${req.agreementRef}`,
        );
      }
      // R2-H1 + nit: allowlist — only a LIVE agreement can grow a
      // payout contract.
      if (a.status !== "ACTIVE") {
        return fail(
          "FORBIDDEN",
          `commerce agreement ${req.agreementRef} is ${a.status}, not ACTIVE`,
        );
      }
      try {
        if (
          a.buyerWallet.toLowerCase() !== req.buyerWallet.toLowerCase() ||
          a.providerWallet.toLowerCase() !==
            req.providerWallet.toLowerCase() ||
          invariants.decimalToMicro(a.agreedAmount) !==
            invariants.decimalToMicro(req.totalUsd)
        ) {
          return fail(
            "FORBIDDEN",
            "plan terms do not match the commerce agreement",
          );
        }
      } catch {
        // M-H: a malformed stored amount can't equal the request —
        // typed failure, not a 500.
        return fail(
          "FORBIDDEN",
          "commerce agreement amount is unreadable",
        );
      }
      // R2-H1/M-5: the milestone/leg/policy vector is part of the
      // contract — canonical terms were snapshotted into the agreement
      // at accept (the offer row may have moved since); absent/empty →
      // the bridge's own "full"-amount default.
      const offered =
        a.payload && typeof a.payload === "object"
          ? (a.payload as Record<string, unknown>)["milestones"]
          : undefined;
      const canonical: MilestoneInput[] =
        Array.isArray(offered) && offered.length > 0
          ? (offered as MilestoneInput[]).slice()
          : [
              {
                milestoneId: "full",
                title: "Full delivery",
                amountUsd: a.agreedAmount,
              },
            ];
      const sort = (ms: MilestoneInput[]) =>
        ms.slice().sort((x, y) => byCodePoint(x.milestoneId, y.milestoneId));
      let same: boolean;
      try {
        same =
          milestoneVector(sort(req.milestones)) ===
          milestoneVector(sort(canonical));
      } catch {
        // M-7: provider-authored JSON can't throw a 500 — it's simply
        // not the canonical contract.
        return fail(
          "FORBIDDEN",
          "plan milestone terms do not match the offer",
        );
      }
      if (!same) {
        return fail(
          "FORBIDDEN",
          "plan milestone terms do not match the offer",
        );
      }
      return null;
    },
  };
  const evm = getConfig().evm;
  const receiptKey =
    process.env.ARC_RECEIPT_SIGNER_KEY ?? process.env.ARC_OPS_KEY;
  const net = resolveVenueNetwork();
  const chain = arcChainFor(
    getConfig().bstock?.arcNetwork ?? net.chain.caip2,
  );
  const chainId = chain?.id ?? evm?.chainId;
  // R3-H1: the chain pin must not depend on the receipt signer key —
  // chainId is known regardless.
  if (chainId) deps.chainId = chainId;
  if (receiptKey && chainId) {
    deps.signer = createSettlementReceiptSigner(receiptKey, chainId);
    if (process.env.ARC_SETTLEMENT_MEMO_ANCHOR === "1") {
      const ops = keyWallet(opsKey(), chain, net.chain.rpcUrl);
      if (ops.wallet && ops.account) {
        deps.anchorSend = mkEoaSend({
          wallet: ops.wallet,
          account: ops.account,
          read: publicClient(net),
          chain,
        });
        deps.memo = net.memo;
        deps.selfAddress = ops.account.address;
      }
    }
  }
  // R2-H2/R3-H1: admin routes must receive the same seam deps — an
  // unwired mount silently downgrades mark-paid to blind attestation.
  // The on-chain verifier is real: viem tx+receipt read, native USDC
  // transfer (Arc's gas token IS USDC) plus optional pinned ERC-20.
  const treasury = treasuryPayerFromEnv(
    process.env.ARC_SETTLEMENT_TREASURY_WALLET,
  );
  if (process.env.ARC_SETTLEMENT_TREASURY_WALLET && !treasury) {
    logger.error(
      "settlement: ARC_SETTLEMENT_TREASURY_WALLET is not a valid EVM address — payer pin disabled",
    );
  }
  deps.expectedPayer = treasury;
  const usdcPin = process.env.ARC_SETTLEMENT_USDC_TOKEN;
  const usdcPinValid = !usdcPin || /^0x[0-9a-fA-F]{40}$/.test(usdcPin);
  if (!usdcPinValid) {
    logger.error(
      "settlement: ARC_SETTLEMENT_USDC_TOKEN is not an EVM address — token pin disabled",
    );
  }
  deps.usdcToken =
    usdcPin && usdcPinValid ? usdcPin : undefined;
  deps.requireVerification =
    process.env.ARC_SETTLEMENT_REQUIRE_VERIFY === "1";
  if (!chainId) {
    // nit: a missing chain pin silently downgrades verification —
    // make the gap loud even when verification is not required.
    logger.warn(
      "settlement: no Arc chain id resolved — payout verification runs without a chain pin",
    );
  } else {
    const client = publicClient(net);
    deps.verifyTx = createViemPayoutVerifier(client, {
      networkLabel: "arc",
      chainId: String(chainId),
      usdcToken: deps.usdcToken as `0x${string}` | undefined,
    });
    // R4-M1: observe the RPC's real chain once at boot — the pin is a
    // tautology if the reported id only echoes config. The adapter
    // still compares per-call; this catches a divergent network
    // before the first payout rather than at it.
    void client
      .getChainId()
      .then((id) => {
        if (String(id) !== String(chainId)) {
          logger.error(
            `settlement: venue RPC serves chain ${id}, expected ${chainId} — payout verification will fail closed on every leg`,
          );
        }
      })
      .catch((e: unknown) => {
        logger.warn("settlement: startup chain-id probe failed", {
          error: e instanceof Error ? e.message : String(e),
        });
      });
  }
  // R3-H1/M-6: fail-closed means fail CLOSED — REQUIRE_VERIFY without a
  // working adapter or treasury pin would attest any same-amount
  // transfer to the payee. Misconfiguration is a startup failure, not
  // a warn.
  if (deps.requireVerification) {
    if (!deps.verifyTx) {
      throw new Error(
        "settlement: ARC_SETTLEMENT_REQUIRE_VERIFY=1 but no VerifyPayoutTx adapter could be built (chainId/RPC missing)",
      );
    }
    if (!deps.expectedPayer) {
      throw new Error(
        "settlement: ARC_SETTLEMENT_REQUIRE_VERIFY=1 requires ARC_SETTLEMENT_TREASURY_WALLET — without a payer pin any transfer to the payee satisfies a leg",
      );
    }
    if (!usdcPinValid) {
      throw new Error(
        "settlement: ARC_SETTLEMENT_REQUIRE_VERIFY=1 but ARC_SETTLEMENT_USDC_TOKEN is malformed — a configured-but-disabled pin would fail every ERC-20 leg",
      );
    }
  }
  app.route("/", createSettlementRoutes(deps)); // SLICE-227-3: /api/settlement/*
  app.route("/", createSettlementReceiptRoutes(deps)); // SLICE-227-4: receipts + anchor
  app.route("/", createSettlementAdminRoutes(deps)); // SLICE-227-3: /admin/settlement/*
}
