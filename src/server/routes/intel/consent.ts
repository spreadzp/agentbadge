// EPIC-262 (SLICE-262-8): consent grant/revoke — operator channel
// only (owner dashboard actions; the plugin channel grants audit
// consent inline via /ownership/handshake). Consent revocation
// stops paid operations even while entitlement is alive (D-262-Q8).
import type { Context, Hono } from "hono";
import {
  CONSENT_KINDS,
  grantConsent,
  revokeConsent,
  type ConsentKind,
} from "../../lib/intel/consent";
import { gateOperatorSite } from "./operator-guard";
import { INTEL_KEY_MISSING, type IntelRouteDeps } from "./index";

function bearerToken(c: { req: { header(name: string): string | undefined } }) {
  const h = c.req.header("authorization");
  if (!h?.startsWith("Bearer ")) return null;
  return h.slice(7).trim() || null;
}

export function registerConsentRoutes(
  app: Hono,
  deps: IntelRouteDeps,
): void {
  const handler =
    (action: "grant" | "revoke") =>
    async (c: Context) => {
      if (!deps.key) return c.json(INTEL_KEY_MISSING, 503);
      if (!deps.registry || !deps.registryStores || !deps.consent) {
        return c.json(
          { error: "consent_unavailable", message: "consent stores are not configured" },
          503,
        );
      }
      const body = (await c.req.json().catch(() => null)) as {
        site_id?: unknown;
        kind?: unknown;
      } | null;
      if (
        typeof body?.kind !== "string" ||
        !(CONSENT_KINDS as readonly string[]).includes(body.kind)
      ) {
        return c.json(
          { error: "kind_invalid", message: `kind must be one of: ${CONSENT_KINDS.join(", ")}` },
          400,
        );
      }
      const kind = body.kind as ConsentKind; // validated above
      const gate = await gateOperatorSite(
        deps,
        bearerToken(c),
        body,
        "consent",
      );
      if (!gate.ok) return c.json(gate.body, gate.status);
      const consent =
        action === "grant"
          ? await grantConsent(deps.consent, gate.siteId, kind, {
              principal: "operator",
              id: gate.op.operator_id,
            })
          : await revokeConsent(deps.consent, gate.siteId, kind, {
              principal: "operator",
              id: gate.op.operator_id,
            });
      return c.json({ consent }, 200);
    };

  app.post("/consent", handler("grant"));
  app.post("/consent/revoke", handler("revoke"));
}
