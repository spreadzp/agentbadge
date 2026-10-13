/**
 * Shared bearer→record gate for /me and self-revoke (extracted from
 * agents-register-api.ts for the 300-line lint cap).
 * Single byKeyHash scan (M-6): lookupAgentByKey collapses
 * revoked→unknown, so resolve the record once and branch here.
 */
import type { Context } from "hono";
import { errorResponse } from "../error-response";
import { ErrorCodes } from "../error-codes";
import { hashApiKey, isApiKeyFormat } from "./api-keys";
import type { AgentRegistration, AgentRegistrationStore } from "./store";

const bearerKey = (c: Context): string | undefined => {
  const h = c.req.header("authorization");
  if (!h?.startsWith("Bearer ")) return undefined;
  return h.slice(7).trim();
};

/** Null → response already sent (401). */
export async function meGate(
  c: Context,
  store: AgentRegistrationStore,
): Promise<AgentRegistration | Response> {
  const key = bearerKey(c);
  if (!key || !isApiKeyFormat(key))
    return errorResponse(
      c,
      401,
      ErrorCodes.AGENT_KEY_INVALID,
      "Authorization: Bearer agb_<key> required",
    );
  const stored = await store.byKeyHash(hashApiKey(key));
  if (stored?.status === "revoked")
    return errorResponse(c, 401, ErrorCodes.AGENT_KEY_REVOKED, "api key revoked");
  if (!stored || stored.status !== "active")
    return errorResponse(c, 401, ErrorCodes.AGENT_KEY_INVALID, "unknown api key");
  return stored;
}
