/**
 * Attempt submission — POST /payments/:id/attempts backend
 * (EPIC-221, SLICE-221-2).
 *
 * Mirrors PaymentService.createPayment's attempt-side invariants:
 *  - provider resolved before ANY row write (H-3, no orphan attempts)
 *  - rail capability expectations bound at create (H-1/H-4)
 *  - only the rail call sits inside try — persistence errors propagate
 *  - C-1: rail NEVER returns CONFIRMED at create — clamp to PROCESSING
 *  - recipient/tokenContract bound at create from server config ONLY
 *
 * Design difference vs the service: on rail failure the attempt is
 * FAILED but the payment stays payable — a later attempt may retry a
 * different rail (spec's multi-attempt model; the atomic service fails
 * the payment outright because payment+attempt are one operation).
 */

import {
  applyAttemptTransition,
  attemptFromRow,
  driveAttemptTo,
  drivePaymentTo,
  expirePaymentRowIfDue,
  paymentFromRow,
  type Payment,
  type PaymentAttempt,
  type PaymentAttemptStatus,
  type PaymentProviderId,
  type PaymentProviderRegistry,
  type PaymentServiceStores,
  type PaymentStatus,
  type PersistedAttempt,
} from "@agentbadge/payments";

import { getCommerceProduct } from "../commerce-catalog";

import { CheckoutError } from "./errors";
import type { UsdcNetworks } from "./usdc-provider";

export interface AttemptDeps {
  stores: PaymentServiceStores;
  providers: PaymentProviderRegistry;
  usdcNetworks: UsdcNetworks;
  usdcInstructionsTtlSec: number;
  now: () => Date;
  newId: (prefix: string) => string;
}

export interface CreateAttemptInput {
  paymentId: string;
  provider: "STRIPE" | "DIRECT_USDC";
  /** Only meaningful for DIRECT_USDC — CAIP-2 tag of a configured network. */
  network?: string;
}

export interface CreateAttemptResult {
  attempt: PaymentAttempt;
  payment: Payment;
  providerMetadata?: Record<string, unknown>;
}

const ACTOR = "payments-api";
const PAYABLE_PAYMENT = new Set<string>(["PENDING", "PROCESSING"]);

