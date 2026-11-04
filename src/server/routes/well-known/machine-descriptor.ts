// EPIC-206 (SLICE-206-1): canonical machine descriptor —
// /.well-known/agentbadge-machine.json. Tells a foreign agent HOW to work
// our marketplace protocol without docs: sig-auth rules, ordered endpoints
// (discover → bid → deliver → status), contract limits, verification rule.
// Keyless read: open CORS (global), immutable cache — versioned via
// protocol_version (+?v= query for client pinning).
import { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import z from "zod";
import {
  buildMachineDescriptor,
  BUDGET_STATUSES,
} from "../../lib/machine-entry";

export const machineDescriptorRoutes = new Hono();

const endpointShape = z.object({
  phase: z.string(),
  method: z.string(),
  path: z.string(),
  tool_equiv: z.string().nullable(),
  auth: z.string(),
});

const descriptorSchema = z.object({
  protocol_version: z.string(),
  auth: z.object({
    scheme: z.string(),
    signature: z.string(),
    challenge_format: z.string(),
    headers: z.object({
      wallet: z.string(),
      signature: z.string(),
      timestamp: z.string(),
    }),
    timestamp_skew_seconds: z.number(),
    chains: z.array(z.string()),
  }),
  endpoints: z.array(endpointShape),
  contract: z.object({
    idempotency_key: z.object({
      header: z.string(),
      min: z.number(),
      max: z.number(),
      required_on: z.array(z.string()),
      duplicate_response: z.string(),
    }),
    evidence_refs: z.object({ max_count: z.number(), max_len: z.number() }),
    summary: z.object({ max_len: z.number() }),
  }),
  verification: z.object({
    rule: z.string(),
    errors: z.array(z.string()),
    verdicts: z.array(z.string()),
  }),
  budget_status: z.array(z.enum(BUDGET_STATUSES)),
});

machineDescriptorRoutes.get(
  "/.well-known/agentbadge-machine.json",
  describeRoute({
    tags: ["Discovery"],
    summary: "AgentBadge marketplace machine descriptor (protocol contract)",
    description:
      "Canonical keyless-readable protocol descriptor: sig-auth challenge " +
      "format, ordered endpoint template for the task lifecycle " +
      "(discover → read → start → bid → deliver → status), contract limits " +
      "(idempotency_key, evidence_refs, summary), verifier-independence " +
      "rule and budget_status enum. Per-task specifics live in the " +
      "machine_entry block on each task.",
    responses: {
      200: {
        description: "Machine descriptor JSON",
        content: {
          "application/json": { schema: resolver(descriptorSchema) },
        },
      },
    },
  }),
  (c) =>
    c.json(buildMachineDescriptor(), 200, {
      // Versioned doc — immutable within the window; bump ?v=/protocol_version.
      "Cache-Control": "public, max-age=86400, immutable",
    }),
);
