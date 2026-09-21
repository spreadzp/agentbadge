import { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import z from "zod";
import { BASE_URL } from "../../lib/page-meta";

export const identityRoutes = new Hono();

// ─── WebFinger (RFC 7033) ──────────────────────────────────────

identityRoutes.get(
  "/.well-known/webfinger",
  describeRoute({
    tags: ["Discovery"],
    summary: "WebFinger endpoint (RFC 7033)",
    description:
      "Returns a JSON Resource Descriptor (JRD) for agent DIDs. Supports resource query parameter for resolving agent identities.",
    responses: {
      200: {
        description: "WebFinger JRD response",
        content: {
          "application/jrd+json": {
            schema: resolver(
              z.object({
                subject: z.string(),
                links: z.array(
                  z.object({
                    rel: z.string(),
                    href: z.string(),
                    type: z.string().optional(),
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
    const resource = c.req.query("resource") ?? `${baseUrl}/`;

    // If querying for a DID, return links to DID resolver and agent card
    if (resource.startsWith("did:hcs:") || resource.startsWith("did:")) {
      return c.json(
        {
          subject: resource,
          links: [
            {
              rel: "self",
              href: `${baseUrl}/did/${encodeURIComponent(resource)}`,
              type: "application/json",
            },
            {
              rel: "http://openid.net/specs/connect/1.0/issuer",
              href: `${baseUrl}/.well-known/oauth-authorization-server`,
              type: "application/json",
            },
            {
              rel: "https://agentbadge.xyz/rel/agent-card",
              href: `${baseUrl}/.well-known/agent-card.json`,
              type: "application/json",
            },
          ],
        },
        200,
        {
          "Content-Type": "application/jrd+json",
          "Cache-Control": "public, max-age=300",
        },
      );
    }

    // Default: return links for the service itself
    return c.json(
      {
        subject: resource,
        links: [
          {
            rel: "self",
            href: `${baseUrl}/.well-known/agent-card.json`,
            type: "application/json",
          },
          {
            rel: "http://openid.net/specs/connect/1.0/issuer",
            href: `${baseUrl}/.well-known/oauth-authorization-server`,
            type: "application/json",
          },
          {
            rel: "https://agentbadge.xyz/rel/mcp",
            href: `${baseUrl}/.well-known/mcp.json`,
            type: "application/json",
          },
          {
            rel: "https://agentbadge.xyz/rel/openapi",
            href: `${baseUrl}/api/specs`,
            type: "application/json",
          },
        ],
      },
      200,
      {
        "Content-Type": "application/jrd+json",
        "Cache-Control": "public, max-age=300",
      },
    );
  },
);

// ─── DID Configuration (W3C DID Configuration spec) ────────────

identityRoutes.get(
  "/.well-known/did.json",
  describeRoute({
    tags: ["Discovery"],
    summary: "DID Configuration (W3C)",
    description:
      "Returns a DID Configuration document linking this origin to Hedera DIDs. Used for DID-based agent identity verification.",
    responses: {
      200: {
        description: "DID Configuration JSON",
        content: {
          "application/json": {
            schema: resolver(
              z.object({
                "@context": z.string(),
                did_configurations: z.array(
                  z.object({
                    did: z.string(),
                    vc: z.object({
                      "@context": z.array(z.string()),
                      type: z.array(z.string()),
                      issuer: z.string(),
                      issuanceDate: z.string(),
                      credentialSubject: z.object({
                        id: z.string(),
                        origin: z.string(),
                      }),
                      proof: z.object({
                        type: z.string(),
                        verificationMethod: z.string(),
                        created: z.string(),
                        proofPurpose: z.string(),
                        proofValue: z.string(),
                      }),
                    }),
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
    const passportTokenId = process.env.PASSPORT_TOKEN_ID ?? "0.0.0";
    const evmPassportNft = process.env.BASE_PASSPORT_NFT;
    const evmChainId = process.env.BASE_CHAIN_ID ?? "84532";

    const didConfigurations: Array<Record<string, unknown>> = [
      {
        did: `did:hcs:${passportTokenId}:1`,
        vc: {
          "@context": [
            "https://www.w3.org/2018/credentials/v1",
            "https://identity.foundation/.well-known/did-configuration/v1",
          ],
          type: ["VerifiableCredential", "DomainLinkageCredential"],
          issuer: `did:hcs:${passportTokenId}:1`,
          issuanceDate: new Date().toISOString(),
          credentialSubject: {
            id: `did:hcs:${passportTokenId}:1`,
            origin: baseUrl,
          },
          proof: {
            type: "Ed25519Signature2018",
            verificationMethod: `did:hcs:${passportTokenId}:1#keys-1`,
            created: new Date().toISOString(),
            proofPurpose: "assertionMethod",
            proofValue: "",
          },
        },
      },
    ];

    // Add EVM DID configuration when Base Sepolia passport NFT is configured
    if (evmPassportNft) {
      const evmDid = `did:eip155:${evmChainId}:passport:${evmPassportNft}:1`;
      didConfigurations.push({
        did: evmDid,
        vc: {
          "@context": [
            "https://www.w3.org/2018/credentials/v1",
            "https://identity.foundation/.well-known/did-configuration/v1",
          ],
          type: ["VerifiableCredential", "DomainLinkageCredential"],
          issuer: evmDid,
          issuanceDate: new Date().toISOString(),
          credentialSubject: {
            id: evmDid,
            origin: baseUrl,
          },
          proof: {
            type: "Eip712Signature2021",
            verificationMethod: `${evmDid}#keys-1`,
            created: new Date().toISOString(),
            proofPurpose: "assertionMethod",
            proofValue: "",
          },
        },
      });
    }

    return c.json(
      {
        "@context": "https://identity.foundation/.well-known/did-configuration/v1",
        did_configurations: didConfigurations,
      },
      200,
      {
        "Cache-Control": "public, max-age=3600",
      },
    );
  },
);

// ─── SLICE-49-3: OAuth Protected Resource (RFC 9728) ─────────────

identityRoutes.get(
  "/.well-known/oauth-protected-resource",
  describeRoute({
    tags: ["Auth"],
    summary: "OAuth Protected Resource Metadata — RFC 9728",
    responses: {
      200: {
        description: "OAuth protected resource metadata",
        content: { "application/json": {} },
      },
    },
  }),
  (c) => {
    const baseUrl = BASE_URL;
    return c.json(
      {
        resource: baseUrl,
        authorization_servers: [`${baseUrl}/.well-known/oauth-authorization-server`],
        scopes_supported: ["read", "write", "admin"],
        bearer_methods_supported: ["header"],
        resource_documentation: `${baseUrl}/auth.md`,
      },
      200,
      {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=3600",
      },
    );
  },
);
