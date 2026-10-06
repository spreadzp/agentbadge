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
