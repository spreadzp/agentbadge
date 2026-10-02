// EPIC-154, SLICE-154-2: EaaS verdict API wiring.
// Mounted after wireCirclePayments — reuses its runtime for x402
// pricing (paymentForPrice on env-driven "$x.xx" prices).
// Gated on ARC_EAAS_ENABLED + circle payments being actually wired
// (POST needs an x402 rail; GETs mount only when eaas is enabled).
//
// SLICE-154-3 adds external-job evaluation: POST /api/eaas/contracts
// (wallet-sig + ABI probe) + POST /api/eaas/jobs/evaluate (x402-gated,
// settles the allowlisted escrow via ARC_EVALUATOR_KEY, tag1=eaas-eval
// feedback through the memo wrapper). Mounted only when an evaluator
// key is configured — without it there is no settler EOA.

import { createWalletClient, http } from "viem";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Hono } from "hono";
import { logger } from "@agentbadge/passport";
import { createErc8183, MEMO_ABI } from "@agentbadge/circle-payments";
import { getConfig } from "../../config/env";
import { arcChainFor } from "../lib/marketplace/chain";
import { createVerdictSigner } from "../lib/eaas/verdict";
import { getVerdictStore } from "../lib/eaas/store";
import { POLICY_REGISTRY } from "../lib/eaas/policies";
import {
  createContractRegistry,
  createJsonContractStore,
} from "../lib/eaas/contracts";
import { createJsonEvalStore } from "../lib/eaas/eval";
import {
  createAnchorer,
  createJsonAnchorStore,
} from "../lib/eaas/anchor";
import { createEaasRoutes } from "../routes/eaas-api";
import { createEaasJobsRoutes } from "../routes/eaas-jobs-api";
import { createEaasBillingRoutes } from "../routes/eaas-billing-api";
import { checkAccess } from "../middleware/agent-auth";
import { resolveAccessPassMinter } from "../lib/access-pass-minter";
import {
  createJsonSubscriptionStore,
  type EaasQuotaDeps,
} from "../lib/eaas/subscription";
import { resolveVenueNetwork, publicClient } from "../lib/venue/chain";
import type { CirclePaymentsRuntime } from "../lib/circle-payments";

/** Evaluator/settler key — ARC_EVALUATOR_KEY, demo fallback DEPLOYER_PRIVATE_KEY. */
function evaluatorKey(): `0x${string}` | null {
  for (const env of ["ARC_EVALUATOR_KEY", "DEPLOYER_PRIVATE_KEY"]) {
    const k = process.env[env];
    if (k && /^0x[0-9a-fA-F]{64}$/.test(k)) return k as `0x${string}`;
  }
  return null;
}

