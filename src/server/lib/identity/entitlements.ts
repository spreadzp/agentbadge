/**
 * SLICE-225-2 (EPIC-225): entitlement service — the grant layer
 * (D-225-2). Activations derive from VERIFIED/CONFIRMED purchases
 * (via the sweeper) or explicit ops grants; ServicePass stays the
 * enforcement surface and reads `check()`.
 *
 * Invariants:
 * - exactly one ACTIVE row per (ownerId, productCode) — the store's
 *   activeSlot unique key; `grant` is idempotent: repeat activation
 *   for the same pair returns the existing row with `deduped: true`
 * - `idempotencyKey` is required (8-128, contract guard) — derived
 *   as `sourcePaymentId|productCode` for purchase activations
 * - `check()` honors validUntil: an ACTIVE row past its deadline is
 *   lazily transitioned to EXPIRED and no longer answers
 * - sourcePaymentId provenance: the sweeper only grants from
 *   CONFIRMED payments (invariant; the store can't prove it)
 */
import type { EntitlementRow, EntitlementStore } from "@agentbadge/database";
import type { JsonValue } from "@prisma/orm-postgres/target/codec-types";

import { newId } from "../commerce/guards";
import {
  assertIdempotencyKey,
  assertNonEmpty,
  assertWallet,
} from "./guards";
import {
  conflict,
  entitlementCatalogEntry,
  invalid,
  notFound,
} from "./types";

export interface GrantInput {
  ownerId: string;
  /** Must be in ENTITLEMENT_PRODUCTS — catalog codes only. */
  productCode: string;
  /** → Payment.id — CONFIRMED payments only (domain invariant). */
  sourcePaymentId?: string | null;
  validFromMs?: number;
  validUntilMs?: number | null;
  /** Explicit dedupe key; defaults to `sourcePaymentId|productCode`
   *  for purchase activations. Manual grants must pass one. */
  idempotencyKey?: string;
  payload?: JsonValue;
}

export interface GrantResult {
  row: EntitlementRow;
  /** true when the grant already existed (idempotent replay). */
  deduped: boolean;
}

export interface EntitlementService {
  grant(input: GrantInput): Promise<GrantResult>;
  /** ACTIVE → EXPIRED (manual; the sweeper also expires in bulk). */
  expire(id: string): Promise<EntitlementRow>;
  /** ACTIVE → REVOKED (ops action). */
  revoke(id: string): Promise<EntitlementRow>;
  /**
   * The enforcement read (D-225-6): ACTIVE row for (wallet, code)
   * honoring validUntil — returns null when absent or expired
   * (expired rows are lazily transitioned, so repeated checks stay
   * cheap and the sweeper's expiry feed shrinks).
   */
  check(wallet: string, productCode: string): Promise<EntitlementRow | null>;
  getById(id: string): Promise<EntitlementRow | null>;
  listByOwner(
    ownerId: string,
    opts?: { status?: string; productCode?: string; limit?: number },
  ): Promise<EntitlementRow[]>;
  /** Bulk expiry — transitions every overdue ACTIVE row; returns
   *  the transitioned rows (sweeper feed). */
  expireOverdue(nowMs?: number): Promise<EntitlementRow[]>;
  /** ACTIVE rows that carry a source payment — the sweeper's
   *  reversal feed (audit H-5: refund/chargeback ⇒ revoke). */
  listActiveWithSource(limit?: number): Promise<EntitlementRow[]>;
}

export interface EntitlementServiceDeps {
  nowMs?: () => number;
}

