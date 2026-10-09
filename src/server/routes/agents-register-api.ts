// SLICE-184-2 (EPIC-184): self-serve agent registration API.
//  POST   /api/v1/agents/register — name → ERC-8004 mint + agb_ key (once)
//  GET    /api/v1/agents/me       — registration record by Bearer key
//  DELETE /api/v1/agents/me       — self-revoke (instant, cache-bust)
// Legacy POST /agents/register (Hedera passport-required) is untouched —
// the v1 prefix is the new path (D-184-5).

import { Hono, type Context } from "hono";
import { describeRoute } from "hono-openapi";
import { logger } from "@agentbadge/passport";

import { errorResponse } from "../lib/error-response";
import { ErrorCodes } from "../lib/error-codes";
import { consumerKey } from "../lib/eaas/request";
import {
  hashApiKey,
  isApiKeyFormat,
  lookupAgentByKey,
  revokeApiKey,
} from "../lib/agent-registration/api-keys";
import { bustAgentKeyCache } from "../middleware/agent-key-auth";
import {
  createDailyLimiter,
  registerAgent,
  RegistrationError,
  type MintFn,
  type RegisterInput,
} from "../lib/agent-registration/register";
import type {
  AgentRegistration,
  AgentRegistrationStore,
} from "../lib/agent-registration/store";

export interface AgentRegisterRoutesDeps {
  /** Feature gate — AGENT_REGISTER_ENABLED (off → 503 on POST). */
  enabled: boolean;
  store: AgentRegistrationStore;
  /** Undefined when the ops signer is missing → POST 503 (no silent mint). */
  mint?: MintFn;
  chainId: number;
  registryAddress: `0x${string}`;
  /** Observer-tier keyed free limit advertised to callers (req/min). */
  keyRpm: number;
  /** Max registrations per IP per rolling day. */
  dailyLimit: number;
}

const bearerKey = (c: Context): string | undefined => {
  const h = c.req.header("authorization");
  if (!h?.startsWith("Bearer ")) return undefined;
  return h.slice(7).trim();
};

/** Public view of a record — keyHash never leaves the server. */
const publicRecord = (rec: AgentRegistration) => ({
  agent_id: rec.agentId,
  registry: "erc-8004",
  registry_address: rec.registryAddress,
  registry_tx: rec.registryTx,
  name: rec.name,
  ...(rec.endpoint ? { endpoint: rec.endpoint } : {}),
  tier: rec.tier,
  status: rec.status,
  reputation: null as null,
  reputation_note: "no_data",
  created_at: rec.createdAt,
});

