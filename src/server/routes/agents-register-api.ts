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
import { tryGetCache } from "../lib/cache";
import type { CacheProvider } from "@agentbadge/cache";
import {
  hashApiKey,
  isApiKeyFormat,
  revokeApiKey,
} from "../lib/agent-registration/api-keys";
import { bustAgentKeyCache } from "../middleware/agent-key-auth";
import { adminAuth } from "../middleware/adminAuth";
import {
  createDailyBucket,
  createDailyLimiter,
} from "../lib/agent-registration/daily-bucket";
import {
  registerAgent,
  RegistrationError,
  type MintFn,
  type SponsoredMintFn,
} from "../lib/agent-registration/register";
import {
  gateSponsoredRequest,
  type SponsoredBody,
} from "../lib/agent-registration/sponsored-gate";
import { publicRecord } from "../lib/agent-registration/public-view";
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
  /** Max registrations per IP per UTC day (regcap:<ip>:<day> bucket). */
  dailyLimit: number;
  /** Cache backend for the shared regcap counter — default tryGetCache(). */
  cache?: CacheProvider | null;
  /** SLICE-184-5: sponsored relayer — wired only when REGISTER_SPONSORED=1; {owner, signature} requests 400 when absent. */
  sponsoredMint?: SponsoredMintFn;
  /** Treasury-budget cap for sponsored mints per UTC day (sponcap:<day>). */
  sponsoredDailyLimit?: number;
}

const bearerKey = (c: Context): string | undefined => {
  const h = c.req.header("authorization");
  if (!h?.startsWith("Bearer ")) return undefined;
  return h.slice(7).trim();
};

export function createAgentRegisterRoutes(
  deps: AgentRegisterRoutesDeps,
): Hono {
  const routes = new Hono();
  const daily = createDailyLimiter(
    deps.dailyLimit,
    deps.cache === undefined ? tryGetCache() : deps.cache,
  );
  // Financial boundary → strict: cache backend down = deny, not
  // unlimited treasury spend (Arc Studio review H-1).
  const sponcap = createDailyBucket(
    "sponcap",
    deps.sponsoredDailyLimit ?? 50,
    deps.cache === undefined ? tryGetCache() : deps.cache,
    { strict: true },
  );

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
      if (!deps.enabled || !deps.mint)
        return errorResponse(c, 503, ErrorCodes.EXECUTION_FAILED, "agent registration is unavailable", { retryable: true });
      // SLICE-184-4: per-IP daily cap regcap:<ip>:<day> (sybil guard).
      // H-2 (Arc Studio review): first XFF element is attacker-set.
      // Trust only headers our proxies own (CF → fly edge); else the
      // LAST XFF hop (closest proxy appended it); else a shared
      // "anonymous" bucket — spoofing degrades to the tightest pool.
      const xff = c.req.header("x-forwarded-for");
      const ip = c.req.header("cf-connecting-ip") ??
        c.req.header("fly-client-ip") ??
        xff?.split(",").at(-1)?.trim() ??
        "anonymous";
      if (!(await daily.allow(ip))) {
        return errorResponse(
          c,
          429,
          ErrorCodes.REGISTER_RATE_LIMITED,
          "registration rate limit exceeded",
          { retryable: true },
        );
      }

      let body: SponsoredBody;
      try {
        body = await c.req.json();
      } catch {
        return errorResponse(c, 400, ErrorCodes.INVALID_JSON, "invalid JSON");
      }

      // SLICE-184-5: sponsored path — EIP-191 intent + sponcap budget gate.
      if (body.owner) {
        const gate = await gateSponsoredRequest({
          sponsoredEnabled: Boolean(deps.sponsoredMint),
          chainId: deps.chainId,
          registryAddress: deps.registryAddress,
          owner: body.owner,
          signature: body.signature,
          expiresAt: body.expiresAt,
          name: String(body.name ?? ""),
          allowSponsored: () => sponcap.allow("global"),
          releaseSponsored: () => sponcap.release("global"),
          consumeSignature: (h) => deps.store.consumeSignature(h),
        });
        if (gate)
          return errorResponse(c, gate.status, gate.code, gate.message, { retryable: true });
      }

      try {
        const { record, apiKey, agentUri } = await registerAgent(
          {
            store: deps.store,
            mint: deps.mint,
            sponsoredMint: deps.sponsoredMint,
            chainId: deps.chainId,
            registryAddress: deps.registryAddress,
          },
          {
            name: body.name,
            endpoint: body.endpoint,
            capabilities: body.capabilities,
            description: body.description,
            ...(body.owner ? { owner: body.owner } : {}),
          },
        );
        logger.info("agent registered", {
          agentId: record.agentId,
          tx: record.registryTx,
          ...(record.sponsored ? { sponsored: true, owner: record.owner } : {}),
        });
        return c.json(
          {
            agent_id: record.agentId,
            registry: "erc-8004",
            registry_tx: record.registryTx,
            ...(record.sponsored
              ? { sponsored: true, owner: record.owner, owner_tx: record.ownerTx }
              : {}),
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
          // H-1: the gate reserved a sponsored slot — give it back so
          // failed mints can't drain the daily treasury budget.
          if (body.owner) await sponcap.release("global").catch(() => {});
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
    if (!key || !isApiKeyFormat(key))
      return errorResponse(c, 401, ErrorCodes.AGENT_KEY_INVALID, "Authorization: Bearer agb_<key> required");
    // Single byKeyHash scan (M-6): lookupAgentByKey collapses
    // revoked→unknown, so resolve the record once and branch here.
    const stored = await deps.store.byKeyHash(hashApiKey(key));
    if (stored?.status === "revoked")
      return errorResponse(c, 401, ErrorCodes.AGENT_KEY_REVOKED, "api key revoked");
    if (!stored || stored.status !== "active")
      return errorResponse(c, 401, ErrorCodes.AGENT_KEY_INVALID, "unknown api key");
    return stored;
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

  // SLICE-184-4: admin kill-switch — revoke agent + bust the 60s
  // auth-cache so the key fails closed immediately. agentId is
  // URL-encoded (eip155:chain:registry:token).
  routes.delete(
    "/api/v1/admin/agents/:agentId{.+}",
    describeRoute({
      description:
        "Admin-revoke a registered agent — instant, auth-cache busted. " +
        "Requires X-Admin-Key or Bearer ADMIN_API_KEY.",
      responses: {
        200: { description: "Agent revoked (idempotent)" },
        401: { description: "Missing/invalid admin key" },
        404: { description: "Unknown agentId" },
        500: { description: "ADMIN_API_KEY not configured" },
      },
    }),
    adminAuth,
    async (c) => {
      const agentId = decodeURIComponent(c.req.param("agentId"));
      const rec = await deps.store.get(agentId);
      if (!rec)
        return errorResponse(c, 404, ErrorCodes.PASSPORT_NOT_FOUND, "unknown agentId");
      await deps.store.revoke(agentId, "admin");
      await bustAgentKeyCache(rec.keyHash);
      logger.info("agent admin-revoked", { agentId, previously: rec.status });
      return c.json({ status: "revoked", agent_id: agentId });
    },
  );

  return routes;
}
