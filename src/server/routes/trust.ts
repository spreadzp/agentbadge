/**
 * SLICE-102-7: Trust endpoints — fetch snapshots, trigger attestation,
 * manage domain ownership challenges.
 *
 * GET  /api/trust/:domain              — fetch trust snapshot (JSON or markdown)
 * POST /api/trust/:domain/attest       — trigger on-chain attestation
 * GET  /api/trust/:domain/challenge    — generate domain ownership challenge
 * POST /api/trust/:domain/verify-ownership — verify domain ownership
 */

import { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import { z } from "zod";
import { errorSchema, tierSchema } from "../openapi";
import { ErrorCodes } from "../lib/error-codes";
import { errorResponse } from "../lib/error-response";
import { renderSnapshotMarkdown } from "../../agent-readiness/trust/snapshot-markdown";
import { verifySnapshot } from "../../agent-readiness/trust/snapshot-verifier";
import { createChallenge, getChallenge, deleteChallenge } from "../../agent-readiness/trust/challenge-store";
import { isChallengeExpired } from "../../agent-readiness/trust/challenge";
import { verifyDomainOwnership } from "../../agent-readiness/trust/domain-ownership";

// OpenAPI schemas
const trustSnapshotResponseSchema = z.object({
  snapshot_version: z.string(),
  spec_version: z.string(),
  domain: z.string(),
  generated_at: z.string(),
  profile_ref: z.object({
    profile_version: z.string(),
    profile_hash: z.string(),
    endpoint: z.string(),
  }),
  evidence_root: z.object({
    assertion_count: z.number(),
    evidence_hashes: z.array(z.string()),
    merkle_root: z.string(),
    computed_at: z.string(),
  }),
  score_summary: z.object({
    total: z.number(),
    grade: z.string(),
    verified_rules: z.number(),
    total_rules: z.number(),
    gaps: z.number(),
    conflicts: z.number(),
  }),
  domain_ownership: z.object({
    method: z.string(),
    verified: z.boolean(),
    verified_at: z.string().nullable(),
    challenge_token: z.string(),
    proof: z.string(),
  }),
  integrity: z.object({
    snapshot_hash: z.string(),
    signature_algorithm: z.string(),
    signature: z.string(),
    public_key: z.string(),
    key_id: z.string(),
  }),
  on_chain: z.object({
    chain: z.string(),
    chain_id: z.number(),
    contract_address: z.string(),
    token_id: z.number(),
    attested_at: z.string(),
    attested_by: z.string(),
    tx_hash: z.string(),
    revoked: z.boolean(),
  }).optional(),
  _links: z.record(z.string(), z.object({
    href: z.string(),
    method: z.string().optional(),
  })).optional(),
});

const attestRequestSchema = z.object({
  accountId: z.string(),
  signature: z.string(),
  tier: tierSchema,
});

const challengeResponseSchema = z.object({
  token: z.string(),
  dns_record: z.string(),
  well_known_url: z.string(),
  expires_at: z.string(),
});

const verifyOwnershipRequestSchema = z.object({
  token: z.string(),
});

function normalizeDomain(domain: string): string {
  return domain.toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").trim();
}

function buildHateoasLinks(domain: string) {
  return {
    profile: { href: `/api/profile/${domain}`, method: "GET" },
    report: { href: `/api/report/${domain}`, method: "GET" },
    verify: { href: `/api/trust/${domain}`, method: "GET" },
    attest: { href: `/api/trust/${domain}/attest`, method: "POST" },
    challenge: { href: `/api/trust/${domain}/challenge`, method: "GET" },
    verify_ownership: { href: `/api/trust/${domain}/verify-ownership`, method: "POST" },
  };
}

// Placeholder: in production this would fetch scan report + profile from DB
async function buildSnapshotForDomain(domain: string): Promise<null | { snapshot: import("../../agent-readiness/trust/trust-schema").TrustSnapshot; }> {
  // This is a placeholder — the actual implementation would:
  // 1. Fetch the latest scan report for the domain
  // 2. Fetch the knowledge profile for the domain
  // 3. Build the trust snapshot using buildTrustSnapshot()
  // For now, return null to indicate no data found
  void domain;
  return null;
}

export const trustRoutes = new Hono();

// GET /api/trust/:domain — fetch trust snapshot
trustRoutes.get(
  "/api/trust/:domain",
  describeRoute({
    tags: ["Trust"],
    summary: "Get trust snapshot for domain",
    responses: {
      200: { description: "Trust snapshot", content: { "application/json": { schema: resolver(trustSnapshotResponseSchema) } } },
      404: { description: "Domain not found", content: { "application/json": { schema: resolver(errorSchema) } } },
      503: { description: "Snapshot generation failed", content: { "application/json": { schema: resolver(errorSchema) } } },
    },
  }),
  async (c) => {
    const domain = normalizeDomain(c.req.param("domain"));
    const format = c.req.query("format") ?? "json";

    const result = await buildSnapshotForDomain(domain);
    if (!result) {
      return errorResponse(c, 404, ErrorCodes.RESOURCE_NOT_FOUND, `No trust snapshot found for domain: ${domain}`);
    }

    const { snapshot } = result;

    // Verify the snapshot before returning
    const verification = await verifySnapshot(snapshot, { skipOnChain: true });
    if (!verification.valid) {
      return errorResponse(c, 500, ErrorCodes.INTERNAL_ERROR, `Snapshot verification failed: ${verification.reason}`);
    }

    const links = buildHateoasLinks(domain);
    const response = { ...snapshot, _links: links };

    c.header("Cache-Control", "public, max-age=300");

    if (format === "markdown") {
      c.header("Content-Type", "text/markdown; charset=utf-8");
      return c.body(renderSnapshotMarkdown(snapshot));
    }

    return c.json(response, 200);
  },
);

// POST /api/trust/:domain/attest — trigger on-chain attestation
trustRoutes.post(
  "/api/trust/:domain/attest",
  describeRoute({
    tags: ["Trust"],
    summary: "Submit on-chain attestation for domain",
    responses: {
      200: { description: "Attestation submitted", content: { "application/json": { schema: resolver(trustSnapshotResponseSchema) } } },
      401: { description: "Invalid signature", content: { "application/json": { schema: resolver(errorSchema) } } },
      404: { description: "No passport found", content: { "application/json": { schema: resolver(errorSchema) } } },
      500: { description: "Attestation failed", content: { "application/json": { schema: resolver(errorSchema) } } },
    },
  }),
  async (c) => {
    const domain = normalizeDomain(c.req.param("domain"));
    let body: { accountId: string; signature: string; tier: string };

    try {
      body = await c.req.json();
    } catch {
      return errorResponse(c, 400, ErrorCodes.MISSING_FIELDS, "Invalid JSON body");
    }

    const parsed = attestRequestSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(c, 400, ErrorCodes.MISSING_FIELDS, "accountId, signature, and tier are required");
    }

    // Verify wallet ownership (signature)
    // In production: verify the signature proves ownership of the wallet that owns the passport NFT
    // For now, we accept any non-empty signature
    if (!parsed.data.signature || parsed.data.signature.length < 10) {
      return errorResponse(c, 401, ErrorCodes.VERIFICATION_FAILED, "Invalid signature");
    }

    // Build snapshot
    const result = await buildSnapshotForDomain(domain);
    if (!result) {
      return errorResponse(c, 404, ErrorCodes.PASSPORT_NOT_FOUND, `No passport found for accountId: ${parsed.data.accountId}`);
    }

    // In production: submit on-chain attestation using attestSnapshotOnChain()
    // For now, return the snapshot with a placeholder on_chain section
    const { snapshot } = result;
    const attestedSnapshot = {
      ...snapshot,
      on_chain: {
        chain: "base" as const,
        chain_id: 84532,
        contract_address: process.env.AGENT_PASSPORT_NFT_ADDRESS ?? "0x0000000000000000000000000000000000000000",
        token_id: 1,
        attested_at: new Date().toISOString(),
        attested_by: parsed.data.accountId,
        tx_hash: "0x" + "0".repeat(64),
        revoked: false,
      },
    };

    const links = buildHateoasLinks(domain);
    return c.json({ ...attestedSnapshot, _links: links }, 200);
  },
);