export function createAgentRegisterRoutes(
  deps: AgentRegisterRoutesDeps,
): Hono {
  const routes = new Hono();
  const daily = createDailyLimiter(deps.dailyLimit);

  routes.post(
    "/api/v1/agents/register",
    describeRoute({
      description:
        "Self-serve agent registration — mints into the canonical ERC-8004 " +
        "identity registry and returns a single-use-shown agb_ api key " +
        "(observer tier, keyed free-tier limits).",
      responses: {
        201: { description: "Registered agent + api key (shown once)" },
        400: { description: "Invalid input" },
        429: { description: "Daily registration limit exceeded" },
        502: { description: "Registry mint failed — nothing was charged" },
        503: { description: "Registration disabled or signer misconfigured" },
      },
    }),
    async (c) => {
      if (!deps.enabled || !deps.mint) {
        return errorResponse(
          c,
          503,
          ErrorCodes.EXECUTION_FAILED,
          "agent registration is unavailable",
          { retryable: true },
        );
      }
      if (!daily.allow(consumerKey(c))) {
        return errorResponse(
          c,
          429,
          ErrorCodes.REGISTER_RATE_LIMITED,
          "registration rate limit exceeded",
          { retryable: true },
        );
      }

      let body: RegisterInput;
      try {
        body = (await c.req.json()) as RegisterInput;
      } catch {
        return errorResponse(c, 400, ErrorCodes.INVALID_JSON, "invalid JSON");
      }

      try {
        const { record, apiKey, agentUri } = await registerAgent(
          {
            store: deps.store,
            mint: deps.mint,
            chainId: deps.chainId,
            registryAddress: deps.registryAddress,
          },
          {
            name: body.name,
            endpoint: body.endpoint,
            capabilities: body.capabilities,
            description: body.description,
          },
        );
        logger.info("agent registered", {
          agentId: record.agentId,
          tx: record.registryTx,
        });
        return c.json(
          {
            agent_id: record.agentId,
            registry: "erc-8004",
            registry_tx: record.registryTx,
            agent_uri: agentUri,
            api_key: apiKey,
            tier: record.tier,
            limits: {
              free_tier: `${deps.keyRpm}/min per key`,
              note: "api_key shown once — it is stored as sha256 only",
            },
            next_call: {
              method: "GET",
              path: "/api/v1/agents/me",
              why: "Check your registration + usage",
            },
          },
          201,
        );
      } catch (e) {
        if (e instanceof RegistrationError) {
          if (e.code === "invalid_input") {
            return errorResponse(
              c,
              400,
              ErrorCodes.INVALID_INPUT,
              e.message,
            );
          }
          if (e.code === "uri_too_large") {
            return errorResponse(
              c,
              400,
              ErrorCodes.INVALID_INPUT,
              e.message,
            );
          }
          return errorResponse(
            c,
            502,
            ErrorCodes.EXECUTION_FAILED,
            "registration mint failed — no record was created",
            { retryable: true },
          );
        }
        throw e;
      }
    },
  );

  /** Shared bearer→record gate for /me; null = response already sent. */
  const meGate = async (
    c: Context,
  ): Promise<AgentRegistration | Response> => {
    const key = bearerKey(c);
    if (!key || !isApiKeyFormat(key)) {
      return errorResponse(
        c,
        401,
        ErrorCodes.AGENT_KEY_INVALID,
        "Authorization: Bearer agb_<key> required",
      );
    }
    const rec = await lookupAgentByKey(deps.store, key);
    if (!rec) {
      // Unknown vs revoked — distinguish for the honest code.
      const stored = await deps.store.byKeyHash(hashApiKey(key));
      if (stored?.status === "revoked") {
        return errorResponse(
          c,
          401,
          ErrorCodes.AGENT_KEY_REVOKED,
          "api key revoked",
        );
      }
      return errorResponse(
        c,
        401,
        ErrorCodes.AGENT_KEY_INVALID,
        "unknown api key",
      );
    }
    return rec;
  };

  routes.get(
    "/api/v1/agents/me",
    describeRoute({
      description:
        "Return the registration record for the Bearer agb_ key " +
        "(observer tier). reputation is honest-null — new agents have no data.",
      responses: {
        200: { description: "Registration record (keyHash omitted)" },
        401: { description: "Missing/malformed/revoked api key" },
      },
    }),
    async (c) => {
      const rec = await meGate(c);
      if (rec instanceof Response) return rec;
      return c.json(publicRecord(rec));
    },
  );

  routes.delete(
    "/api/v1/agents/me",
    describeRoute({
      description:
        "Self-revoke the Bearer agb_ key — instant, effective immediately.",
      responses: {
        200: { description: "Key revoked" },
        401: { description: "Missing/malformed/revoked api key" },
      },
    }),
    async (c) => {
      const rec = await meGate(c);
      if (rec instanceof Response) return rec;
      await revokeApiKey(deps.store, rec.agentId, "self");
      // SLICE-184-3: kill the 60s auth-cache entry so revoke is instant.
      const rawKey = bearerKey(c);
      if (rawKey) await bustAgentKeyCache(hashApiKey(rawKey));
      logger.info("agent key self-revoked", { agentId: rec.agentId });
      return c.json({ status: "revoked", agent_id: rec.agentId });
    },
  );

  return routes;
}