export async function submitAttempt(
  deps: AttemptDeps,
  input: CreateAttemptInput,
): Promise<CreateAttemptResult> {
  const { stores } = deps;

  // Provider name validated first; the lookup reads come next (404 on a
  // missing payment beats a provider misconfig error). The provider
  // itself is resolved before ANY row write — H-3 preserved.
  if (input.provider !== "STRIPE" && input.provider !== "DIRECT_USDC") {
    throw new CheckoutError(
      "invalid_provider",
      400,
      `provider must be STRIPE or DIRECT_USDC, got ${input.provider}`,
    );
  }

  const raw = await stores.payments.getById(input.paymentId);
  if (!raw) {
    throw new CheckoutError(
      "payment_not_found",
      404,
      `payment not found: ${input.paymentId}`,
    );
  }
  // Lazy expiry before deciding — never bind a rail to a dead payment.
  const paymentRow = await expirePaymentRowIfDue(
    stores,
    raw,
    deps.now().getTime(),
    ACTOR,
  );
  if (!PAYABLE_PAYMENT.has(paymentRow.status)) {
    throw new CheckoutError(
      "payment_not_payable",
      409,
      `payment ${paymentRow.id} is ${paymentRow.status} — cannot attach an attempt`,
    );
  }

  let provider;
  try {
    provider = deps.providers.get(input.provider as PaymentProviderId);
  } catch {
    throw new CheckoutError(
      "provider_unavailable",
      503,
      `provider ${input.provider} is not configured on this server`,
    );
  }

  // Rail selection — network/recipient/token resolved here and only
  // here, from server config (spec invariant).
  const isUsdc = input.provider === "DIRECT_USDC";
  if (!isUsdc && input.network !== undefined) {
    throw new CheckoutError(
      "network_not_supported",
      400,
      "network applies to DIRECT_USDC only",
    );
  }
  let network: string | undefined;
  let recipient: string | undefined;
  let token: string | undefined;
  let expiresAt: Date | undefined;
  if (isUsdc) {
    network =
      input.network ??
      Object.keys(deps.usdcNetworks).find(
        (tag) => deps.usdcNetworks[tag].label === "arc",
      ) ??
      Object.keys(deps.usdcNetworks)[0];
    const cfg = network ? deps.usdcNetworks[network] : undefined;
    if (!cfg || !network) {
      throw new CheckoutError(
        "network_not_supported",
        400,
        `USDC network not configured: ${input.network ?? "<none>"}`,
        { available: Object.keys(deps.usdcNetworks) },
      );
    }
    recipient = cfg.recipient;
    token = cfg.tokenContract;
    expiresAt = new Date(
      deps.now().getTime() + deps.usdcInstructionsTtlSec * 1000,
    );
  }

  const productCode =
    typeof paymentRow.payload === "object" && paymentRow.payload !== null
      ? (paymentRow.payload as { productCode?: unknown }).productCode
      : undefined;
  const productName =
    typeof productCode === "string"
      ? getCommerceProduct(productCode)?.name
      : undefined;

  const currency = isUsdc ? "USDC" : "USD";
  let attemptRow: PersistedAttempt | null = await stores.attempts.create({
    id: deps.newId("att"),
    paymentId: paymentRow.id,
    provider: input.provider,
    network: network ?? null,
    token: token ?? null,
    amount: paymentRow.amount,
    currency,
    status: "CREATED",
    expiresAtMs: expiresAt?.getTime() ?? null,
    // H-4: verification expectations bound at create time.
    payload: {
      expectedRecipient: recipient ?? null,
      network: network ?? null,
      minConfirmations: null,
    },
  });
  if (!attemptRow) {
    throw new Error("attempt insert deduped on payable payment — impossible");
  }

  let rail;
  try {
    rail = await provider.createPayment({
      reference: paymentRow.reference,
      amount: paymentRow.amount,
      currency: currency as "USD" | "USDC",
      network,
      token,
      recipient,
      expiresAt,
      metadata: {
        paymentId: paymentRow.id,
        productCode: typeof productCode === "string" ? productCode : null,
        productName: productName ?? null,
      },
    });
  } catch (err) {
    const reason = `rail createPayment failed: ${
      err instanceof Error ? err.message.slice(0, 200) : String(err)
    }`;
    await applyAttemptTransition(stores, attemptRow, "FAILED", {
      actor: ACTOR,
      reason,
      at: deps.now(),
    });
    throw new CheckoutError("rail_error", 502, reason);
  }

  const at = deps.now();
  attemptRow =
    (await applyAttemptTransition(stores, attemptRow, "PENDING", {
      actor: ACTOR,
      at,
      patch: {
        providerReference: rail.providerReference,
        transactionHash: rail.evidence?.transactionHash ?? null,
        expiresAtMs:
          rail.expiresAt?.getTime() ?? attemptRow.expiresAtMs ?? null,
        payload: {
          ...(typeof attemptRow.payload === "object" &&
          attemptRow.payload !== null
            ? (attemptRow.payload as Record<string, unknown>)
            : {}),
          rail: rail.metadata ?? {},
        },
      },
    })) ?? attemptRow;

  // C-1: rail NEVER confirms at create — clamp to PROCESSING.
  const railStatus =
    rail.status === "CONFIRMED" ? "PROCESSING" : rail.status;
  if (railStatus !== "PENDING") {
    attemptRow =
      (await driveAttemptTo(
        stores,
        attemptRow,
        railStatus as PaymentAttemptStatus,
        { actor: ACTOR, at },
      )) ?? attemptRow;
  }

  const paymentTarget: PaymentStatus =
    railStatus === "FAILED" || railStatus === "EXPIRED"
      ? railStatus
      : "PROCESSING";
  const payRow = await drivePaymentTo(stores, paymentRow, paymentTarget, {
    actor: ACTOR,
    at,
  });

  return {
    attempt: attemptFromRow(attemptRow),
    payment: paymentFromRow(payRow ?? paymentRow),
    providerMetadata: rail.metadata,
  };
}
