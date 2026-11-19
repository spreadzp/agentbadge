/**
 * SLICE-227-4 (EPIC-227): static Settlement Receipt JSON Schema.
 *
 *   GET /.well-known/settlement-receipt.schema.json — schema v1 an
 *   external verifier fetches to validate a receipt body before
 *   verifyTypedData. Served from SETTLEMENT_RECEIPT_JSON_SCHEMA — the
 *   zod twin (SettlementReceiptSchemaV1) is contract-tested against
 *   built receipts so the two cannot drift.
 */
import { Hono } from "hono";
import { SETTLEMENT_RECEIPT_JSON_SCHEMA } from "../../lib/settlement/receipt-schema";

export const settlementReceiptSchemaRoutes = new Hono();

settlementReceiptSchemaRoutes.get(
  "/.well-known/settlement-receipt.schema.json",
  (c) => c.json(SETTLEMENT_RECEIPT_JSON_SCHEMA),
);
