// EPIC-262 (SLICE-262-0a): /.well-known/agentbadge-keys.json — public
// registry of the intel signing keys. Verifiers (plugins, dashboards,
// third parties) fetch it to validate Ed25519 signatures on canonical
// evidence envelopes and reports (SLICE-262-1+). Array shape leaves room
// for rotation (overlapping active keys) and revoked entries; short
// max-age so rotations propagate quickly.
import { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import z from "zod";
import { toPublicKeyEntry } from "../../lib/intel/keys";
import {
  deriveJobsKey,
  jobsKeysetEntry,
  signKeyset,
} from "../../lib/intel/pull";
import { INTEL_KEY_MISSING, type IntelRouteDeps } from "./index";

const keyEntrySchema = z.object({
  key_id: z.string(),
  algorithm: z.literal("ed25519"),
  public_key: z.string(),
  use: z.literal("sig"),
  status: z.string(),
});

const keysDocSchema = z.object({
  keys: z.array(keyEntrySchema),
  root_id: z.string(),
  keysets: z.array(
    z.object({
      key_id: z.string(),
      public_key: z.string(),
      purpose: z.literal("jobs"),
      not_before: z.string(),
      not_after: z.string(),
      status: z.string(),
    }),
  ),
  sig: z.object({
    algorithm: z.literal("ed25519"),
    key_id: z.string(),
    value: z.string(),
  }),
});

export function createIntelKeysRoutes(deps: IntelRouteDeps): Hono {
  const app = new Hono();

  app.get(
    "/.well-known/agentbadge-keys.json",
    describeRoute({
      tags: ["Intel"],
      summary: "Agent Surface Intel signing-key registry",
      description:
        "Public Ed25519 key registry for Agent Surface Intelligence. " +
        "Signatures on canonical evidence envelopes and signed reports " +
        "reference key_id; verify against the matching public_key " +
        "(base64 raw 32-byte key).",
      responses: {
        200: {
          description: "Signing key registry",
          content: {
            "application/json": { schema: resolver(keysDocSchema) },
          },
        },
        503: { description: "Enabled but signing key not configured" },
      },
    }),
    (c) => {
      if (!deps.key) return c.json(INTEL_KEY_MISSING, 503);
      const jobsKey = deriveJobsKey(deps.key);
      const keyset = signKeyset(deps.key, [jobsKeysetEntry(jobsKey)]);
      return c.json(
        { keys: [toPublicKeyEntry(deps.key)], ...keyset },
        200,
        // max-age below the plugin's min-refresh (~6h) — TTL never
        // substitutes for root-signature verification (ADR §2, R3-Q3)
        { "Cache-Control": "public, max-age=300" },
      );
    },
  );

  return app;
}