export function wireEaas(
  app: Hono,
  deps: { circleRuntime?: CirclePaymentsRuntime },
): void {
  const cfg = getConfig().eaas;
  if (!cfg?.enabled) return;

  // bstock section optional — verdict chainId follows ARC network, default testnet.
  const chainId = arcChainFor(
    getConfig().bstock?.arcNetwork ?? "eip155:5042002",
  ).id;
  const signer = createVerdictSigner(cfg.signerKey, chainId);
  const store = getVerdictStore();

  if (!deps.circleRuntime) {
    // No payment rail → the paid POST would silently bypass billing.
    // Fail closed: mount nothing rather than expose free verdicts.
    logger.warn("EaaS enabled but circle payments disabled — verdict API NOT mounted");
    return;
  }

  // Chain pieces — needed by both the jobs evaluator and the anchorer.
  const key = evaluatorKey();
  const net = resolveVenueNetwork();
  const chain = arcChainFor(getConfig().bstock?.arcNetwork ?? net.chain.caip2);
  const read = publicClient(net);
  const account = key ? privateKeyToAccount(key) : null;
  const wallet =
    key && account
      ? createWalletClient({
        account,
        chain,
        transport: http(net.chain.rpcUrl),
      })
      : null;

  // ─── SLICE-154-4: onchain memo anchoring ───────────────────────
  let anchorer: ReturnType<typeof createAnchorer> | undefined;
  let anchorStore: ReturnType<typeof createJsonAnchorStore> | undefined;
  if (cfg.memoAnchor && wallet && account) {
    anchorStore = createJsonAnchorStore(".data/eaas-anchors.json");
    anchorer = createAnchorer({
      store: anchorStore,
      verdicts: store,
      memo: net.memo,
      selfAddress: account.address,
      send: async (tx) => {
        const txHash = await wallet!.sendTransaction({
          account: account!,
          to: tx.to,
          data: tx.data,
          chain,
        });
        const receipt = await read.waitForTransactionReceipt({ hash: txHash });
        if (receipt.status !== "success") {
          throw new Error("anchor tx reverted");
        }
        return { txHash, blockNumber: receipt.blockNumber };
      },
      retries: cfg.anchorRetries,
      backoffMs: 5_000,
    });
    anchorer.resumePending();
  } else if (cfg.memoAnchor) {
    logger.warn(
      "EaaS memo anchoring ON but no evaluator key — anchors disabled",
    );
  }

  // Public verify reads the memo by memoId: getLogs(Memo, memoId) → block time.
  const findAnchor = async (memoId: Hex) => {
    const logs = await read.getLogs({
      address: net.memo,
      event: MEMO_ABI[2],
      args: { memoId },
    });
    const log = logs[0];
    if (!log) return null;
    const block = await read
      .getBlock({ blockNumber: log.blockNumber })
      .catch(() => null);
    return {
      txHash: log.transactionHash,
      blockNumber: log.blockNumber,
      memoData: (log.args as unknown as { memo: Hex }).memo,
      ...(block ? { blockTime: Number(block.timestamp) } : {}),
    };
  };

  // ─── SLICE-154-5: billing tiers — CLASS_EAAS pass + quota store ─
  const subStore = createJsonSubscriptionStore();
  const quota: EaasQuotaDeps = {
    store: subStore,
    tiers: cfg.tierQuotas,
    hasAccess: checkAccess,
  };

  app.route(
    "/",
    createEaasRoutes({
      paymentForPrice: (price) => deps.circleRuntime!.paymentForPrice(price),
      verdictUsd: cfg.verdictUsd,
      scanUsd: cfg.scanUsd,
      maxBytes: cfg.maxBytes,
      rateRpm: cfg.rateRpm,
      signer,
      store,
      quota,
      ...(anchorer && anchorStore
        ? {
          anchor: {
            anchorer,
            store: anchorStore,
            find: findAnchor,
            explorerTx: net.explorerTx,
          },
        }
        : {}),
    }),
  );

  // ─── SLICE-154-3: external job evaluation ──────────────────────
  if (!key || !wallet || !account) {
    logger.warn(
      "EaaS jobs API NOT mounted — ARC_EVALUATOR_KEY/DEPLOYER_PRIVATE_KEY missing",
    );
  } else {

    const contracts = createContractRegistry({
      store: createJsonContractStore(".data/eaas-contracts.json"),
      read: read as never,
      chainId,
    });
    const evalStore = createJsonEvalStore(".data/eaas-eval-jobs.json");

    app.route(
      "/",
      createEaasJobsRoutes({
        contracts,
        evalStore,
        evalUsd: cfg.evalUsd,
        rateRpm: cfg.rateRpm,
        chainId,
        paymentForPrice: (price) => deps.circleRuntime!.paymentForPrice(price),
        quota,
        escrowFor: (rec) =>
          createErc8183({
            read: read as never,
            contract: rec.address,
            usdc: net.chain.usdc,
            ...(rec.variant ? { variant: rec.variant } : {}),
          }),
        wallet: wallet as never,
        settlerAddress: account.address,
        estimateGas: async (args) =>
          read.estimateContractGas({
            ...args,
            abi: args.abi as never,
          } as never),
        gasCap: cfg.gasCap,
        policy: POLICY_REGISTRY,
        signer,
        verdictStore: store,
        ...(anchorer ? { anchorer } : {}),
        reputation: {
          registry: net.reputationRegistry,
          memo: net.memo,
        },
        sendTx: async (tx) =>
          wallet.sendTransaction({
            account,
            to: tx.to,
            data: tx.data,
            chain,
          }),
        // agentId resolution is venue-store + ARC_EAAS_AGENTID_MAP env
        // ("0xwallet:agentId,…"); unresolved → feedback skipped.
        resolveAgentId: async (provider) => {
          const map = process.env.ARC_EAAS_AGENTID_MAP ?? "";
          for (const part of map.split(",")) {
            const [w, id] = part.split(":").map((s) => s.trim());
            if (w?.toLowerCase() === provider.toLowerCase() && id) {
              const n = BigInt(id);
              return Number.isSafeInteger(Number(n)) ? n : null;
            }
          }
          return null;
        },
      }),
    );
    logger.info("EaaS jobs API mounted", {
      evalUsd: cfg.evalUsd,
      gasCap: cfg.gasCap,
      settler: account.address,
      network: net.name,
    });
  }

  // Subscribe + status routes — tier prices keyed to the quota map;
  // custom tiers priced at the pro rate until they get their own env var.
  const tierPrices: Record<string, string> = {};
  for (const tier of Object.keys(cfg.tierQuotas)) {
    tierPrices[tier] = tier === "basic" ? cfg.tierBasicUsd : cfg.tierProUsd;
  }
  app.route(
    "/",
    createEaasBillingRoutes({
      tierPrices,
      tiers: cfg.tierQuotas,
      paymentForPrice: (price) => deps.circleRuntime!.paymentForPrice(price),
      minter: resolveAccessPassMinter(),
      store: subStore,
      rateRpm: cfg.rateRpm,
    }),
  );

  logger.info("EaaS verdict API mounted", {
    verdictUsd: cfg.verdictUsd,
    scanUsd: cfg.scanUsd,
    store: store.name,
    chainId,
    memoAnchor: cfg.memoAnchor && !!anchorer,
    tiers: Object.keys(cfg.tierQuotas),
  });
}
