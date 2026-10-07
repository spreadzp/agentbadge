import { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import z from "zod";
import { BASE_URL } from "../../lib/page-meta";
import { didKeyMaterialFromEnv } from "../../lib/agent-discovery/did-key";
import { signDomainLinkageCredential } from "../../lib/agent-discovery/did-config";

export const identityRoutes = new Hono();

// ─── DID Configuration (DIF) — SLICE-178-7 ──────────────────────────
// VC-JWT proving did:web:<host> controls this origin. Signed at first
// request (boot-time semantics) with DID_SIGNING_KEY; iat/exp make the
// JWT non-deterministic → served dynamically, never snapshotted.
let didConfigCache: { key: string; jwt: string } | null = null;

identityRoutes.get(
  "/.well-known/did-configuration.json",
  describeRoute({
    tags: ["Discovery"],
    summary: "DID Configuration — signed DomainLinkageCredential (DIF)",
    description:
      "Returns linked_dids with a VC-JWT (EdDSA) binding the platform " +
      "did:web identifier to this origin. Requires DID_SIGNING_KEY; " +
      "absent → 404 (absence beats an unsigned config).",
    responses: {
      200: {
        description: "DID Configuration with linked_dids VC-JWT",
        content: {
          "application/json": {
            schema: resolver(
              z.object({ linked_dids: z.array(z.string()) }),
            ),
          },
        },
      },
      404: { description: "DID identity not configured" },
    },
  }),
  async (c) => {
    const material = didKeyMaterialFromEnv();
    if (!material) return c.notFound();

    const host = new URL(BASE_URL).host;
    if (!didConfigCache || didConfigCache.key !== material.pkcs8) {
      didConfigCache = {
        key: material.pkcs8,
        jwt: await signDomainLinkageCredential({
          pkcs8: material.pkcs8,
          did: `did:web:${host}`,
          origin: BASE_URL,
        }),
      };
    }

    return c.json(
      { linked_dids: [didConfigCache.jwt] },
      200,
      {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=3600",
      },
    );
  },
);

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
