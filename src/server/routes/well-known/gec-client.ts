// EPIC-205 (SLICE-205-2): SaSame GEC interop — OAuth 2.1 CIMD client-metadata
// document + redirect_uri callback stub.
//
// CIMD rules (their machine_entry + MCP authorization draft track):
//   - client_id MUST equal this document's own URL byte-for-byte
//   - token_endpoint_auth_method "none" = public client (PKCE S256 instead of a secret)
//   - grant_types must include refresh_token (required by their machine_entry)
//
// The callback endpoint is a capture-stub: the actual code exchange is done by
// the offline client script (scripts/gec-interop.mts). Redaction: code/state
// values are OAuth secrets — we acknowledge their presence, never echo them.

import { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import z from "zod";
import { BASE_URL } from "../../lib/page-meta";

export const gecClientRoutes = new Hono();

const GEC_CLIENT_DOC_PATH = "/.well-known/gec-client.json";
const GEC_CALLBACK_PATH = "/api/gec/callback";

gecClientRoutes.get(
  GEC_CLIENT_DOC_PATH,
  describeRoute({
    tags: ["Discovery"],
    summary: "GEC OAuth client metadata (CIMD)",
    description:
      "OAuth 2.1 Client ID Metadata Document for acting as an external agent " +
      "on foreign agent marketplaces (SaSame GEC interop). client_id equals " +
      "this document's URL; public client with PKCE S256.",
    responses: {
      200: {
        description: "CIMD client metadata document",
        content: {
          "application/json": {
            schema: resolver(
              z.object({
                client_id: z.string(),
                client_name: z.string(),
                client_uri: z.string(),
                logo_uri: z.string(),
                redirect_uris: z.array(z.string()),
                grant_types: z.array(z.string()),
                response_types: z.array(z.string()),
                token_endpoint_auth_method: z.string(),
              }),
            ),
          },
        },
      },
    },
  }),
  (c) => {
    const clientId = `${BASE_URL}${GEC_CLIENT_DOC_PATH}`;
    return c.json(
      {
        client_id: clientId,
        client_name: "AgentBadge Interop Client",
        client_uri: BASE_URL,
        logo_uri: `${BASE_URL}/icons/logo-512.png`,
        redirect_uris: [`${BASE_URL}${GEC_CALLBACK_PATH}`],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      },
      200,
      {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=3600",
      },
    );
  },
);

// ─── OAuth redirect_uri callback ────────────────────────────────────
// Mounted at "/" — the route carries the full /api/gec/callback path.
export const gecCallbackRoutes = new Hono();

gecCallbackRoutes.get(
  GEC_CALLBACK_PATH,
  describeRoute({
    tags: ["Interop"],
    summary: "GEC OAuth callback capture (stub)",
    description:
      "redirect_uri target for the SaSame GEC authorization-code flow. " +
      "Acknowledges receipt of code/state (values are never echoed — they " +
      "are OAuth secrets); the token exchange runs in the offline client " +
      "script, not here.",
    responses: {
      200: {
        description: "Callback captured",
        content: {
          "application/json": {
            schema: resolver(
              z.object({
                ok: z.boolean(),
                note: z.string(),
                received: z.object({ code: z.boolean(), state: z.boolean() }),
              }),
            ),
          },
        },
      },
      400: { description: "OAuth error response forwarded by the AS" },
    },
  }),
  (c) => {
    const error = c.req.query("error");
    if (error) {
      // `error` is a short ASCII code from the AS (invalid_request etc.) —
      // safe to relay; error_description is capped before echoing.
      const description = (c.req.query("error_description") ?? "").slice(0, 200);
      return c.json({ ok: false, error, error_description: description }, 400);
    }
    return c.json({
      ok: true,
      note: "GEC OAuth callback captured",
      received: {
        code: Boolean(c.req.query("code")),
        state: Boolean(c.req.query("state")),
      },
    });
  },
);
