/**
 * SLICE-201-2 (EPIC-201): Task Receipt public schema v1 — the JSON shape
 * served by `GET /.well-known/task-receipt.schema.json` and validated here in
 * zod so the endpoint and the static schema cannot drift apart (drift test in
 * board-receipt.test.ts asserts a built receipt parses against it).
 */
import { z } from "zod";
import { PaymentLegSchema } from "./task-model";

const HEX32 = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const SIG = /^0x[0-9a-fA-F]{130}$/;

/** Public receipt shape (everything except the internal `body` message). */
export const ReceiptSchemaV1 = z.object({
  schema: z.literal("agentbadge/task-receipt@1"),
  agent: z.object({
    agentRegistry: z.string().regex(ADDRESS),
    agentId: z.string().nullable(),
    passportId: z.string().nullable(),
  }),
  task: z.object({
    id: z.string().min(1),
    bountyId: z.string().min(1),
    title: z.string().min(1),
    specHash: z.string().regex(HEX32),
    spec: z.string(),
    status: z.literal("done"),
    attempt: z.number().int().positive(),
    executorPassportId: z.string().nullable(),
    createdAt: z.string().regex(ISO),
    completedAt: z.string().regex(ISO),
  }),
  evidence: z.object({
    txHashes: z.array(z.string().regex(HEX32)),
    verdictId: z.string().regex(HEX32).optional(),
    deliverableHash: z.string().regex(HEX32).optional(),
  }),
  payment: PaymentLegSchema.extend({
    from: z.string().regex(ADDRESS),
    to: z.string().regex(ADDRESS),
  }).optional(),
  signer: z.string().regex(ADDRESS),
  chainId: z.number().int().positive(),
  issuedAt: z.string().regex(ISO),
  signature: z.string().regex(SIG),
});
export type ReceiptV1 = z.infer<typeof ReceiptSchemaV1>;

/** Static JSON Schema served at /.well-known/task-receipt.schema.json. */
export const TASK_RECEIPT_JSON_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://agentbadge.xyz/.well-known/task-receipt.schema.json",
  title: "AgentBadge Task Receipt v1",
  type: "object",
  required: [
    "schema",
    "agent",
    "task",
    "evidence",
    "signer",
    "chainId",
    "issuedAt",
    "signature",
  ],
  properties: {
    schema: { const: "agentbadge/task-receipt@1" },
    agent: {
      type: "object",
      required: ["agentRegistry", "agentId", "passportId"],
      properties: {
        agentRegistry: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" },
        agentId: { type: ["string", "null"] },
        passportId: { type: ["string", "null"] },
      },
    },
    task: {
      type: "object",
      required: [
        "id",
        "bountyId",
        "title",
        "specHash",
        "spec",
        "status",
        "attempt",
        "executorPassportId",
        "createdAt",
        "completedAt",
      ],
      properties: {
        id: { type: "string" },
        bountyId: { type: "string" },
        title: { type: "string" },
        specHash: { type: "string", pattern: "^0x[0-9a-fA-F]{64}$" },
        spec: { type: "string" },
        status: { const: "done" },
        attempt: { type: "integer", minimum: 1 },
        executorPassportId: { type: ["string", "null"] },
        createdAt: { type: "string", format: "date-time" },
        completedAt: { type: "string", format: "date-time" },
      },
    },
    evidence: {
      type: "object",
      required: ["txHashes"],
      properties: {
        txHashes: {
          type: "array",
          items: { type: "string", pattern: "^0x[0-9a-fA-F]{64}$" },
        },
        verdictId: { type: "string", pattern: "^0x[0-9a-fA-F]{64}$" },
        deliverableHash: { type: "string", pattern: "^0x[0-9a-fA-F]{64}$" },
      },
    },
    payment: {
      type: "object",
      required: ["from", "to", "amountUsdc", "chainId", "txHash"],
      properties: {
        from: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" },
        to: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" },
        amountUsdc: { type: "string" },
        chainId: { type: "integer", minimum: 1 },
        txHash: { type: "string", pattern: "^0x[0-9a-fA-F]{64}$" },
      },
    },
    signer: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" },
    chainId: { type: "integer", minimum: 1 },
    issuedAt: { type: "string", format: "date-time" },
    signature: { type: "string", pattern: "^0x[0-9a-fA-F]{130}$" },
  },
  additionalProperties: false,
} as const;