export function createEntitlementService(
  entitlements: EntitlementStore,
  deps: EntitlementServiceDeps = {},
): EntitlementService {
  const now = deps.nowMs ?? Date.now;

  async function grant(input: GrantInput): Promise<GrantResult> {
    const ownerId = assertWallet(input.ownerId, "ownerId");
    const productCode = assertNonEmpty(input.productCode, "productCode");
    const catalog = entitlementCatalogEntry(productCode);
    if (!catalog) {
      throw invalid(
        `productCode ${productCode} is not entitlement-eligible`,
        { field: "productCode" },
      );
    }
    const key =
      input.idempotencyKey ??
      (input.sourcePaymentId
        ? `${input.sourcePaymentId}|${productCode}`
        : undefined);
    if (key === undefined) {
      throw invalid(
        "idempotencyKey required when sourcePaymentId is absent",
        { field: "idempotencyKey" },
      );
    }
    assertIdempotencyKey(key);

    // Idempotent replay — dedupe key first (exact re-emit), then the
    // ACTIVE slot (a second purchase for the same product does NOT
    // stack — spec: one ACTIVE per pair). The key binds to
    // (ownerId, productCode) (audit M-2): a hit for a different pair
    // is a collision, not a replay.
    const byKey = await entitlements.getByIdempotencyKey(key);
    if (byKey) {
      if (byKey.ownerId !== ownerId || byKey.productCode !== productCode) {
        throw conflict(
          "idempotencyKey collision — bound to a different (ownerId, productCode)",
          { ownerId, productCode, idempotencyKey: key },
        );
      }
      return { row: byKey, deduped: true };
    }
    const active = await entitlements.getActive(ownerId, productCode);
    if (active) return { row: active, deduped: true };

    const validFromMs = input.validFromMs ?? now();
    const validUntilMs =
      input.validUntilMs !== undefined
        ? input.validUntilMs
        : catalog.validityMs !== undefined
          ? validFromMs + catalog.validityMs
          : null;
    const row = await entitlements.grant({
      id: newId("ent"),
      ownerId,
      productCode,
      sourcePaymentId: input.sourcePaymentId ?? null,
      status: "ACTIVE",
      validFromMs,
      validUntilMs,
      idempotencyKey: key,
      payload: input.payload ?? {},
    });
    if (!row) {
      // Lost a race — the winner's row is authoritative.
      const winner =
        (await entitlements.getByIdempotencyKey(key)) ??
        (await entitlements.getActive(ownerId, productCode));
      if (winner) return { row: winner, deduped: true };
      throw conflict("entitlement grant lost a write race", {
        ownerId,
        productCode,
      });
    }
    return { row, deduped: false };
  }

  async function applyGuarded(
    id: string,
    to: "EXPIRED" | "REVOKED",
  ): Promise<EntitlementRow> {
    const idNorm = assertNonEmpty(id, "id");
    const existing = await entitlements.getById(idNorm);
    if (!existing) throw notFound("entitlement", idNorm);
    const row = await entitlements.applyStatus(idNorm, "ACTIVE", to);
    if (!row) {
      throw conflict(
        `entitlement ${idNorm} is ${existing.status} — only ACTIVE → ${to}`,
        { id: idNorm, status: existing.status },
      );
    }
    return row;
  }

  return {
    grant,

    expire: (id) => applyGuarded(id, "EXPIRED"),
    revoke: (id) => applyGuarded(id, "REVOKED"),

    async check(wallet, productCode) {
      const ownerId = assertWallet(wallet, "wallet");
      const code = assertNonEmpty(productCode, "productCode");
      const row = await entitlements.getActive(ownerId, code);
      if (!row) return null;
      // Future-dated grants are not honored yet (audit nit).
      if (row.validFromMs > now()) return null;
      if (row.validUntilMs != null && row.validUntilMs <= now()) {
        // Lazy expiry — keeps check() honest without waiting for the
        // sweeper tick (D-225-4 poll cadence).
        const transitioned = await entitlements.applyStatus(
          row.id,
          "ACTIVE",
          "EXPIRED",
        );
        if (transitioned) return null;
        // lost the race — re-read once
        const fresh = await entitlements.getById(row.id);
        return fresh?.status === "ACTIVE" ? fresh : null;
      }
      return row;
    },

    async getById(id) {
      return entitlements.getById(assertNonEmpty(id, "id"));
    },

    async listByOwner(ownerId, opts) {
      return entitlements.listByOwner(
        assertWallet(ownerId, "ownerId"),
        opts,
      );
    },

    async expireOverdue(nowMs) {
      const at = nowMs ?? now();
      const due = await entitlements.listExpiring(at);
      const out: EntitlementRow[] = [];
      for (const row of due) {
        const moved = await entitlements.applyStatus(
          row.id,
          "ACTIVE",
          "EXPIRED",
        );
        if (moved) out.push(moved);
      }
      return out;
    },

    listActiveWithSource: (limit) =>
      entitlements.listActiveWithSource(limit),
  };
}
