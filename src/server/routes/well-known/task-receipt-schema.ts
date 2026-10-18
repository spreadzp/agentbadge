/**
 * SLICE-201-2 (EPIC-201): static Task Receipt JSON Schema.
 *
 *   GET /.well-known/task-receipt.schema.json — schema v1 an external
 *   verifier fetches to validate a receipt body before verifyTypedData.
 *   Served from TASK_RECEIPT_JSON_SCHEMA — the zod twin (ReceiptSchemaV1) is
 *   contract-tested against built receipts so the two cannot drift.
 */
import { Hono } from "hono";
import { TASK_RECEIPT_JSON_SCHEMA } from "../../lib/board/task-receipt-schema";

export const taskReceiptSchemaRoutes = new Hono();

taskReceiptSchemaRoutes.get("/.well-known/task-receipt.schema.json", (c) =>
  c.json(TASK_RECEIPT_JSON_SCHEMA),
);
