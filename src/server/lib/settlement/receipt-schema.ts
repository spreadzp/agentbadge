/**
 * SLICE-227-4 (EPIC-227): Settlement Receipt public schema v1 — the JSON
 * shape served by `GET /.well-known/settlement-receipt.schema.json` plus
 * a zod twin so endpoint and static schema cannot drift (drift test in
 * settlement-receipt.test.ts parses a built receipt against the zod).
 */
import { z } from "zod";

const HEX32 = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const SIG = /^0x[0-9a-fA-F]{130}$/;

const LEG_STATUS = ["OPEN", "FROZEN", "COMPLETED", "FAILED", "CANCELLED"];
const MILESTONE_STATUS = [
  "PENDING",
  "READY",
  "APPROVED",
  "RELEASED",
  "DISPUTED",
  "CANCELLED",
];
const PLAN_STATUS = ["ACTIVE", "DISPUTED", "COMPLETED", "CANCELLED"];

const legSchema = z.object({
  payee: z.string().regex(ADDRESS),
  amountUsdc: z.string(),
  role: z.enum(["PROVIDER", "COLLABORATOR", "PLATFORM_FEE"]),
  status: z.enum(LEG_STATUS as [string, ...string[]]),
  network: z.string().nullable(),
  txHash: z.string().regex(HEX32).nullable(),
});

/** Public receipt shape (everything except the internal `body` message). */
export const SettlementReceiptSchemaV1 = z.object({
  schema: z.literal("agentbadge/settlement-receipt@1"),
  agreement: z.object({
    ref: z.string().min(1),
    planId: z.string().min(1),
    status: z.enum(PLAN_STATUS as [string, ...string[]]),
    currency: z.string().min(1),
    totalUsd: z.string(),
    buyerWallet: z.string().regex(ADDRESS),
    providerWallet: z.string().regex(ADDRESS),
  }),
  milestones: z.array(
    z.object({
      milestoneId: z.string().min(1),
      seq: z.number().int().nonnegative(),
      amountUsd: z.string(),
      status: z.enum(MILESTONE_STATUS as [string, ...string[]]),
      intentId: z.string().nullable(),
      legs: z.array(legSchema),
    }),
  ),
  signer: z.string().regex(ADDRESS),
  chainId: z.number().int().positive(),
  issuedAt: z.string().regex(ISO),
  signature: z.string().regex(SIG),
});
export type SettlementReceiptV1 = z.infer<typeof SettlementReceiptSchemaV1>;

/** Static JSON Schema served at /.well-known/settlement-receipt.schema.json. */
export const SETTLEMENT_RECEIPT_JSON_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://agentbadge.xyz/.well-known/settlement-receipt.schema.json",
  title: "AgentBadge Settlement Receipt v1",
  type: "object",
  required: [
    "schema",
    "agreement",
    "milestones",
    "signer",
    "chainId",
    "issuedAt",
    "signature",
  ],
  properties: {
    schema: { const: "agentbadge/settlement-receipt@1" },
    agreement: {
      type: "object",
      required: [
        "ref",
        "planId",
        "status",
        "currency",
        "totalUsd",
        "buyerWallet",
        "providerWallet",
      ],
      properties: {
        ref: { type: "string" },
        planId: { type: "string" },
        status: { enum: PLAN_STATUS },
        currency: { type: "string" },
        totalUsd: { type: "string" },
        buyerWallet: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" },
        providerWallet: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" },
      },
    },
    milestones: {
      type: "array",
      items: {
        type: "object",
        required: [
          "milestoneId",
          "seq",
          "amountUsd",
          "status",
          "intentId",
          "legs",
        ],
        properties: {
          milestoneId: { type: "string" },
          seq: { type: "integer", minimum: 0 },
          amountUsd: { type: "string" },
          status: { enum: MILESTONE_STATUS },
          intentId: { type: ["string", "null"] },
          legs: {
            type: "array",
            items: {
              type: "object",
              required: [
                "payee",
                "amountUsdc",
                "role",
                "status",
                "network",
                "txHash",
              ],
              properties: {
                payee: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" },
                amountUsdc: { type: "string" },
                role: { enum: ["PROVIDER", "COLLABORATOR", "PLATFORM_FEE"] },
                status: { enum: LEG_STATUS },
                network: { type: ["string", "null"] },
                txHash: {
                  type: ["string", "null"],
                  pattern: "^0x[0-9a-fA-F]{64}$",
                },
              },
            },
          },
        },
      },
    },
    signer: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" },
    chainId: { type: "integer", minimum: 1 },
    issuedAt: { type: "string", format: "date-time" },
    signature: { type: "string", pattern: "^0x[0-9a-fA-F]{130}$" },
  },
} as const;
