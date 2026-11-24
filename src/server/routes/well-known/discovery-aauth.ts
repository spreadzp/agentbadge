import { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import z from "zod";
import { BASE_URL } from "../../lib/page-meta";

export const aauthDiscoveryRoutes = new Hono();

// ─── OAuth authorization server metadata ─────────────────────
aauthDiscoveryRoutes.get(
  "/.well-known/oauth-authorization-server",
  describeRoute({
    tags: ["Discovery"],
    summary: "OAuth authorization server metadata (MCP auth discovery)",
    description:
      "Returns OAuth 2.0 authorization server metadata per RFC 8414. Enables MCP clients to discover authentication requirements.",
    responses: {
      200: {
        description: "OAuth metadata JSON",
        content: {
          "application/json": {
            schema: resolver(
              z.object({
                issuer: z.string(),
                authorization_endpoint: z.string(),
                token_endpoint: z.string(),
                registration_endpoint: z.string(),
                jwks_uri: z.string(),
                response_types_supported: z.array(z.string()),
                grant_types_supported: z.array(z.string()),
              }),
            ),
          },
        },
      },
    },
  }),
  (c) => {
    const baseUrl = BASE_URL;
    return c.json(
      {
        issuer: baseUrl,
        authorization_endpoint: `${baseUrl}/auth/authorize`,
        token_endpoint: `${baseUrl}/auth/token`,
        registration_endpoint: `${baseUrl}/auth/register`,
        jwks_uri: `${baseUrl}/.well-known/jwks.json`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "client_credentials"],
        // SLICE-259-40 (AB-130/143): top-level scopes_supported +
        // revocation_endpoint — the scanner reads only top-level fields,
        // the nested agent_auth copy was invisible. revocation points at
        // the REAL admin-gated revoke route (the old /passport/revoke
        // pointer was a dead URL).
        scopes_supported: [
          "trust:read",
          "scan:lite",
          "passport:issue",
          "badge:verify",
          "requests:write",
          "surveys:answer",
        ],
        revocation_endpoint: `${baseUrl}/admin/revoke`,
        agent_auth: {
          register_uri: `${baseUrl}/auth.md`,
          supported_identity_types: ["did:hcs", "nft-passport"],
          credential_types: ["nft", "hcs-signed-message"],
          claims_endpoint: `${baseUrl}/passport`,
          revocation_endpoint: `${baseUrl}/admin/revoke`,
        },
      },
      200,
      { "Cache-Control": "public, max-age=3600" },
    );
  },
);

// ─── AAuth resource metadata (SLICE-PR3-7 / AB-135) ──────────────
// draft-hardt-oauth-aauth-protocol §11.2.4: resource server metadata.
// issuer MUST byte-match the origin this doc is fetched from (RFC8414 §3.3
// semantics). Only fields describing what we actually serve — the
// agent_authorization grant itself lands in phase 2 before it may be
// advertised in grant_types_supported.
aauthDiscoveryRoutes.get(
  "/.well-known/aauth-resource.json",
  describeRoute({
    tags: ["Discovery"],
    summary: "AAuth resource server metadata",
    description:
      "AAuth (draft-hardt-oauth-aauth-protocol) resource server metadata: issuer and JWKS location for the agentbadge.xyz resource origin.",
    responses: {
      200: {
        description: "AAuth resource metadata JSON",
        content: {
          "application/json": {
            schema: resolver(
              z.object({
                issuer: z.string(),
                jwks_uri: z.string(),
                name: z.string(),
                description: z.string(),
                documentation_uri: z.string(),
              }),
            ),
          },
        },
      },
    },
  }),
  (c) => {
    const baseUrl = BASE_URL;
    return c.json(
      {
        issuer: baseUrl,
        jwks_uri: `${baseUrl}/.well-known/jwks.json`,
        name: "AgentBadge",
        description:
          "Agent-readiness scoring, verifiable badges, and passport NFTs for AI agents. Paid endpoints use x402 (HTTP 402) payments.",
        documentation_uri: `${baseUrl}/auth.md`,
      },
      200,
      { "Cache-Control": "public, max-age=3600" },
    );
  },
);

// ─── aauth.json (SLICE-PR3-7 / AB-135 + AB-137) ──────────────────
// Simplified discovery doc the agent-readiness scanner (and ecosystem
// crawlers) probe. Points at the spec-canonical aauth-resource.json and
// describes real agent-facing access: x402-paid endpoints, free trust
// reads, passport issuance. scope_descriptions feeds AB-137.
aauthDiscoveryRoutes.get(
  "/.well-known/aauth.json",
  describeRoute({
    tags: ["Discovery"],
    summary: "Agent authorization discovery (AAuth-compatible)",
    description:
      "Simplified agent authorization discovery document: links AAuth resource metadata, OAuth server metadata, and published scope descriptions for agent-facing access.",
    responses: {
      200: {
        description: "AAuth discovery JSON",
        content: {
          "application/json": {
            schema: resolver(
              z.object({
                issuer: z.string(),
                jwks_uri: z.string(),
                token_endpoint: z.string(),
                aauth_resource_metadata: z.string(),
                oauth_authorization_server: z.string(),
                scope_descriptions: z.array(
                  z.object({
                    scope: z.string(),
                    description: z.string(),
                  }),
                ),
              }),
            ),
          },
        },
      },
    },
  }),
  (c) => {
    const baseUrl = BASE_URL;
    return c.json(
      {
        issuer: baseUrl,
        jwks_uri: `${baseUrl}/.well-known/jwks.json`,
        token_endpoint: `${baseUrl}/auth/token`,
        aauth_resource_metadata: `${baseUrl}/.well-known/aauth-resource.json`,
        oauth_authorization_server: `${baseUrl}/.well-known/oauth-authorization-server`,
        agent_auth: {
          register_uri: `${baseUrl}/auth.md`,
          supported_identity_types: ["did:hcs", "nft-passport"],
          credential_types: ["nft", "hcs-signed-message"],
          claims_endpoint: `${baseUrl}/passport`,
          revocation_endpoint: `${baseUrl}/admin/revoke`,
        },
        scope_descriptions: [
          {
            scope: "trust:read",
            description:
              "Read agent trust snapshots via GET /api/trust/:domain — free, no auth.",
          },
          {
            scope: "scan:lite",
            description:
              "Agent-readiness lite scan via GET /api/v1/demo/scan-lite — x402-paid (USDC on Arc).",
          },
          {
            scope: "passport:issue",
            description:
              "Mint a passport NFT via POST /passport/request — x402 payment plus wallet proof.",
          },
          {
            scope: "badge:verify",
            description:
              "Verify a badge verdict via the public verify endpoints — free, no auth.",
          },
          {
            scope: "requests:write",
            description:
              "Submit and poll async requests via POST/GET /api/requests — free; anonymous allowed, verified agent key marks the request; optional Idempotency-Key replays safely.",
          },
          {
            scope: "surveys:answer",
            description:
              "Answer open agent surveys via POST /api/surveys/:id/answer — free; verified answers credit the reputation milestone counter (no passport mint).",
          },
        ],
      },
      200,
      { "Cache-Control": "public, max-age=3600" },
    );
  },
);