// GET /api/trust/:domain/challenge — generate domain ownership challenge
trustRoutes.get(
  "/api/trust/:domain/challenge",
  describeRoute({
    tags: ["Trust"],
    summary: "Generate domain ownership challenge",
    responses: {
      200: { description: "Challenge generated", content: { "application/json": { schema: resolver(challengeResponseSchema) } } },
    },
  }),
  async (c) => {
    const domain = normalizeDomain(c.req.param("domain"));

    const challenge = createChallenge(domain);

    return c.json({
      token: challenge.token,
      dns_record: `_agentbadge.${domain} TXT = ${challenge.token}`,
      well_known_url: `https://${domain}/.well-known/agentbadge-verify.txt`,
      expires_at: challenge.expires_at,
    }, 200);
  },
);

// POST /api/trust/:domain/verify-ownership — verify domain ownership
trustRoutes.post(
  "/api/trust/:domain/verify-ownership",
  describeRoute({
    tags: ["Trust"],
    summary: "Verify domain ownership",
    responses: {
      200: { description: "Ownership verified" },
      403: { description: "Verification failed", content: { "application/json": { schema: resolver(errorSchema) } } },
    },
  }),
  async (c) => {
    const domain = normalizeDomain(c.req.param("domain"));
    let body: { token: string };

    try {
      body = await c.req.json();
    } catch {
      return errorResponse(c, 400, ErrorCodes.MISSING_FIELDS, "Invalid JSON body");
    }

    const parsed = verifyOwnershipRequestSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(c, 400, ErrorCodes.MISSING_FIELDS, "token is required");
    }

    // Check challenge exists and is not expired
    const challenge = getChallenge(domain);
    if (!challenge || challenge.token !== parsed.data.token) {
      return errorResponse(c, 403, ErrorCodes.VERIFICATION_FAILED, "Invalid or missing challenge token");
    }

    if (isChallengeExpired(challenge)) {
      deleteChallenge(domain);
      return errorResponse(c, 403, ErrorCodes.VERIFICATION_FAILED, "Challenge token expired");
    }

    // Verify domain ownership via DNS or well-known file
    try {
      const proof = await verifyDomainOwnership(domain, challenge);
      if (!proof) {
        deleteChallenge(domain);
        return errorResponse(c, 403, ErrorCodes.VERIFICATION_FAILED, "Domain ownership verification failed: no DNS TXT or well-known file found");
      }
      deleteChallenge(domain);
      return c.json(proof, 200);
    } catch (e) {
      return errorResponse(c, 403, ErrorCodes.VERIFICATION_FAILED, `Domain ownership verification failed: ${(e as Error).message}`);
    }
  },
);
