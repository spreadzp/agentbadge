/**
 * SLICE-184-1 (EPIC-184, D-184-3): api_key lifecycle.
 *
 * `agb_` + 32 bytes base64url. The plaintext key is shown ONCE at registration
 * and is never stored or logged — the store keeps only sha256(key) hex.
 * Malformed keys miss WITHOUT touching the store (cheap format gate).
 */
import { createHash, randomBytes } from "node:crypto";
import type { AgentRegistration, AgentRegistrationStore } from "./store";

const KEY_PREFIX = "agb_";
/** 32 random bytes → 43 base64url chars (no padding). */
const KEY_BODY_LENGTH = 43;
const KEY_RE = /^agb_[A-Za-z0-9_-]{43}$/;

/** Format gate — used before any store lookup. */
export function isApiKeyFormat(key: string): boolean {
  return (
    typeof key === "string" &&
    key.length === KEY_PREFIX.length + KEY_BODY_LENGTH &&
    KEY_RE.test(key)
  );
}

/** Deterministic sha256 hex of the api key. */
export function hashApiKey(key: string): string {
  return createHash("sha256").update(key, "ascii").digest("hex");
}

/** Issues a fresh key. Caller shows `key` once, persists only `keyHash`. */
export function issueApiKey(): { key: string; keyHash: string } {
  const key = KEY_PREFIX + randomBytes(32).toString("base64url");
  return { key, keyHash: hashApiKey(key) };
}

/**
 * Resolves an api key to its ACTIVE registration.
 * Returns undefined for malformed keys (no store hit) and for revoked records.
 */
export async function lookupAgentByKey(
  store: AgentRegistrationStore,
  key: string,
): Promise<AgentRegistration | undefined> {
  if (!isApiKeyFormat(key)) return undefined;
  const rec = await store.byKeyHash(hashApiKey(key));
  if (!rec || rec.status !== "active") return undefined;
  return rec;
}

/** Revokes the api key bound to agentId. Idempotent. */
export async function revokeApiKey(
  store: AgentRegistrationStore,
  agentId: string,
  actor?: string,
): Promise<boolean> {
  return store.revoke(agentId, actor);
}
