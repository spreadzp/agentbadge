/**
 * SLICE-223-4: x402PaymentService — gateway facade over the settle seam.
 *
 * Owns price resolution, requirement building, seam invocation, usage
 * recording, and payer→agentId resolution. Never reimplements
 * verification or settlement — those stay inside x402-settle-seam.ts
 * (D-223-4). Identity/payer/price/recipient are server-side derived;
 * client-provided values never reach the UsageRecord.
 */

import type { Context } from "hono";
import type { PaymentRouter } from "@agentbadge/circle-payments";
import type {
  PaidResource,
  PaymentRequirements as GatewayPaymentRequirements,
  PriceResolution,
  PriceResolver,
  UsageRecordStorePort,
} from "@agentbadge/payments";
import { usdToUsdcAtomic } from "@agentbadge/payments";

import type { AgentWalletStore } from "../agent-wallet/registry.js";
import {
  createSettleSeam,
  type SettleSeamOptions,
  type SettleSeamResult,
} from "../x402-settle-seam.js";

export interface X402PaymentServiceDeps {
  router: PaymentRouter;
  /** Catalog-first resolver; may be absent → registry priceUsd used. */
  resolver?: PriceResolver;
  /** Payer-binding store (EPIC-155): wallet → agentId. */
  walletStore?: AgentWalletStore;
  /** UsageRecord persistence (223-1 port — memory or DB). */
  usageRecords?: UsageRecordStorePort;
  /** Treasury recipient for domain requirements. */
  recipient?: string;
  /** Seam factory — default atomic; two-phase/refunds via override. */
  createSeam?: (
    opts: SettleSeamOptions,
  ) => (c: Context) => Promise<SettleSeamResult | null>;
  /** Bazaar extension merge for PaymentRequired (D-223-8). */
  bazaarExtensionFor?: (
    resourceId: string,
  ) => Record<string, unknown> | undefined;
}

export interface X402PaymentService {
  /** Catalog-first price → fallback registry priceUsd. */
  resolvePrice(resource: PaidResource): Promise<PriceResolution>;
  /** Domain requirements for a resource at a resolved price. */
  buildRequirements(
    resource: PaidResource,
    resolved: PriceResolution,
  ): GatewayPaymentRequirements;
  /** USD price → USDC atomic via the router's advertised rails. */
  amountAtomicFor(resource: PaidResource, priceUsd: string): string;
  /** Delegated to the seam — returns result or null (seam stamped 402). */
  verifyAndSettle(
    c: Context,
    resource: PaidResource,
    amountAtomic: string,
  ): Promise<SettleSeamResult | null>;
  /** Deterministic per-request dedupe anchor. */
  requestIdFor(c: Context): string;
  /** Append-only usage write; null when store absent or duplicate. */
  recordUsage(input: {
    settleResult: SettleSeamResult;
    resource: PaidResource;
    requestId: string;
    agentId: string | null;
    paymentId?: string;
    payload?: unknown;
  }): Promise<import("@agentbadge/payments").PersistedUsageRecord | null>;
  /** wallet → agentId binding; null when unbound or store absent. */
  resolveAgentId(payerAddress: string): Promise<string | null>;
}

export function createX402PaymentService(
  deps: X402PaymentServiceDeps,
): X402PaymentService {
  const seamFactory = deps.createSeam ?? createSettleSeam;

  const resolvePrice: X402PaymentService["resolvePrice"] = async (
    resource,
  ) => {
    if (deps.resolver) {
      const r = await deps.resolver.resolve(resource);
      if (r) return r;
    }
    return {
      resourceId: resource.id,
      priceUsd: resource.priceUsd,
      source: "registry",
      resolvedAt: new Date(),
    };
  };

  const amountAtomicFor: X402PaymentService["amountAtomicFor"] = (
    resource,
    priceUsd,
  ) => usdToUsdcAtomic(priceUsd);

  const verifyAndSettle: X402PaymentService["verifyAndSettle"] = async (
    c,
    resource,
    amountAtomic,
  ) => {
    const seam = seamFactory({
      router: deps.router,
      amountAtomic: () => amountAtomic,
      description: resource.description,
      resourceUrl: c.req.url,
      ...(resource.bazaar && deps.bazaarExtensionFor
        ? { extensions: deps.bazaarExtensionFor(resource.id) }
        : {}),
    });
    return seam(c);
  };

  const recordUsage: X402PaymentService["recordUsage"] = async (input) => {
    const store = deps.usageRecords;
    if (!store) return null;
    const id = `ur_${crypto.randomUUID()}`;
    return store.append({
      id,
      paymentId:
        input.paymentId ?? input.settleResult.tx ?? input.requestId,
      agentId: input.agentId,
      resource: input.resource.id,
      requestId: input.requestId,
      amount: input.settleResult.amountAtomic,
      currency: input.resource.currency,
      network: input.resource.network,
      payerAddress: input.settleResult.payer,
      txHash: input.settleResult.tx ?? null,
      createdAtMs: Date.now(),
      payload: input.payload ?? {},
    });
  };

  const resolveAgentId: X402PaymentService["resolveAgentId"] = async (
    payerAddress,
  ) => {
    if (!deps.walletStore) return null;
    const rec = await deps.walletStore.get(payerAddress);
    return rec?.agentId ?? null;
  };

  const requestIdFor: X402PaymentService["requestIdFor"] = (c) =>
    c.req.header("x-request-id") ??
    c.req.header("idempotency-key") ??
    `req_${crypto.randomUUID()}`;

  return {
    resolvePrice,
    buildRequirements: (resource, resolved) => ({
      amount: amountAtomicFor(resource, resolved.priceUsd),
      currency: "USDC",
      network: resource.network,
      recipient: deps.recipient ?? "",
      description: resource.description,
      resourceId: resource.id,
    }),
    amountAtomicFor,
    verifyAndSettle,
    requestIdFor,
    recordUsage,
    resolveAgentId,
  };
}
