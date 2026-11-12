/**
 * Payments API wiring (EPIC-221, SLICE-221-2).
 *
 * `getPaymentsCheckout()` — lazy singleton built from:
 *  - stores: getDatabase().payments — Postgres when DATABASE_ENABLED,
 *    in-memory otherwise (D-143 pattern)
 *  - providers: StripePaymentProvider when STRIPE_SECRET_KEY is set;
 *    DirectUsdcStubProvider when at least one USDC network is configured
 *  - networks/TTL: config.env payments section (server-side only)
 *
 * Tests inject their own checkout via `setPaymentsCheckoutForTests` or
 * by constructing PaymentsCheckout directly — the singleton is never
 * built in unit tests.
 */

import {
  PaymentProviderRegistry,
  StripePaymentProvider,
  type PaymentServiceStores,
  type StripeLikeClient,
  type StripeSessionLike,
} from "@agentbadge/payments";

import { getConfig } from "../../../config/env";
import { getDatabase } from "../database";
import { getStripeClient, isStripeConfigured } from "../stripe-client";

import { PaymentsCheckout } from "./checkout";
import { DirectUsdcStubProvider } from "./usdc-provider";

export { PaymentsCheckout, CheckoutError, multiplyUsdDecimal } from "./checkout";
export type {
  CheckoutErrorCode,
  CreateAttemptInput,
  CreateAttemptResult,
  CreatePaymentInput,
  CreatePaymentResult,
  PaymentsCheckoutDeps,
} from "./checkout";
export { DirectUsdcStubProvider } from "./usdc-provider";
export type { UsdcNetworks } from "./usdc-provider";

const BASE_URL = "https://agentbadge.xyz";

let instance: PaymentsCheckout | null = null;

/** SDK sessions may carry an expanded PaymentIntent object — the
 *  provider's structural contract wants the id string. */
function toSessionLike(s: unknown): StripeSessionLike {
  const session = s as StripeSessionLike & { payment_intent?: unknown };
  const pi = session.payment_intent;
  return {
    ...session,
    payment_intent:
      typeof pi === "string"
        ? pi
        : ((pi as { id?: string } | null | undefined)?.id ?? null),
  };
}

function toStripeLikeClient(client: {
  checkout: {
    sessions: {
      create: (params: never, opts?: never) => Promise<unknown>;
      retrieve: (id: string) => Promise<unknown>;
    };
  };
  refunds: { create: (p: never, opts?: never) => Promise<unknown> };
}): StripeLikeClient {
  return {
    checkout: {
      sessions: {
        create: async (params, options) =>
          toSessionLike(
            await client.checkout.sessions.create(
              params as never,
              options as never,
            ),
          ),
        retrieve: async (id) =>
          toSessionLike(await client.checkout.sessions.retrieve(id)),
      },
    },
    refunds: {
      create: (params, options) =>
        client.refunds.create(params as never, options as never) as Promise<{
          id: string;
        }>,
    },
  };
}

export function getPaymentsCheckout(): PaymentsCheckout {
  if (instance) return instance;
  const cfg = getConfig().payments;
  const registry = new PaymentProviderRegistry();

  if (isStripeConfigured()) {
    registry.register(
      new StripePaymentProvider({
        client: toStripeLikeClient(getStripeClient()),
        successUrl: `${BASE_URL}/checkout/success`,
        cancelUrl: `${BASE_URL}/checkout/cancel`,
      }),
    );
  }
  if (Object.keys(cfg.usdcNetworks).length > 0) {
    registry.register(
      new DirectUsdcStubProvider({ networks: cfg.usdcNetworks }),
    );
  }

  instance = new PaymentsCheckout({
    stores: getDatabase().payments as unknown as PaymentServiceStores,
    providers: registry,
    usdcNetworks: cfg.usdcNetworks,
    usdcInstructionsTtlSec: cfg.usdcInstructionsTtlSec,
  });
  return instance;
}

/** Test hook — inject or clear the singleton between tests. */
export function setPaymentsCheckoutForTests(
  svc: PaymentsCheckout | null,
): void {
  instance = svc;
}
