/**
 * EPIC-205 (SLICE-205-3): SaSame GEC interop client — OAuth 2.1 + PKCE S256
 * + EIP-191 wallet auth, as an external public client against their live
 * Production provider path.
 *
 * Phases:
 *   --phase=rehearsal  read-only: Public MCP (keyless) gec_open_demands
 *   --phase=bid        full: CIMD → authorize → EIP-191 wallet → consent
 *                      → token exchange → gec_bid_submit (5,000,000 microUSDC)
 *   --phase=tools      full auth → tools/list (schema dump)
 *   --phase=award      full auth → gec_award_accept + gec_deliverable_submit
 *   --phase=verify     full auth → read-only inspection (demand/bids/outcome)
 *                      → criteria matrix; gec_verification_submit ONLY with
 *                      --verdict=PASS|REVISE|FAIL --submit (SLICE-205-10)
 *
 * Buyer phases (SLICE-209-2, D-209-7):
 *   --phase=project    sasame_run role=buyer action=draft — Production Project
 *   --phase=demand     sasame_run role=buyer action=draft — Demand, cap
 *                      3,500,000 microUSDC (D-209-4), deadline T+7d
 *   --phase=publish    sasame_run role=buyer action=publish (confirmed in auto)
 *   --phase=lifecycle  sasame_run role=buyer action=status — bids→award→delivery
 *   Flags: --submit flips execution_mode plan_only→auto (writes run only
 *   post-audit 209-3/209-4); --project=<id> --demand=<id> --state=<path>
 *   Idempotency: sasame_run has no idempotency_key (additionalProperties:false)
 *   — client-side dedupe via persisted buyer-state.json in the 209 evidence dir.
 *
 * In SLICE-205-3 both phases STOP before the first live network call —
 * live execution is gated to SLICE-205-5 (rehearsal, post-audit) and
 * SLICE-205-6 (bid). Tests cover the pure functions only.
 *
 * Env:
 *   GEC_INTEROP_PRIVATE_KEY=0x...  buyer wallet (EIP-191 auth + funded Base USDC — post-209 it is NO LONGER zero-funds)
 *   GEC_INTEROP_ADDRESS=0x...      its address (independent check vs key)
 *   GEC_CLIENT_BASE=https://agentbadge.xyz  (our origin; CIMD + callback under it)
 *   EVIDENCE_DIR=docs/EPICS/205-sasame-gec-interop/evidence  transcript target
 *
 * Redaction contract (evidence/REDACTION-CHECKLIST.md): transcripts are built
 * by WHITELIST — {step, method, path, status, ms, note, responseShape}. No
 * headers, no cookies, no tokens, no signatures, no challenge bodies ever
 * reach the transcript — values for denylisted keys are masked BEFORE write.
 */

import { createHash, createHmac, randomBytes } from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, http, parseAbi } from "viem";
import { base } from "viem/chains";
import type { Hex, LocalAccount } from "viem";
import { existsSync, mkdirSync, openSync, closeSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

// ─── Their endpoints (from provider_action.machine_entry, baseline-2026-10-23) ─
export const GEC_ENDPOINTS = {
  openDemandsApi: "https://sasame.online/api/gec/open-demands",
  publicMcp: "https://live-vps.sasame.online/public-mcp", // keyless — rehearsal
  authorize: "https://live-sasame.sasame.online/authorize",
  challenge: "https://sasame.online/account/market/api/wallet/challenge",
  verify: "https://sasame.online/account/market/api/wallet/verify",
  consent: "https://sasame.online/account/mcp/participant-consent",
  token: "https://live-sasame.sasame.online/token",
  resource: "https://live-sasame.sasame.online/mcp", // User MCP — gec_bid_submit
  origin: "https://sasame.online",
  chainId: "0x2105", // Base mainnet
  scope: "gec.read gec.write",
} as const;

/** Canonical buyer wallet (D-209-2) — the funded identity the interop key
 * MUST derive. Audit N-11: pinning it here means a wrong .env key fails
 * closed before any write, instead of passing the funding gate on its own
 * unrelated USDC balance. */
export const BUYER_ADDRESS = "0x3bF7bf14c839AC615F87cDeDe344dF01B9cFb89f";
export const GEC_TARGET_DEMAND = "demand:owner:aefcd63292d520374a1c2ac7fca6a8a5";
export const GEC_BID_AMOUNT_MINOR = "5000000"; // 5 USDC = max_budget_minor
export const GEC_TARGET_AWARD = "award:155c2787a74b57b557dc6a69d3d4fb56";

// SLICE-205-10: reciprocal INDEPENDENT_AGENT verification — Shawn/AgentPay's
// award on the external-revenue demand (request: comments/2410.md, 2026-10-24).
// Our wallet is verifier here (≠ owner, ≠ worker) — worker on our own award,
// verifier on theirs.
export const GEC_VERIFY_AWARD = "award:5a8d25b52436ec1779757050f4f47242";
export const GEC_VERIFY_DELIVERABLE = "deliverable:1bc4966a12177feeb19c416b02114762";

export const GEC_CLIENT_DOC_PATH = "/.well-known/gec-client.json";
export const GEC_CALLBACK_PATH = "/api/gec/callback";

export function clientBase(): string {
  return (process.env.GEC_CLIENT_BASE ?? "https://agentbadge.xyz").replace(/\/+$/, "");
}

export function clientId(): string {
  return `${clientBase()}${GEC_CLIENT_DOC_PATH}`;
}

export function redirectUri(): string {
  return `${clientBase()}${GEC_CALLBACK_PATH}`;
}

// ─── PKCE (RFC 7636, S256 — public client, OAuth 2.1) ────────────────────────

export function base64url(buf: Buffer | Uint8Array): string {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function pkce(): { verifier: string; challenge: string } {
  // 64 random bytes = 512 bits entropy (≥256-bit FAPI-style floor)
  const verifier = base64url(randomBytes(64));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

// ─── state ↔ verifier binding (audit H-1) ────────────────────────────────────
// state = base64url(seed || base64url(hmac-sha256(verifier, seed))) — opaque to
// outsiders but cryptographically bound to THIS flow's verifier. On callback,
// verifyState() recomputes the tag with the in-memory verifier and compares;
// a transplanted state (CSRF / code-injection from another flow) fails closed.

export function makeState(verifier: string): string {
  const seed = base64url(randomBytes(16));
  const tag = createHmac("sha256", verifier).update(seed).digest("base64url");
  return `${seed}.${tag}`;
}

export function verifyState(state: string, verifier: string): boolean {
  const dot = state.indexOf(".");
  if (dot <= 0 || dot === state.length - 1) return false;
  const seed = state.slice(0, dot);
  const tag = state.slice(dot + 1);
  const expect = createHmac("sha256", verifier).update(seed).digest("base64url");
  return tag === expect;
}

// ─── Authorize URL (machine_entry step 1) ────────────────────────────────────

export interface AuthorizeParams {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  authorizeUrl?: string;
  resource?: string;
  scope?: string;
}

export function buildAuthorizeUrl(p: AuthorizeParams): string {
  const u = new URL(p.authorizeUrl ?? GEC_ENDPOINTS.authorize);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", p.clientId);
  u.searchParams.set("redirect_uri", p.redirectUri);
  u.searchParams.set("scope", p.scope ?? GEC_ENDPOINTS.scope);
  u.searchParams.set("resource", p.resource ?? GEC_ENDPOINTS.resource);
  u.searchParams.set("state", p.state);
  u.searchParams.set("code_challenge", p.codeChallenge);
  u.searchParams.set("code_challenge_method", "S256");
  return u.toString();
}

// ─── Cookie jar (machine_entry: PRESERVE_HTTP_COOKIE_JAR) ────────────────────

export interface CookieJar {
  /** Store name=value pairs from a Response's Set-Cookie headers, scoped to the response's own origin. */
  capture(res: Response, origin: string): void;
  /** Cookie header value for requests to `origin`, or undefined when empty. */
  header(origin: string): string | undefined;
  /** Cookie names held per origin (never values — for debugging/transcripts). */
  names(): Record<string, string[]>;
}

// Audit H-2 + M-4: jar is keyed by (origin, name) — cookies captured from one
// origin are NEVER sent to another (the flow touches 3 distinct origins:
// sasame.online, live-sasame.sasame.online, live-vps.sasame.online). An empty
// value deletes the entry (Set-Cookie "name=; Max-Age=0" semantics) instead of
// silently overwriting a live session cookie with an empty string.
export function createCookieJar(): CookieJar {
  const store = new Map<string, Map<string, string>>();
  return {
    capture(res: Response, origin: string) {
      // Audit N-14/M5: with redirect:"follow" the final response may come
      // from another host — scope cookies to the RESPONSE's origin (res.url),
      // not the request URL.
      const effectiveOrigin = res.url ? new URL(res.url).origin : origin;
      const bucket = store.get(effectiveOrigin) ?? new Map<string, string>();
      store.set(effectiveOrigin, bucket);
      for (const line of res.headers.getSetCookie?.() ?? []) {
        const first = line.split(";", 1)[0];
        const eq = first.indexOf("=");
        if (eq <= 0) continue; // "=value" (no name) or bare flag — skip
        const name = first.slice(0, eq).trim();
        const value = first.slice(eq + 1).trim();
        if (!name) continue;
        // Audit N-14: Max-Age takes precedence over Expires; <=0 (incl. -1,
        // "00") means delete. A past Expires deletes only when no Max-Age.
        const maxAge = /;\s*max-age\s*=\s*(-?\d+)/i.exec(line)?.[1];
        const expires = /;\s*expires\s*=\s*([^;]+)/i.exec(line)?.[1];
        const expiresPast = maxAge === undefined && expires !== undefined
          && Date.parse(expires) <= Date.now();
        if (value === "" || (maxAge !== undefined && Number(maxAge) <= 0) || expiresPast) {
          bucket.delete(name);
        } else bucket.set(name, value);
      }
      if (bucket.size === 0) store.delete(effectiveOrigin);
    },
    header(origin: string) {
      const bucket = store.get(origin);
      if (!bucket || bucket.size === 0) return undefined;
      return [...bucket.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    },
    names() {
      const out: Record<string, string[]> = {};
      for (const [origin, bucket] of store) out[origin] = [...bucket.keys()];
      return out;
    },
  };
}

// ─── Transcript + redaction (whitelist fields; denylisted keys masked) ───────

// Audit M4/N-16: denylist matches EXACT key names (plus secret-shaped
// suffixes), not substrings — masking "*state" or "*code*" by substring
// destroyed lifecycle fields like demand_state, error_code and error
// message, which are evidence, not secrets. Exact names still cover the
// genuinely sensitive OAuth keys (state, code, message, nonce).
// Re-audit 2 N-16: `message` removed — it is signed plaintext/challenge text
// and error diagnostics, NOT a credential; masking it hid what we signed and
// destroyed error responses. `code` stays: it IS the OAuth authorization code.
const SECRET_KEY_EXACT = new Set([
  "authorization", "proxy-authorization", "cookie", "set-cookie",
  "token", "access_token", "refresh_token", "id_token", "token_type",
  "signature", "challenge", "code", "code_verifier", "state",
  "client_secret", "private_key", "secret", "mcp_state", "mcp_base",
  "session", "session_id", "sessionid", "mcp-session-id", "mcp_session_id",
  "bearer", "jwt", "nonce", "api_key", "apikey", "password", "otp",
  "credential", "verifier",
]);
const SECRET_KEY_SUFFIX = /_(token|secret|key|password|signature|verifier)$/i;
function isSecretKey(k: string): boolean {
  return SECRET_KEY_EXACT.has(k.toLowerCase()) || SECRET_KEY_SUFFIX.test(k);
}

/** Value-level patterns that are secret regardless of the key name. */
const SECRET_VALUE_RE = [
  /0x[0-9a-fA-F]{64}\b/g, // private-key / hash-shaped hex
  /\bBearer\s+[A-Za-z0-9._~+\/-]+={0,2}/gi,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, // JWT
  /\bsessionid=[^\s;"']+/gi,
];

function redactString(s: string): string {
  let out = s;
  for (const re of SECRET_VALUE_RE) out = out.replace(re, "<redacted>");
  // MCP tool results embed JSON inside content[].text — parse and scrub it
  // instead of letting nested tokens ride through as opaque strings.
  if (out.length > 1 && (out.startsWith("{") || out.startsWith("["))) {
    try {
      const parsed = JSON.parse(out) as unknown;
      if (parsed && typeof parsed === "object") {
        out = JSON.stringify(redact(parsed));
      }
    } catch { /* not JSON — leave as text */ }
  }
  return out;
}

export function redact<T>(value: T): T {
  if (Array.isArray(value)) return value.map(redact) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isSecretKey(k) ? "<redacted>" : redact(v);
    }
    return out as T;
  }
  if (typeof value === "string") {
    const scrubbed = redactString(value);
    if (scrubbed.length > 500) {
      return (scrubbed.slice(0, 500) + "…<truncated>") as T;
    }
    return scrubbed as T;
  }
  return value;
}

export interface TranscriptEntry {
  step: string;
  method: string;
  path: string; // path only — never query (queries carry code_challenge/state)
  status: number;
  ms: number;
  note?: string;
  responseShape?: unknown; // redacted + ≤500 chars per string field
}

export class Transcript {
  readonly entries: TranscriptEntry[] = [];

  record(e: TranscriptEntry): void {
    this.entries.push({
      ...e,
      note: e.note === undefined ? undefined : redact(e.note),
      responseShape: e.responseShape === undefined ? undefined : redact(e.responseShape),
    });
  }

  toJSON(): string {
    return JSON.stringify({ recorded_at: new Date().toISOString(), entries: this.entries }, null, 2);
  }
}

/** Shape-only view of a response body: keys preserved, secret values masked. */
export function responseShapeOf(body: unknown): unknown {
  return redact(body);
}

// ─── Fetch wrapper: timing + cookie jar + manual redirects ───────────────────

export interface FetchOpts {
  jar?: CookieJar;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  redirectManual?: boolean;
  /** Bearer access token — used only for the Authorization header, never logged. */
  bearer?: string;
  /** Set false for non-idempotent writes — audit C3: a blind retry can repeat
   * a server-side write whose response was lost (double publish/draft). */
  allowRetry?: boolean;
}

export interface FetchResult {
  status: number;
  ms: number;
  location: string | null;
  /** MCP Streamable HTTP session id from initialize — echoed back on later calls. */
  sessionId: string | null;
  body: unknown; // caller decides what survives via responseShapeOf
}

export async function timedFetch(url: string, opts: FetchOpts = {}): Promise<FetchResult> {
  // Audit N-15: retry is OPT-IN now (allowRetry === true), never default —
  // a write call that forgets the flag can no longer silently retry. A 5xx
  // response is RETURNED (not thrown) after the last attempt so the caller
  // keeps the body for a read-back; only network errors throw.
  const maxAttempts = opts.allowRetry === true ? 3 : 1;
  let lastErr: unknown;
  let lastRes: FetchResult | undefined;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 2000 * attempt));
    try {
      const r = await timedFetchOnce(url, opts);
      if (r.status < 500) return r;
      lastRes = r;
      lastErr = new Error(`HTTP ${r.status}`);
    } catch (e) {
      lastErr = e;
    }
  }
  if (lastRes) return lastRes;
  throw lastErr;
}

async function timedFetchOnce(url: string, opts: FetchOpts = {}): Promise<FetchResult> {
  const origin = new URL(url).origin;
  const headers: Record<string, string> = { ...opts.headers };
  const cookie = opts.jar?.header(origin);
  if (cookie) headers["cookie"] = cookie;
  if (opts.bearer) headers["authorization"] = `Bearer ${opts.bearer}`;

  // Audit M-2: never auto-follow redirects while carrying credentials —
  // WHATWG fetch does not strip Authorization on cross-origin redirects in
  // non-browser runtimes. Bearer/cookie requests go manual-redirect; the
  // caller inspects Location before any follow-up.
  const manual = opts.redirectManual || Boolean(opts.bearer) || Boolean(cookie);

  const t0 = Date.now();
  const res = await fetch(url, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body,
    redirect: manual ? "manual" : "follow",
    signal: AbortSignal.timeout(30_000), // flaky upstream: fail fast, keep transcript
  });
  const ms = Date.now() - t0;

  opts.jar?.capture(res, origin);
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* non-JSON body (HTML/empty) — keep raw text, truncated on record */
  }
  return {
    status: res.status, ms, location: res.headers.get("location"),
    sessionId: res.headers.get("mcp-session-id"), body
  };
}

// ─── EIP-191 personal_sign (machine_entry step 4) ────────────────────────────
// Signature and challenge text are secrets — returned to the caller, never
// recorded into the transcript (mask would catch them, but we don't even try).

// Audit M-3: return the account object, not the raw key — the hex stays in a
// single stack frame here instead of threading through every caller.
export function loadWallet(): { address: `0x${string}`; account: LocalAccount } {
  const key = process.env.GEC_INTEROP_PRIVATE_KEY;
  const address = process.env.GEC_INTEROP_ADDRESS;
  if (!key || !key.startsWith("0x")) {
    throw new Error("GEC_INTEROP_PRIVATE_KEY missing/invalid in env");
  }
  const account = privateKeyToAccount(key as Hex);
  if (address && account.address.toLowerCase() !== address.toLowerCase()) {
    throw new Error(`GEC_INTEROP_ADDRESS mismatch: env=${address} derived=${account.address}`);
  }
  // Audit N-11: the interop key IS the buyer key — a different key that
  // happens to hold ≥3.5 USDC must not pass the publish funding gate.
  if (account.address.toLowerCase() !== BUYER_ADDRESS.toLowerCase()) {
    throw new Error(
      `GEC_INTEROP_PRIVATE_KEY derives ${account.address}, expected buyer ${BUYER_ADDRESS} — refusing`,
    );
  }
  return { address: account.address, account };
}

export async function signChallenge(message: string, account: LocalAccount): Promise<Hex> {
  return account.signMessage({ message });
}

/**
 * Audit H5: blind EIP-191 signing is identity forgery bait — the challenge
 * text and its structured fields must be validated BEFORE signing. Checks
 * what the server claims to send: our wallet address in the message, the
 * expected chain id and origin, a nonce, and an unexpired expiry.
 */
export function assertChallengeShape(
  fields: Record<string, unknown> | undefined,
  address: string,
): void {
  if (!fields) stepFail("challenge-shape", "no challenge object");
  const f = fields!;
  if (typeof f.wallet_address !== "string" ||
    f.wallet_address.toLowerCase() !== address.toLowerCase()) {
    stepFail("challenge-shape", `challenge wallet_address ${String(f.wallet_address)} != signer ${address}`);
  }
  // Audit N-10: every checked field is REQUIRED — a challenge missing them,
  // or with an unparseable expiry, must NOT be signed (was: check-if-defined,
  // which failed open).
  if (f.chain_id !== GEC_ENDPOINTS.chainId) {
    stepFail("challenge-shape", `challenge chain_id ${String(f.chain_id)} != ${GEC_ENDPOINTS.chainId}`);
  }
  const body = f.body as { origin?: string } | undefined;
  if (body?.origin !== GEC_ENDPOINTS.origin) {
    stepFail("challenge-shape", `challenge origin ${String(body?.origin)} != ${GEC_ENDPOINTS.origin}`);
  }
  if (typeof f.nonce !== "string" || f.nonce.length < 8) {
    stepFail("challenge-shape", "challenge nonce missing/too short");
  }
  const exp = Date.parse(String(f.expires_at));
  if (Number.isNaN(exp)) {
    stepFail("challenge-shape", `challenge expires_at ${String(f.expires_at)} missing/unparseable`);
  }
  if (exp <= Date.now()) {
    stepFail("challenge-shape", `challenge expired at ${String(f.expires_at)}`);
  }
  const iat = Date.parse(String(f.issued_at));
  // Re-audit 2 N-10: a present-but-unparseable issued_at is malformed, not
  // absent — fail closed. Absent issued_at → bounded expiry from NOW instead.
  if (f.issued_at !== undefined && f.issued_at !== null && Number.isNaN(iat)) {
    stepFail("challenge-shape", `challenge issued_at ${String(f.issued_at)} unparseable`);
  }
  const windowMs = !Number.isNaN(iat) ? exp - iat : exp - Date.now();
  if (windowMs > 15 * 60 * 1000) {
    stepFail("challenge-shape", `challenge window ${Math.round(windowMs / 60000)}min > 15min — refusing`);
  }
  const msg = String(f.message ?? "");
  if (msg.length === 0 || msg.length > 4000) {
    stepFail("challenge-shape", `challenge message length ${msg.length} out of bounds`);
  }
  if (!msg.toLowerCase().includes(address.toLowerCase())) {
    stepFail("challenge-shape", "challenge message does not contain the signer address — refusing to sign");
  }
  // N-10: the SIGNED text itself must carry the pinned terms — fields alone
  // don't bind what the signature attests to.
  if (!msg.includes(GEC_ENDPOINTS.origin)) {
    stepFail("challenge-shape", "challenge message does not name the expected origin — refusing to sign");
  }
  if (!msg.includes(GEC_ENDPOINTS.chainId) && !msg.includes("8453")) {
    stepFail("challenge-shape", "challenge message does not name the Base chain id — refusing to sign");
  }
  if (!msg.includes(f.nonce as string)) {
    stepFail("challenge-shape", "challenge message does not contain its nonce — refusing to sign");
  }
}

// ─── MCP JSON-RPC (initialize / tools/list / tools/call) ─────────────────────

export interface McpCallResult {
  status: number;
  ms: number;
  result?: unknown;
  error?: unknown;
}

// Audit M-6: incrementing JSON-RPC id — responses can be correlated to their
// requests inside a session; a constant id:1 breaks that pairing.
let mcpRequestId = 0;

export async function mcpCall(
  endpoint: string,
  method: string,
  params: Record<string, unknown>,
  opts: { bearer?: string; jar?: CookieJar; sessionId?: string; allowRetry?: boolean } = {},
): Promise<McpCallResult & { sessionId?: string | null }> {
  const headers: Record<string, string> = {
    "content-type": "application/json", accept: "application/json, text/event-stream",
  };
  if (opts.sessionId) headers["mcp-session-id"] = opts.sessionId;
  const r = await timedFetch(endpoint, {
    method: "POST",
    jar: opts.jar,
    bearer: opts.bearer,
    allowRetry: opts.allowRetry,
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: ++mcpRequestId, method, params }),
  });
  // SSE framing: data: {...} lines — unwrap the last JSON payload if present
  let b = r.body as { result?: unknown; error?: unknown };
  if (typeof r.body === "string" && r.body.startsWith("event:") || (typeof r.body === "string" && r.body.includes("data:"))) {
    const dataLines = (r.body as string).split("\n")
      .filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim());
    for (let i = dataLines.length - 1; i >= 0; i--) {
      try { b = JSON.parse(dataLines[i]); break; } catch { /* keep looking */ }
    }
  }
  return { status: r.status, ms: r.ms, result: b?.result, error: b?.error, sessionId: r.sessionId };
}

// ─── Phase plans (live execution: 205-5 rehearsal / 205-6 bid) ───────────────

export const REHEARSAL_STEPS = [
  "GET openDemandsApi — projection CURRENT + target demand OPEN",
  "GET authorize (PKCE S256, CIMD client_id, resource=User MCP) → 302",
  "Parse mcp_state/mcp_base from consent Location",
  "POST challenge {wallet_address, chain_id:0x2105} Origin=sasame.online",
  "EIP-191 personal_sign challenge.message (local, secret — not logged)",
  "POST verify {challenge fields + signature} (cookie jar)",
  "POST consent {mcp_state,mcp_base} → follow callback → code/state",
  "POST token exchange (authorization_code + code_verifier, form-encoded)",
  "MCP initialize on User MCP (bearer) → mcp-session-id",
  "MCP tools/list — capture gec_bid_submit schema",
  "MCP initialize on publicMcp (keyless) → tools/call gec_open_demands — read-only finish",
] as const;

export const BID_STEPS = [
  "GET authorize (PKCE S256, CIMD client_id, resource=User MCP) → 302 to Account Control",
  "Parse mcp_state/mcp_base from consent Location header",
  "POST challenge {address, chain_id:0x2105} Origin=sasame.online (cookie jar)",
  "EIP-191 personal_sign challenge.message (local, secret — not logged)",
  "POST verify {challenge fields + signature} (cookie jar)",
  "POST consent {mcp_state,mcp_base} → follow gateway callback → code/state on redirect_uri",
  "POST token exchange (authorization_code + code_verifier + resource)",
  "MCP tools/call gec_bid_submit on User MCP (bearer) — demand aefcd6…, 5,000,000 microUSDC",
] as const;

export const TOOLS_STEPS = [
  "Full OAuth2.1+PKCE+EIP-191 chain → bearer + mcp-session-id (same as bid)",
  "MCP tools/list on User MCP — capture ALL tool schemas (gec_award_accept, gec_deliverable_submit, …)",
] as const;

export const AWARD_STEPS = [
  "Full OAuth2.1+PKCE+EIP-191 chain → bearer + mcp-session-id",
  "MCP tools/call gec_award_accept — award 155c27…fb56",
  "MCP tools/call gec_deliverable_submit — redacted friction report",
] as const;

export const VERIFY_STEPS = [
  "Full OAuth2.1+PKCE+EIP-191 chain → bearer + mcp-session-id",
  "MCP tools/list — confirm gec_verification_submit + read-tool schemas (drift check vs 2026-10-23)",
  "MCP tools/call gec_demand_search — locate the award's demand + frozen criteria",
  "MCP tools/call gec_bid_list per demand — find the award's bid + worker",
  "MCP tools/call gec_outcome_get per project — award/deliverable evidence",
  "Criteria↔evidence matrix printed — STOP unless --verdict + --submit",
  "MCP tools/call gec_verification_submit — PASS|REVISE|FAIL + evidence_refs + note",
] as const;

export type GecPhase =
  | "rehearsal" | "bid" | "tools" | "award" | "verify"
  | "project" | "demand" | "publish" | "lifecycle";

const BUYER_PHASES: readonly GecPhase[] = ["project", "demand", "publish", "lifecycle"];

export function parsePhase(argv: string[]): GecPhase {
  const arg = argv.find((a) => a.startsWith("--phase="));
  const phase = arg?.slice(arg.indexOf("=") + 1) as GecPhase | undefined;
  if (phase === "rehearsal" || phase === "bid" || phase === "tools" || phase === "award" || phase === "verify") return phase;
  if (phase && BUYER_PHASES.includes(phase)) return phase;
  throw new Error("usage: bun run scripts/gec-interop.mts --phase=rehearsal|bid|tools|award|verify|project|demand|publish|lifecycle [--verdict=PASS|REVISE|FAIL] [--submit] [--out=<transcript.json>] [--report=<file>] [--project=<id>] [--demand=<id>] [--state=<path>]");
}

function outPath(argv: string[]): string | undefined {
  // Audit M8: empty --out= throws like every other strict flag — a silent
  // no-op flag looks like a typo that loses the transcript.
  return argValue(argv, "out");
}

// ─── SLICE-205-5: live rehearsal — full OAuth cycle, read-only finish ────────
// Every step is recorded as {step, method, path, status, ms, responseShape}.
// path NEVER contains query (code_challenge/state live there). Secrets —
// signature, bearer, cookies, challenge text — never enter the transcript;
// the redact() denylist is a second belt, not the first.

function stepFail(step: string, what: unknown): never {
  // Audit M4: embedded error/result payloads go through redact — thrown
  // errors land in CI logs and stderr where raw session data must not.
  const s = typeof what === "string" ? what : JSON.stringify(redact(what));
  throw new Error(`[kill-gate] ${step}: ${s}`);
}

async function authenticateUserMcp(t: Transcript): Promise<{ bearer: string; jar: CookieJar; sessionId: string }> {
  const jar = createCookieJar();
  const { address, account } = loadWallet();
  const { verifier, challenge } = pkce();
  const state = makeState(verifier);

  // 0. Projection: target demand must still be OPEN
  const proj = await timedFetch(GEC_ENDPOINTS.openDemandsApi, { jar, allowRetry: true });
  t.record({
    step: "open-demands-projection", method: "GET", path: "/api/gec/open-demands",
    status: proj.status, ms: proj.ms, responseShape: responseShapeOf(proj.body)
  });
  if (proj.status !== 200) stepFail("projection", `HTTP ${proj.status}`);

  // 1. GET authorize → 302 Location (carries mcp_state/mcp_base → consent)
  const authUrl = buildAuthorizeUrl({
    clientId: clientId(), redirectUri: redirectUri(),
    state, codeChallenge: challenge,
  });
  const auth = await timedFetch(authUrl, { jar, redirectManual: true, allowRetry: true });
  t.record({
    step: "authorize", method: "GET", path: "/authorize",
    status: auth.status, ms: auth.ms,
    responseShape: { location: auth.location ? "<redacted>" : null }
  });
  if (auth.status !== 302 || !auth.location) stepFail("authorize", `expected 302+Location, got ${auth.status}`);

  // 2. Parse mcp_state/mcp_base from Location
  const loc = new URL(auth.location!, GEC_ENDPOINTS.origin);
  const mcpState = loc.searchParams.get("mcp_state");
  const mcpBase = loc.searchParams.get("mcp_base");
  if (!mcpState || !mcpBase) stepFail("authorize-location", "no mcp_state/mcp_base in Location");

  // 3. POST challenge {wallet_address, chain_id} — Origin pinned (live-probed:
  // field is wallet_address, NOT address — wrong key → invalid_wallet_address)
  const chal = await timedFetch(GEC_ENDPOINTS.challenge, {
    jar, method: "POST", allowRetry: true, // idempotent — re-posting just issues a fresh challenge
    headers: { "content-type": "application/json", origin: GEC_ENDPOINTS.origin },
    body: JSON.stringify({ wallet_address: address, chain_id: GEC_ENDPOINTS.chainId }),
  });
  t.record({
    step: "challenge", method: "POST", path: "/account/market/api/wallet/challenge",
    status: chal.status, ms: chal.ms, responseShape: responseShapeOf(chal.body)
  });
  if (chal.status !== 200 && chal.status !== 201) stepFail("challenge", `HTTP ${chal.status}`);
  // Their shape: {ok, challenge: {wallet_address, chain_id, purpose, nonce,
  // issued_at, expires_at, body:{origin,chain_id}, message}} — sign .message
  const chalBody = chal.body as { ok?: boolean; challenge?: Record<string, unknown> };
  const chalFields = chalBody.challenge;
  const message = chalFields?.message as string | undefined;
  if (!chalFields || !message) stepFail("challenge", "no challenge.message in response");

  // Audit H5: validate the challenge (address, chain, origin, nonce, expiry,
  // message contains the signer) BEFORE EIP-191 signing — this key now holds
  // funds, blind signing is identity forgery.
  assertChallengeShape(chalFields, address);

  // 4. EIP-191 personal_sign — LOCAL, signature never recorded
  const signature = await signChallenge(message, account);

  // 5. POST verify — returned challenge fields + signature (cookie jar keeps session)
  const verify = await timedFetch(GEC_ENDPOINTS.verify, {
    jar, method: "POST", // single attempt — verify consumes the challenge server-side
    headers: { "content-type": "application/json", origin: GEC_ENDPOINTS.origin },
    body: JSON.stringify({ ...chalFields, signature }),
  });
  t.record({
    step: "verify", method: "POST", path: "/account/market/api/wallet/verify",
    status: verify.status, ms: verify.ms, responseShape: responseShapeOf(verify.body)
  });
  if (verify.status !== 200 && verify.status !== 302) stepFail("verify", `HTTP ${verify.status}`);

  // 6. POST participant-consent {mcp_state, mcp_base} → 302 chain → our callback
  const consent = await timedFetch(GEC_ENDPOINTS.consent, {
    jar, method: "POST",
    headers: { "content-type": "application/json", origin: GEC_ENDPOINTS.origin },
    body: JSON.stringify({ mcp_state: mcpState, mcp_base: mcpBase }),
    redirectManual: true,
  });
  t.record({
    step: "participant-consent", method: "POST", path: "/account/mcp/participant-consent",
    status: consent.status, ms: consent.ms,
    responseShape: { location: consent.location ? "<redacted>" : null }
  });
  if (!consent.location) stepFail("consent", `expected redirect Location, got ${consent.status}`);

  // 7. Follow redirect chain manually until our callback (credentials stay manual)
  let hop: string | null = consent.location;
  let code: string | null = null;
  let retState: string | null = null;
  for (let i = 0; i < 5 && hop; i++) {
    const next = new URL(hop, GEC_ENDPOINTS.origin);
    if (next.origin === new URL(redirectUri()).origin && next.pathname === GEC_CALLBACK_PATH) {
      code = next.searchParams.get("code");
      retState = next.searchParams.get("state");
      // RFC 9207 nit: when the AS sends iss, it must be the authorize origin.
      const iss = next.searchParams.get("iss");
      if (iss !== null && iss !== new URL(GEC_ENDPOINTS.authorize).origin) {
        stepFail("callback-iss", `iss ${iss} != ${new URL(GEC_ENDPOINTS.authorize).origin}`);
      }
      break;
    }
    const r = await timedFetch(next.toString(), { jar, redirectManual: true, allowRetry: true });
    t.record({
      step: `consent-redirect-${i + 1}`, method: "GET",
      path: next.pathname, status: r.status, ms: r.ms,
      responseShape: { location: r.location ? "<redacted>" : null }
    });
    hop = r.location;
  }
  if (!code) stepFail("callback", "redirect chain ended without code on our redirect_uri");

  // Audit H-1: state must be the HMAC-bound one we generated for THIS verifier
  if (!retState || !verifyState(retState, verifier)) stepFail("state-verify", "returned state failed verifier binding");

  // 8. POST token exchange — RFC 6749: form-encoded, not JSON.
  // bearer comes back, NEVER logged
  const tok = await timedFetch(GEC_ENDPOINTS.token, {
    jar, method: "POST", // single attempt — the auth code is one-time-use
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code", code,
      client_id: clientId(), redirect_uri: redirectUri(),
      code_verifier: verifier, resource: GEC_ENDPOINTS.resource,
    }).toString(),
  });
  t.record({
    step: "token-exchange", method: "POST", path: "/token",
    status: tok.status, ms: tok.ms, responseShape: responseShapeOf(tok.body)
  });
  if (tok.status !== 200) stepFail("token", `HTTP ${tok.status}`);
  const bearer = (tok.body as { access_token?: string }).access_token;
  if (!bearer) stepFail("token", "no access_token in response");

  // 9. MCP initialize on User MCP (bearer)
  const init = await mcpCall(GEC_ENDPOINTS.resource, "initialize", {
    protocolVersion: "2025-03-26", capabilities: {},
    clientInfo: { name: "agentbadge-gec-interop", version: "0.1.0" },
  }, { bearer, jar, allowRetry: true });
  t.record({
    step: "mcp-initialize", method: "POST", path: "/mcp",
    status: init.status, ms: init.ms, responseShape: responseShapeOf(init.result ?? init.error)
  });
  if (init.error || init.status !== 200) stepFail("mcp-initialize", init.error ?? init.status);
  // MCP Streamable HTTP: session id issued on initialize must be echoed on all later calls
  const sessionId = init.sessionId ?? undefined;
  if (!sessionId) stepFail("mcp-initialize", "no mcp-session-id in initialize response headers");
  await mcpCall(GEC_ENDPOINTS.resource, "notifications/initialized", {}, { bearer, jar, sessionId, allowRetry: true });

  return { bearer, jar, sessionId };
}

async function runRehearsal(t: Transcript): Promise<void> {
  const { bearer, jar, sessionId } = await authenticateUserMcp(t);

  // 10. tools/list — gec_bid_submit schema is 205-6 input, persisted in evidence (not secret)
  const tools = await mcpCall(GEC_ENDPOINTS.resource, "tools/list", {}, { bearer, jar, sessionId, allowRetry: true });
  if (tools.error || tools.status !== 200) stepFail("mcp-tools-list", tools.error ?? tools.status);
  const toolList = (tools.result as { tools?: { name: string; inputSchema?: unknown }[] })?.tools ?? [];
  const bidTool = toolList.find((x) => x.name === "gec_bid_submit");
  t.record({
    step: "mcp-tools-list", method: "POST", path: "/mcp",
    status: tools.status, ms: tools.ms,
    responseShape: {
      toolNames: toolList.map((x) => x.name),
      gec_bid_submit_schema: bidTool?.inputSchema ?? null,
    }
  });
  if (!bidTool) stepFail("mcp-tools-list", "gec_bid_submit not advertised by User MCP");
  console.log(`[gec-interop] gec_bid_submit schema captured (${toolList.length} tools advertised)`);

  // 11. Read-side finish: gec_open_demands lives on keyless publicMcp —
  // "Public MCP is keyless discovery. Authenticated User MCP owns wallet-bound
  // participant actions." (their serverInfo.instructions, captured 2026-10-23)
  const pubInit = await mcpCall(GEC_ENDPOINTS.publicMcp, "initialize", {
    protocolVersion: "2025-03-26", capabilities: {},
    clientInfo: { name: "agentbadge-gec-interop", version: "0.1.0" },
  }, { jar, allowRetry: true });
  t.record({
    step: "public-mcp-initialize", method: "POST", path: "/public-mcp",
    status: pubInit.status, ms: pubInit.ms,
    responseShape: responseShapeOf((pubInit.result as { serverInfo?: unknown })?.serverInfo ?? pubInit.error)
  });
  if (pubInit.error || pubInit.status !== 200) stepFail("public-mcp-initialize", pubInit.error ?? pubInit.status);
  const pubSession = pubInit.sessionId ?? undefined;
  // Their server binds the session via cookies + notifications/initialized;
  // without it tools/call answers "Tool not found" even though tools/list shows it.
  await mcpCall(GEC_ENDPOINTS.publicMcp, "notifications/initialized", {}, { jar, sessionId: pubSession, allowRetry: true });

  const demands = await mcpCall(GEC_ENDPOINTS.publicMcp, "tools/call",
    { name: "gec_open_demands", arguments: {} }, { jar, sessionId: pubSession, allowRetry: true });
  const isErr = (demands.result as { isError?: boolean })?.isError;
  t.record({
    step: "gec_open_demands", method: "POST", path: "/public-mcp",
    status: demands.status, ms: demands.ms, responseShape: responseShapeOf(demands.result ?? demands.error)
  });
  if (demands.error || demands.status !== 200 || isErr) stepFail("gec_open_demands", demands.error ?? demands.result);

  // Acceptance: print OPEN demand count — result shape is their JSON payload
  // (MCP tools/call wraps in content[]; text part carries the JSON).
  let openCount: number | null = null;
  const content = (demands.result as { content?: { type: string; text?: string }[] })?.content ?? [];
  for (const part of content) {
    if (part.type !== "text" || !part.text) continue;
    try {
      const parsed = JSON.parse(part.text) as { demands?: unknown[]; summary?: { demand_count?: number; open_count?: number } };
      openCount = parsed.summary?.open_count ?? parsed.summary?.demand_count ?? parsed.demands?.length ?? null;
    } catch { /* keep looking */ }
  }
  console.log(`[gec-interop] rehearsal complete — gec_open_demands returned ${openCount ?? "?"} demands, no bid submitted`);
}

// ─── SLICE-205-6: live bid — same OAuth chain, terminal write gec_bid_submit ──
// Amount = max_budget_minor from the demand projection (5,000,000 microUSDC).
// proposal/capability_refs describe the evidence package we deliver.
// Audit H4: the write is now gated on --submit like every other phase, and
// the idempotency key is DETERMINISTIC — a re-run dedupes server-side
// instead of minting a fresh duplicate bid.
function bidIdempotencyKey(): string {
  const h = createHash("sha256")
    .update(`bid|${GEC_TARGET_DEMAND}|${GEC_BID_AMOUNT_MINOR}`)
    .digest("hex").slice(0, 8);
  return `agentbadge-205-bid-aefcd6-${h}`;
}

async function runBid(t: Transcript, argv: string[]): Promise<void> {
  const { bearer, jar, sessionId } = await authenticateUserMcp(t);

  const bidArgs = {
    demand_id: GEC_TARGET_DEMAND,
    idempotency_key: bidIdempotencyKey(),
    amount_minor: GEC_BID_AMOUNT_MINOR,
    expected_completion: demandDeadlineFrom(new Date()), // T+7d — not a stale literal
    capability_refs: [
      "mcp_interoperability", "oauth_2_1", "wallet_authentication",
      "protocol_tracing", "evidence_verification",
    ],
    proposal:
      "Independent external provider (AgentBadge, agentbadge.xyz) delivering " +
      "bounded redacted protocol evidence: full CIMD/OAuth2.1-PKCE cycle, " +
      "EIP-191 wallet verification, authenticated User MCP session, plus a " +
      "concise interoperability + friction report. Evidence: JSON transcript " +
      "of every step (no secrets) + screenshots. Burner wallet 0x3bF7...Fb89f " +
      "is independently controlled and unaffiliated with SaSame/Owner/Pancho.",
  };

  // Audit H4: the bid is an irreversible write — same --submit gate as the
  // buyer phases; no more default-write on phase run.
  if (!argv.includes("--submit")) {
    console.log(`[gec-interop] bid dry-run — args ready (idem=${bidArgs.idempotency_key}), pass --submit to send`);
    t.record({ step: "gec_bid_submit-dry", method: "POST", path: "/mcp", status: 0, ms: 0, note: "not sent — --submit required" });
    return;
  }
  const bid = await mcpCall(GEC_ENDPOINTS.resource, "tools/call",
    { name: "gec_bid_submit", arguments: bidArgs }, { bearer, jar, sessionId, allowRetry: false });
  const isErr = (bid.result as { isError?: boolean })?.isError;
  t.record({
    step: "gec_bid_submit", method: "POST", path: "/mcp",
    status: bid.status, ms: bid.ms,
    note: `demand=aefcd6… amount=${GEC_BID_AMOUNT_MINOR} idem=${bidArgs.idempotency_key}`,
    responseShape: responseShapeOf(bid.result ?? bid.error)
  });
  if (bid.error || bid.status !== 200 || isErr) {
    stepFail("gec_bid_submit", bid.error ?? bid.result);
  }
  console.log("[gec-interop] bid submitted — 5,000,000 microUSDC on demand aefcd6…");
}

async function runTools(t: Transcript): Promise<void> {
  const { bearer, jar, sessionId } = await authenticateUserMcp(t);

  const tools = await mcpCall(GEC_ENDPOINTS.resource, "tools/list", {}, { bearer, jar, sessionId, allowRetry: true });
  if (tools.error || tools.status !== 200) stepFail("mcp-tools-list", tools.error ?? tools.status);
  const toolList = (tools.result as { tools?: { name: string; description?: string; inputSchema?: unknown }[] })?.tools ?? [];
  // Tool schemas are the public API contract — recording them in full is
  // safe (no secrets) and is the input for the award phase.
  t.record({
    step: "mcp-tools-list", method: "POST", path: "/mcp",
    status: tools.status, ms: tools.ms,
    responseShape: { tools: toolList.map((x) => ({ name: x.name, inputSchema: x.inputSchema ?? null })) }
  });
  for (const x of toolList) {
    console.log(`[gec-interop] tool: ${x.name}`);
    console.log(`  schema: ${JSON.stringify(x.inputSchema)}`);
  }
}

// ─── Award phase: accept the landed award + submit the redacted report ──────
// Award id comes from the owner's notification (LinkedIn) and is pinned in
// GEC_TARGET_AWARD; arg shapes adapt to the live tools/list schemas.

function loadReport(): string {
  const file = argValue(process.argv, "report")
    ?? resolve(SCRIPT_DIR, "../../../docs/EPICS/205-sasame-gec-interop/evidence/deliverable-summary-2026-10-23.md");
  return readFileSync(file, "utf8");
}

// Live schemas captured 2026-10-23 via --phase=tools:
//   gec_award_accept        required: award_id
//   gec_deliverable_submit  required: award_id, idempotency_key(8-128),
//                           summary(1-4000), evidence_refs(1-50, each <=1000)
function buildAwardAcceptArgs(): Record<string, unknown> {
  return { award_id: GEC_TARGET_AWARD };
}

function deliverableIdempotencyKey(): string {
  const h = createHash("sha256")
    .update(`deliver|${GEC_TARGET_AWARD}`)
    .digest("hex").slice(0, 8);
  return `agentbadge-205-deliver-155c27-${h}`;
}

function buildDeliverableArgs(summary: string): Record<string, unknown> {
  return {
    award_id: GEC_TARGET_AWARD,
    idempotency_key: deliverableIdempotencyKey(),
    summary,
    evidence_refs: [
      "https://agentbadge.xyz/blog/gec-interop-field-report - published field report (full trace)",
      "https://youtu.be/YCBldVafDmI - narrated 3-min screen capture of the run",
      "evidence/rehearsal-2026-10-23.json - redacted transcript, read-only cycle",
      "evidence/bid-2026-10-23.json - redacted transcript, write cycle to gec_bid_submit",
      "evidence/friction-report-en.md - full interop + friction report (8 findings, fixes)",
      "evidence/tools-discovery-2026-10-23.json - redacted transcript of this session",
      "scripts/gec-interop.mts - single-file client used (Bun/TS, no MCP SDK)",
    ],
    artifact_refs: [
      "https://agentbadge.xyz/blog/gec-interop-field-report",
      "https://youtu.be/YCBldVafDmI",
    ],
  };
}

async function runAward(t: Transcript, argv: string[]): Promise<void> {
  // Audit H4: award-accept + deliverable-submit are irreversible writes —
  // gate on --submit exactly like bid/buyer phases.
  if (!argv.includes("--submit")) {
    console.log("[gec-interop] award dry-run — pass --submit to send gec_award_accept + gec_deliverable_submit");
    return;
  }
  const { bearer, jar, sessionId } = await authenticateUserMcp(t);

  // Re-list tools so the transcript carries the exact schemas this call used.
  const tools = await mcpCall(GEC_ENDPOINTS.resource, "tools/list", {}, { bearer, jar, sessionId, allowRetry: true });
  if (tools.error || tools.status !== 200) stepFail("mcp-tools-list", tools.error ?? tools.status);
  const toolList = (tools.result as { tools?: { name: string; inputSchema?: unknown }[] })?.tools ?? [];
  const acceptTool = toolList.find((x) => x.name === "gec_award_accept");
  const deliverTool = toolList.find((x) => x.name === "gec_deliverable_submit");
  t.record({
    step: "mcp-tools-list", method: "POST", path: "/mcp",
    status: tools.status, ms: tools.ms,
    responseShape: {
      gec_award_accept_schema: acceptTool?.inputSchema ?? null,
      gec_deliverable_submit_schema: deliverTool?.inputSchema ?? null,
    }
  });
  if (!acceptTool) stepFail("mcp-tools-list", "gec_award_accept not advertised by User MCP");
  if (!deliverTool) stepFail("mcp-tools-list", "gec_deliverable_submit not advertised by User MCP");

  const acceptArgs = buildAwardAcceptArgs();
  const accept = await mcpCall(GEC_ENDPOINTS.resource, "tools/call",
    { name: "gec_award_accept", arguments: acceptArgs }, { bearer, jar, sessionId, allowRetry: false });
  const acceptErr = (accept.result as { isError?: boolean })?.isError;
  t.record({
    step: "gec_award_accept", method: "POST", path: "/mcp",
    status: accept.status, ms: accept.ms,
    note: `award=155c27…fb56 args=${Object.keys(acceptArgs).join(",")}`,
    responseShape: responseShapeOf(accept.result ?? accept.error)
  });
  // Audit N-19: resumable — an "already accepted" refusal means a previous
  // run's accept landed; proceed to the deliverable instead of dying.
  const acceptFailed = accept.error || accept.status !== 200 || acceptErr;
  if (acceptFailed) {
    const blob = JSON.stringify(redact(accept.error ?? accept.result ?? ""));
    // Re-audit 2 N-19: narrow resume terms — bare "accepted"/"state" matched
    // real failures ("invalid state", "already refunded", "state mismatch")
    // and would skip to the deliverable write. Require an explicit "already"
    // or a conflict/409-shaped refusal.
    if (/already\s+(accepted|awarded|taken|exists)|duplicate|conflict|409/i.test(blob)) {
      console.log("[gec-interop] award already accepted server-side — resuming at deliverable");
    } else {
      stepFail("gec_award_accept", accept.error ?? accept.result);
    }
  } else {
    console.log("[gec-interop] award accepted — 155c27…fb56");
  }

  const reportText = loadReport();
  if (reportText.length > 4000) {
    stepFail("deliverable-args", `summary too long: ${reportText.length} > 4000 chars (schema bound)`);
  }
  const deliverArgs = buildDeliverableArgs(reportText);
  const deliver = await mcpCall(GEC_ENDPOINTS.resource, "tools/call",
    { name: "gec_deliverable_submit", arguments: deliverArgs }, { bearer, jar, sessionId, allowRetry: false });
  const deliverErr = (deliver.result as { isError?: boolean })?.isError;
  t.record({
    step: "gec_deliverable_submit", method: "POST", path: "/mcp",
    status: deliver.status, ms: deliver.ms,
    note: `args=${Object.keys(deliverArgs).join(",")} report_bytes=${reportText.length}`,
    responseShape: responseShapeOf(deliver.result ?? deliver.error)
  });
  if (deliver.error || deliver.status !== 200 || deliverErr) {
    stepFail("gec_deliverable_submit", deliver.error ?? deliver.result);
  }
  console.log("[gec-interop] deliverable submitted — redacted friction report");
}

// ─── SLICE-205-10: independent verification of a third-party award ──────────
// Same OAuth chain; the WRITE is gec_verification_submit gated behind
// --verdict + --submit. Without those flags the phase is read-only inspection.
//
// Verdict belongs to the verifier (us), grounded in canonical evidence — never
// in the worker's self-report. The criteria matrix is operator judgment made
// AFTER reading evidence; the script collects evidence and formats the note.

export type VerifyVerdict = "PASS" | "REVISE" | "FAIL";

export interface CriterionAssessment {
  criterion: string; // verbatim frozen acceptance criterion
  met: boolean | null; // null = not determinable from visible evidence
  evidence: string; // what we saw (ref or quote), not the worker's claim
}

/** Deterministic idempotency key per (award, deliverable, verdict): retries of
 * the same verdict dedupe to duplicate:true; a deliberate verdict change is a
 * new key, not a silent overwrite. */
export function verificationIdempotencyKey(
  awardId: string,
  deliverableId: string,
  verdict: VerifyVerdict,
): string {
  const a = awardId.replace(/^award:/, "").slice(0, 12);
  const d = deliverableId.replace(/^deliverable:/, "").slice(0, 8);
  return `agentbadge-205-verify-${a}-${d}-${verdict.toLowerCase()}`;
}

/** Per-criterion note for gec_verification_submit (schema bound: ≤2000 chars). */
export function buildVerdictNote(verdict: VerifyVerdict, rows: CriterionAssessment[]): string {
  const lines = rows.map((r, i) => {
    const mark = r.met === true ? "MET" : r.met === false ? "UNMET" : "INDETERMINATE";
    return `${i + 1}. [${mark}] ${r.criterion} — evidence: ${r.evidence}`;
  });
  let note = `Verdict ${verdict} on outcome evidence (not worker self-report).\n${lines.join("\n")}`;
  if (note.length > 2000) note = note.slice(0, 1997) + "…";
  return note;
}

export function buildVerificationArgs(
  verdict: VerifyVerdict,
  note: string,
  evidenceRefs: string[] = [],
): Record<string, unknown> {
  if (note.length > 2000) throw new Error(`note too long: ${note.length} > 2000 (schema bound)`);
  const args: Record<string, unknown> = {
    award_id: GEC_VERIFY_AWARD,
    deliverable_id: GEC_VERIFY_DELIVERABLE,
    idempotency_key: verificationIdempotencyKey(GEC_VERIFY_AWARD, GEC_VERIFY_DELIVERABLE, verdict),
    verdict,
  };
  if (evidenceRefs.length > 0) args.evidence_refs = evidenceRefs;
  if (note.length > 0) args.note = note;
  return args;
}

/** MCP tools/call wraps payloads in content[]; the JSON lives in a text part. */
export function extractToolPayload(result: unknown): unknown {
  const content = (result as { content?: { type?: string; text?: string }[] })?.content ?? [];
  for (const part of content) {
    if (part.type !== "text" || !part.text) continue;
    try { return JSON.parse(part.text); } catch { /* keep looking */ }
  }
  const sc = (result as { structuredContent?: unknown })?.structuredContent;
  return sc ?? result;
}

function parseVerdict(argv: string[]): VerifyVerdict | undefined {
  const a = argv.find((x) => x.startsWith("--verdict="));
  const v = a?.slice(a.indexOf("=") + 1);
  if (v === "PASS" || v === "REVISE" || v === "FAIL") return v;
  if (v !== undefined) throw new Error("--verdict must be PASS|REVISE|FAIL");
  return undefined;
}

function parseNote(argv: string[]): string {
  return argValue(argv, "note") ?? "";
}

function parseEvidence(argv: string[]): string[] {
  const raw = argValue(argv, "evidence");
  return raw ? raw.split(",").map((s) => s.trim()).filter(Boolean) : [];
}

async function runVerify(t: Transcript, argv: string[]): Promise<void> {
  const { bearer, jar, sessionId } = await authenticateUserMcp(t);

  // 1. Schema drift check: verification + read tools this phase depends on.
  const tools = await mcpCall(GEC_ENDPOINTS.resource, "tools/list", {}, { bearer, jar, sessionId, allowRetry: true });
  if (tools.error || tools.status !== 200) stepFail("mcp-tools-list", tools.error ?? tools.status);
  const toolList = (tools.result as { tools?: { name: string; inputSchema?: unknown }[] })?.tools ?? [];
  const byName = (n: string) => toolList.find((x) => x.name === n);
  const needed = ["gec_verification_submit", "gec_demand_search", "gec_bid_list", "gec_outcome_get"];
  t.record({
    step: "mcp-tools-list", method: "POST", path: "/mcp",
    status: tools.status, ms: tools.ms,
    responseShape: Object.fromEntries(needed.map((n) => [`${n}_schema`, byName(n)?.inputSchema ?? null])),
  });
  for (const n of needed) {
    if (!byName(n)) stepFail("mcp-tools-list", `${n} not advertised by User MCP (schema drift)`);
  }

  const call = async (name: string, args: Record<string, unknown>, step: string) => {
    // Audit N-15: reads may retry; gec_verification_submit is a write —
    // never retried blindly even though its idempotency key would dedupe.
    const r = await mcpCall(GEC_ENDPOINTS.resource, "tools/call",
      { name, arguments: args }, { bearer, jar, sessionId, allowRetry: name !== "gec_verification_submit" });
    const isErr = (r.result as { isError?: boolean })?.isError;
    t.record({
      step, method: "POST", path: "/mcp",
      status: r.status, ms: r.ms,
      note: `tool=${name} args=${Object.keys(args).join(",") || "none"}`,
      responseShape: responseShapeOf(r.result ?? r.error),
    });
    if (r.error || r.status !== 200 || isErr) {
      stepFail(step, r.error ?? r.result);
    }
    return extractToolPayload(r.result);
  };

  // 2. Read-only inspection: demands → bids → outcomes (all read tools).
  const demandsPayload = await call("gec_demand_search", { limit: 100 }, "gec_demand_search");
  const demands = ((demandsPayload as { demands?: { demand_id?: string; project_id?: string; acceptance_criteria?: string[] }[] })?.demands) ?? [];
  console.log(`[gec-interop] demands visible: ${demands.length}`);

  // Find which demand carries our target award — scan bids per demand.
  let awardDemandId: string | undefined;
  let awardProjectId: string | undefined;
  for (const d of demands) {
    if (!d.demand_id) continue;
    const bidsPayload = await call("gec_bid_list", { demand_id: d.demand_id }, "gec_bid_list");
    const bids = ((bidsPayload as { bids?: { award_id?: string; bid_id?: string; state?: string }[] })?.bids)
      ?? ((bidsPayload as unknown[] | undefined) as { award_id?: string }[] | undefined) ?? [];
    const hit = Array.isArray(bids) && bids.some((b) => b?.award_id === GEC_VERIFY_AWARD);
    if (hit) {
      awardDemandId = d.demand_id;
      awardProjectId = d.project_id;
      console.log(`[gec-interop] award demand located: ${d.demand_id} (project ${d.project_id ?? "?"})`);
      break;
    }
  }
  if (!awardDemandId) {
    console.log("[gec-interop] award↔demand link not visible via bid lists — falling back to outcome scan");
  }

  // Outcome state per project — award/deliverable evidence refs live here.
  // NOTE: gec_outcome_get is owner-scoped (gec_project_outcome_private) — an
  // expected visibility boundary for a third-party verifier, NOT a failure.
  // Live finding 2026-10-24: private; verifier relies on bid_list's
  // latest_deliverable instead. Record isError, don't kill the run.
  const projectIds = [...new Set(demands.map((d) => d.project_id).filter(Boolean))] as string[];
  for (const pid of projectIds.slice(0, 10)) {
    const r = await mcpCall(GEC_ENDPOINTS.resource, "tools/call",
      { name: "gec_outcome_get", arguments: { project_id: pid } }, { bearer, jar, sessionId, allowRetry: true });
    const isErr = (r.result as { isError?: boolean })?.isError;
    t.record({
      step: "gec_outcome_get", method: "POST", path: "/mcp",
      status: r.status, ms: r.ms,
      note: `tool=gec_outcome_get project=${pid}${isErr ? " (isError — owner-scoped private)" : ""}`,
      responseShape: responseShapeOf(r.result ?? r.error),
    });
  }

  // 3. Gate: without --verdict + --submit this phase ends here, read-only.
  const verdict = parseVerdict(argv);
  const submit = argv.includes("--submit");
  if (!verdict || !submit) {
    console.log("[gec-interop] inspection complete (read-only). Re-run with --verdict=PASS|REVISE|FAIL --submit --note='…' --evidence=ref1,ref2 to record the verdict.");
    return;
  }

  // 4. Submit the verdict — single irreversible write, deterministic idem key.
  const note = parseNote(argv) || `Verdict ${verdict}: see verifier evidence (award ${GEC_VERIFY_AWARD}, deliverable ${GEC_VERIFY_DELIVERABLE}).`;
  const args = buildVerificationArgs(verdict, note, parseEvidence(argv));
  const v = await call("gec_verification_submit", args, "gec_verification_submit");
  console.log(`[gec-interop] verification submitted — verdict=${verdict} idem=${args.idempotency_key}`);
  console.log(`[gec-interop] response: ${JSON.stringify(redact(v)).slice(0, 400)}`);
}

// ─── SLICE-209-2: buyer-side phases (D-209-7) ─────────────────────────
// Live tools/list 2026-11-02 (evidence/tools-list.json): User MCP
// advertises a single unified `sasame_run` tool — {goal, constraints,
// execution_mode, context.gec{role, action, …}}. The projection's
// machine_entry.role_actions still documents named gec_* tools
// (gec_project_create, gec_demand_create, gec_demand_publication_set) —
// we target what the server ACTUALLY advertises, never invented names.
//
// Idempotency (AC#2): sasame_run has no idempotency_key
// (additionalProperties:false). Client-side dedupe instead: a persisted
// buyer-state.json carries created ids + phases_done; a phase no-ops
// when its step is already recorded. Their transport guidance is
// bounded retry with the SAME inputs, so deterministic args also make
// server retries safe.
//
// Write gate (AC#5): every phase defaults to execution_mode=plan_only —
// dry-run, no mutation. --submit flips to "auto"; real writes run only
// after the 209-3 audit + 209-4 fixes.

export const BUYER_CAP_MINOR = "3500000"; // 3.5 USDC cap (D-209-4, revised 2026-11-02)
export const BUYER_PROJECT_NAME = "AgentBadge synthesis article";
export const BUYER_GOAL_PROJECT =
  "Create a Production Project draft 'AgentBadge synthesis article': " +
  "an external-visibility project that will hold one paid Demand for a " +
  "synthesis article about AgentBadge public blog posts.";
export const BUYER_GOAL_DEMAND =
  "Draft a paid Demand under the synthesis-article project: an external " +
  "agent reads the listed AgentBadge blog posts and publishes ONE original " +
  "'how it all works together' synthesis article (with direct links) on its " +
  "own venue. Cap 3.5 USDC, acceptance criteria machine-checkable, policy " +
  "EXTERNAL_OUTCOME / DECLARED_POLICY_ONLY, deadline T+7d from publish.";
export const BUYER_GOAL_LIFECYCLE =
  "Report lifecycle status for our published Demand: bids, awards, " +
  "deliverables, verification and settlement state. Read-only.";

export type BuyerAction =
  | "draft" | "publish" | "status" | "browse" | "apply" | "verify"
  | "settlement_prepare" | "settlement_verify";

export interface SasameRunOpts {
  goal: string;
  action: BuyerAction;
  constraints?: string[];
  executionMode?: "auto" | "plan_only";
  projectId?: string;
  projectName?: string;
  demandId?: string;
  budgetMinor?: string;
  expectedCompletion?: string;
  deadline?: string;
  capabilityRefs?: string[];
  proposal?: string;
  confirmed?: boolean;
  acquisitionChannel?: string;
}

/** Build sasame_run arguments; absent fields are omitted (additionalProperties:false). */
export function buildSasameRunArgs(o: SasameRunOpts): Record<string, unknown> {
  const gec: Record<string, unknown> = { role: "buyer", action: o.action };
  if (o.projectId !== undefined) gec.project_id = o.projectId;
  if (o.projectName !== undefined) gec.project_name = o.projectName;
  if (o.demandId !== undefined) gec.demand_id = o.demandId;
  if (o.budgetMinor !== undefined) gec.budget_minor = o.budgetMinor;
  if (o.expectedCompletion !== undefined) gec.expected_completion = o.expectedCompletion;
  if (o.deadline !== undefined) gec.deadline = o.deadline;
  if (o.capabilityRefs !== undefined) gec.capability_refs = o.capabilityRefs;
  if (o.proposal !== undefined) gec.proposal = o.proposal;
  if (o.confirmed !== undefined) gec.confirmed = o.confirmed;
  if (o.acquisitionChannel !== undefined) gec.acquisition_channel = o.acquisitionChannel;
  const args: Record<string, unknown> = {
    goal: o.goal,
    execution_mode: o.executionMode ?? "plan_only",
    context: { gec },
  };
  if (o.constraints !== undefined) args.constraints = o.constraints;
  return args;
}

/** T+7d demand deadline in strict ISO Z format (schema pattern requires Z). */
export function demandDeadlineFrom(now: Date): string {
  return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
}

// ─── Buyer state file (client-side idempotency) ──────────────────────
/** Audit H2/N-9: resource-id shape — calibrated against live IDs in this
 * repo: `demand:owner:<32hex>` (3 segments) AND `award:<32hex>` (2
 * segments, see GEC_TARGET_AWARD). The earlier 3-segment-only form
 * rejected real award/deliverable ids AFTER the write had landed. */
export const ID_SHAPE_RE = /^(project|demand|award|bid|deliverable):(?:[A-Za-z0-9_-]{2,64}:)?[a-fA-F0-9]{32}$/;

export function validateBuyerId(id: string, label: string): string {
  if (!ID_SHAPE_RE.test(id)) throw new Error(`${label} has unexpected id shape: ${id}`);
  return id;
}

export interface BuyerState {
  // Audit H3: state is bound to wallet + cap — a foreign/stale file that
  // names a different owner or cap is rejected before any write.
  wallet?: string;
  cap_minor?: string;
  pending?: { phase: string; at: string };
  project_id?: string;
  demand_id?: string;
  award_id?: string;
  // Audit N-9: the raw server-returned id is persisted BEFORE shape
  // validation — a malformed-looking id can still be recovered manually
  // instead of forcing a duplicate create.
  project_id_unconfirmed?: string;
  demand_id_unconfirmed?: string;
  phases_done?: string[];
  updated_at?: string;
}

/** Audit H3: bind the state file to this wallet + cap on first write. */
export function bindBuyerState(state: BuyerState, wallet: string): BuyerState {
  if (state.wallet !== undefined && state.wallet.toLowerCase() !== wallet.toLowerCase()) {
    throw new Error(`buyer state bound to ${state.wallet}, signer is ${wallet} — refusing`);
  }
  if (state.cap_minor !== undefined && state.cap_minor !== BUYER_CAP_MINOR) {
    throw new Error(`buyer state cap ${state.cap_minor} != ${BUYER_CAP_MINOR} — refusing`);
  }
  return { ...state, wallet, cap_minor: BUYER_CAP_MINOR };
}

export function defaultBuyerStatePath(): string {
  // Audit C2: resolve from the SCRIPT dir, not cwd — running from any other
  // directory previously opened a different (empty) state file.
  return (
    process.env.GEC_BUYER_STATE ??
    resolve(SCRIPT_DIR, "../../../docs/EPICS/209-gec-buyer-route/evidence/buyer-state.json")
  );
}

export function loadBuyerState(path: string): BuyerState {
  // Audit C2: only ENOENT means "nothing yet" — corrupt JSON, EACCES or any
  // other failure aborts instead of silently resetting dedupe state.
  try {
    return JSON.parse(readFileSync(path, "utf8")) as BuyerState;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error(`buyer state unreadable at ${path}: ${(e as Error).message}`);
  }
}

export function saveBuyerState(path: string, s: BuyerState): void {
  // Audit C2: atomic tmp+rename — a kill mid-write can no longer leave a
  // truncated file that reads back as {}.
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(
    tmp,
    JSON.stringify({ ...s, updated_at: new Date().toISOString() }, null, 2) + "\n",
  );
  renameSync(tmp, path);
}

/** Audit H6/N-13: exclusive lockfile for the whole buyer run. */
export function acquireBuyerLock(statePath: string): () => void {
  const lockPath = `${statePath}.lock`;
  mkdirSync(dirname(statePath), { recursive: true }); // before the lock — ENOENT ≠ "lock held"
  let fd: number;
  try {
    fd = openSync(lockPath, "wx");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") {
      const pid = readFileSync(lockPath, "utf8").trim();
      // N-13: check liveness for an accurate diagnostic — never auto-clear.
      let liveness = "unreadable";
      if (/^\d+$/.test(pid)) {
        try { process.kill(Number(pid), 0); liveness = "ALIVE"; }
        catch { liveness = "DEAD"; }
      }
      throw new Error(
        `another buyer run holds ${lockPath} (recorded pid ${pid || "unknown"}, ${liveness}) — ` +
        `refusing to run concurrently; if that pid is dead, remove ${lockPath}`,
      );
    }
    throw e;
  }
  writeFileSync(fd, `${process.pid}\n`);
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    try { closeSync(fd); } catch { /* already closed */ }
    try { unlinkSync(lockPath); } catch { /* already removed */ }
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  };
  const onSignal = () => { release(); process.exit(130); };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  return release;
}

export function buyerPhaseDone(s: BuyerState, phase: string): boolean {
  return (s.phases_done ?? []).includes(phase);
}

function markPhaseDone(s: BuyerState, phase: string): BuyerState {
  return { ...s, phases_done: [...new Set([...(s.phases_done ?? []), phase])] };
}

// ─── Buyer phase plumbing ─────────────────────────────────────────────
// Audit M8: indexOf-based split — "--x=a=b" keeps the full value, and an
// empty value is rejected instead of silently degrading to the default.
export function argValue(argv: string[], name: string): string | undefined {
  const a = argv.find((x) => x.startsWith(`--${name}=`));
  if (!a) return undefined;
  const v = a.slice(a.indexOf("=") + 1);
  if (!v) throw new Error(`--${name}= given an empty value`);
  return v;
}

function parseStatePath(argv: string[]): string {
  return argValue(argv, "state") ?? defaultBuyerStatePath();
}

// Audit N-13: a typo'd --state name in an existing directory opens a FRESH
// state (ENOENT → {}) with all dedupe lost. Write phases require --init to
// acknowledge a new file at a custom path; the default path self-creates.
function assertFreshStateAllowed(statePath: string, argv: string[]): void {
  if (
    argValue(argv, "state") !== undefined &&
    !existsSync(statePath) &&
    !argv.includes("--init")
  ) {
    throw new Error(
      `no buyer state at custom --state=${statePath} — pass --init to create a fresh state file there`,
    );
  }
}

function parseExecMode(argv: string[]): "auto" | "plan_only" {
  return argv.includes("--submit") ? "auto" : "plan_only";
}

function parseIdArg(argv: string[], name: string): string | undefined {
  const v = argValue(argv, name);
  if (v !== undefined && !ID_SHAPE_RE.test(v)) {
    throw new Error(`--${name}=${v} does not match the resource-id shape`);
  }
  return v;
}

/** First string value for any of `keys`, searched recursively in the tool payload. */
export function findKeyDeep(v: unknown, keys: string[]): string | undefined {
  if (!v || typeof v !== "object") return undefined;
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (keys.includes(k) && typeof val === "string") return val;
    const deep = findKeyDeep(val, keys);
    if (deep) return deep;
  }
  return undefined;
}

/** Like findKeyDeep but returns the value of ANY type — needed for boolean
 * `pending: true` markers and object/array flags (re-audit 2 N-2). */
function findKeyAny(v: unknown, keys: string[]): unknown {
  if (!v || typeof v !== "object") return undefined;
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (keys.includes(k)) return val;
    const deep = findKeyAny(val, keys);
    if (deep !== undefined) return deep;
  }
  return undefined;
}

/** Is this a truthy "pending/awaiting" marker? Strings need a deny-list; any
 * other truthy scalar or non-empty object/array counts as a marker. */
function pendingMarker(v: unknown): boolean {
  if (v === undefined || v === null || v === false) return false;
  if (typeof v === "string") return v.length > 0 && !/^(false|0|none|null|no)$/i.test(v);
  if (typeof v === "number") return v !== 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v as Record<string, unknown>).length > 0;
  return Boolean(v);
}

const PENDING_KEYS = ["pending", "awaiting_approval", "moderation", "is_pending", "pending_approval"];

/** First object in the tree that holds one of `keys` with value `want`
 * (any `want` when undefined). Re-audit 2 N-2: term checks must run on the
 * object that echoes OUR id — not on a sibling object that happens to
 * carry a `state`/`budget` key first in traversal order. */
function findObjectWithKey(v: unknown, keys: string[], want?: string): Record<string, unknown> | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const o = v as Record<string, unknown>;
  if (keys.some((k) => k in o && (want === undefined || o[k] === want))) return o;
  for (const val of Object.values(o)) {
    const deep = findObjectWithKey(val, keys, want);
    if (deep) return deep;
  }
  return undefined;
}

/** OAuth + tools/list; fails closed unless sasame_run is advertised. */
async function buyerSession(t: Transcript): Promise<{ bearer: string; jar: CookieJar; sessionId: string }> {
  const auth = await authenticateUserMcp(t);
  const tools = await mcpCall(GEC_ENDPOINTS.resource, "tools/list", {}, { ...auth, allowRetry: true });
  if (tools.error || tools.status !== 200) stepFail("mcp-tools-list", tools.error ?? tools.status);
  const toolList = (tools.result as { tools?: { name: string; inputSchema?: unknown }[] })?.tools ?? [];
  const runTool = toolList.find((x) => x.name === "sasame_run");
  t.record({
    step: "mcp-tools-list", method: "POST", path: "/mcp",
    status: tools.status, ms: tools.ms,
    responseShape: {
      toolNames: toolList.map((x) => x.name),
      sasame_run_schema: runTool?.inputSchema ?? null,
    },
  });
  if (!runTool) stepFail("mcp-tools-list", "sasame_run not advertised by User MCP");
  return auth;
}

/** tools/call sasame_run with transcript record; returns extracted payload.
 * Audit C3: write actions (draft/publish/apply/settlement_*) are
 * NON-idempotent — no blind retry. Read actions (status/browse) may retry. */
const SASAME_READ_ACTIONS: ReadonlySet<BuyerAction> = new Set(["status", "browse"]);

async function sasameRun(
  t: Transcript,
  auth: { bearer: string; jar: CookieJar; sessionId: string },
  args: Record<string, unknown>,
  step: string,
): Promise<unknown> {
  const gec = (args.context as { gec?: Record<string, unknown> }).gec ?? {};
  const readOnly = SASAME_READ_ACTIONS.has(gec.action as BuyerAction);
  const r = await mcpCall(
    GEC_ENDPOINTS.resource, "tools/call",
    { name: "sasame_run", arguments: args },
    { ...auth, allowRetry: readOnly },
  );
  const isErr = (r.result as { isError?: boolean })?.isError;
  t.record({
    step, method: "POST", path: "/mcp",
    status: r.status, ms: r.ms,
    note: `tool=sasame_run action=${String(gec.action ?? "?")} mode=${String(args.execution_mode)}`,
    responseShape: responseShapeOf(r.result ?? r.error),
  });
  if (r.error || r.status !== 200 || isErr) {
    stepFail(step, r.error ?? r.result);
  }
  return extractToolPayload(r.result);
}

// ─── Phase plans ──────────────────────────────────────────────────────
export const PROJECT_STEPS = [
  "Full OAuth2.1+PKCE+EIP-191 chain → bearer + mcp-session-id",
  "MCP tools/list — confirm sasame_run advertised (live schema into transcript)",
  "MCP tools/call sasame_run role=buyer action=draft — project draft (plan_only unless --submit)",
  "On auto: persist project_id into buyer-state.json — re-run skips (idempotent)",
] as const;

export const DEMAND_STEPS = [
  "Full OAuth2.1+PKCE+EIP-191 chain → bearer + mcp-session-id",
  "MCP tools/list — confirm sasame_run advertised",
  "Resolve project_id (buyer-state.json or --project=)",
  "MCP tools/call sasame_run role=buyer action=draft — demand, cap 3,500,000 microUSDC, deadline T+7d",
  "On auto: persist demand_id into buyer-state.json — re-run skips (idempotent)",
] as const;

export const PUBLISH_STEPS = [
  "Full OAuth2.1+PKCE+EIP-191 chain → bearer + mcp-session-id",
  "Resolve demand_id (buyer-state.json or --demand=)",
  "MCP tools/call sasame_run role=buyer action=publish — confirmed only with --submit",
  "On auto: mark publish done in buyer-state.json",
] as const;

export const LIFECYCLE_STEPS = [
  "Full OAuth2.1+PKCE+EIP-191 chain → bearer + mcp-session-id",
  "Resolve demand_id (buyer-state.json or --demand=)",
  "MCP tools/call sasame_run role=buyer action=status — bids → award → delivery → verify → settle (read-only)",
] as const;

// ─── Phase runners ────────────────────────────────────────────────────
// Audit H2/H3 pattern (all write phases):
//   1. bindBuyerState — state file must name THIS wallet + cap
//   2. pending marker persisted BEFORE the remote write
//   3. ID extracted, shape-validated, printed BEFORE the save
//   4. post-write read-only status read-back confirms server-side state
//      before phases_done is marked — a "pending approval" reply can no
//      longer be mistaken for a completed write
//   5. stale pending on re-run → refuse to create a second entity; the
//      operator resolves via a status read-back or --ignore-pending

// Audit N-2: a status payload proves nothing by echoing an id back — the
// read-back must match on state terms. Returns the list of mismatches.
export function statusTermsProblems(payload: unknown, expected: {
  id: string;
  idKeys: string[];
  projectId?: string;
  budgetMinor?: string;
  allowedStates: readonly string[];
}): string[] {
  const bad: string[] = [];
  // Re-audit 2 N-2: scope every term check to the object that echoes OUR id;
  // a sibling object's state/budget must not satisfy (or fail) the check.
  const scope = findObjectWithKey(payload, expected.idKeys, expected.id);
  if (!scope) {
    bad.push(`${expected.idKeys[0]} not echoed as ${expected.id}`);
    return bad; // nothing else can be trusted — terms belong to another object
  }
  const pend = findKeyAny(scope, PENDING_KEYS);
  if (pendingMarker(pend)) {
    bad.push(`pending/awaiting marker present: ${JSON.stringify(pend)}`);
  }
  if (expected.projectId !== undefined) {
    const p = findKeyDeep(scope, ["project_id"]);
    if (p !== expected.projectId) bad.push(`project_id ${String(p)} != ${expected.projectId}`);
  }
  if (expected.budgetMinor !== undefined) {
    const b = findKeyDeep(scope, ["budget_minor", "max_budget_minor", "cap_minor"]);
    if (b !== expected.budgetMinor) bad.push(`budget ${String(b)} != ${expected.budgetMinor}`);
  }
  const st = findKeyDeep(scope, [
    "state", "status", "demand_state", "project_state", "lifecycle_state", "publication_state",
  ]);
  if (st === undefined) {
    bad.push("no state/status term in read-back");
  } else if (!expected.allowedStates.some((s) => s.toUpperCase() === st.toUpperCase())) {
    bad.push(`state ${st} not in allowed ${expected.allowedStates.join("/")}`);
  }
  return bad;
}

/** Audit N-2: the publish response itself can already say "pending approval".
 * Soft check — only DENY markers fail; absence defers to the status read-back.
 * Re-audit 2: works for non-string markers (boolean/object/array) too. */
export function assertNoPendingMarkers(payload: unknown, step: string): void {
  const pend = findKeyAny(payload, PENDING_KEYS);
  if (pendingMarker(pend)) {
    stepFail(step, `write returned pending/awaiting marker ${JSON.stringify(pend)} — NOT treating as landed`);
  }
}

function pendingGuard(state: BuyerState, phase: string, argv: string[]): void {
  // Audit N-7: scoped flag — --ignore-pending ONLY bypasses the stale-pending
  // gate; it no longer doubles as a confirmation override.
  if (state.pending && !argv.includes("--ignore-pending")) {
    stepFail(
      `pending-${phase}`,
      `stale pending marker ${JSON.stringify(state.pending)} — a write may have ` +
      `already landed. Run a status read-back (--phase=lifecycle) or pass --ignore-pending`,
    );
  }
}

async function runBuyerProject(t: Transcript, argv: string[]): Promise<void> {
  const statePath = parseStatePath(argv);
  assertFreshStateAllowed(statePath, argv);
  const release = acquireBuyerLock(statePath);
  try {
    const { address } = loadWallet();
    let state = bindBuyerState(loadBuyerState(statePath), address);
    if (buyerPhaseDone(state, "project") && state.project_id) {
      console.log(`[gec-interop] project already created: ${state.project_id} — idempotent skip`);
      return;
    }
    pendingGuard(state, "project", argv);
    const auth = await buyerSession(t);
    const mode = parseExecMode(argv);
    const args = buildSasameRunArgs({
      goal: BUYER_GOAL_PROJECT,
      action: "draft",
      projectName: BUYER_PROJECT_NAME,
      acquisitionChannel: "OTHER_AGENT",
      constraints: ["project draft only — no demand, no publication"],
      executionMode: mode,
    });
    if (mode === "auto") {
      state = { ...state, pending: { phase: "project", at: new Date().toISOString() } };
      saveBuyerState(statePath, state);
    }
    const payload = await sasameRun(t, auth, args, "sasame_run-project-draft");
    if (mode === "auto") {
      const pid = findKeyDeep(payload, ["project_id"]);
      if (!pid) stepFail("sasame_run-project-draft", `auto run returned no project_id in ${JSON.stringify(redact(payload)).slice(0, 400)}`);
      // N-9: persist the raw id BEFORE validation so a non-matching shape
      // is still recoverable via --phase=lifecycle/browse, not a duplicate.
      state = { ...state, project_id_unconfirmed: pid };
      saveBuyerState(statePath, state);
      validateBuyerId(pid, "project_id");
      console.log(`[gec-interop] project created: ${pid}`); // printed BEFORE save
      assertNoPendingMarkers(payload, "sasame_run-project-draft");
      const check = await sasameRun(t, auth, buildSasameRunArgs({
        goal: "Read-only: confirm the project draft exists.", action: "status",
        projectId: pid, executionMode: "plan_only",
      }), "sasame_run-project-status");
      const problems = statusTermsProblems(check, {
        id: pid, idKeys: ["project_id"],
        allowedStates: ["DRAFT", "CREATED", "ACTIVE", "OPEN"],
      });
      const confirmed = problems.length === 0;
      if (!confirmed) {
        stepFail("sasame_run-project-status", `read-back terms failed for ${pid}: ${problems.join("; ")} — NOT marking done; re-run to verify`);
      }
      state = markPhaseDone({ ...state, project_id: pid, project_id_unconfirmed: undefined, pending: undefined }, "project");
      saveBuyerState(statePath, state);
      console.log(`[gec-interop] confirmed + persisted: ${pid} — state → ${statePath}`);
    } else {
      console.log("[gec-interop] plan_only — draft returned, nothing written (use --submit post-audit)");
    }
  } finally {
    release();
  }
}

async function runBuyerDemand(t: Transcript, argv: string[]): Promise<void> {
  const statePath = parseStatePath(argv);
  assertFreshStateAllowed(statePath, argv);
  const release = acquireBuyerLock(statePath);
  try {
    const { address } = loadWallet();
    let state = bindBuyerState(loadBuyerState(statePath), address);
    if (buyerPhaseDone(state, "demand") && state.demand_id) {
      console.log(`[gec-interop] demand already created: ${state.demand_id} — idempotent skip`);
      return;
    }
    pendingGuard(state, "demand", argv);
    const projectId = parseIdArg(argv, "project") ?? state.project_id;
    if (!projectId) stepFail("demand-args", "no project_id — run --phase=project first or pass --project=<id>");
    validateBuyerId(projectId, "project_id");
    if (state.project_id && projectId !== state.project_id && !argv.includes("--allow-id-mismatch")) {
      stepFail("demand-args", `--project=${projectId} differs from state ${state.project_id} — --allow-id-mismatch to override`);
    }
    const auth = await buyerSession(t);
    const mode = parseExecMode(argv);
    const deadline = demandDeadlineFrom(new Date());
    const args = buildSasameRunArgs({
      goal: BUYER_GOAL_DEMAND,
      action: "draft",
      projectId,
      budgetMinor: BUYER_CAP_MINOR,
      deadline,
      expectedCompletion: deadline,
      acquisitionChannel: "OTHER_AGENT",
      constraints: [
        "verification_policy EXTERNAL_OUTCOME",
        "verification_assurance DECLARED_POLICY_ONLY",
        "machine-checkable acceptance criteria per D-209-5",
        "demand draft only — no publication in this phase",
      ],
      executionMode: mode,
    });
    if (mode === "auto") {
      state = { ...state, pending: { phase: "demand", at: new Date().toISOString() } };
      saveBuyerState(statePath, state);
    }
    const payload = await sasameRun(t, auth, args, "sasame_run-demand-draft");
    if (mode === "auto") {
      const did = findKeyDeep(payload, ["demand_id"]);
      if (!did) stepFail("sasame_run-demand-draft", `auto run returned no demand_id in ${JSON.stringify(redact(payload)).slice(0, 400)}`);
      state = { ...state, demand_id_unconfirmed: did }; // N-9: persist raw id before validation
      saveBuyerState(statePath, state);
      validateBuyerId(did, "demand_id");
      console.log(`[gec-interop] demand created: ${did}`); // printed BEFORE save
      assertNoPendingMarkers(payload, "sasame_run-demand-draft");
      const check = await sasameRun(t, auth, buildSasameRunArgs({
        goal: "Read-only: confirm the demand draft exists with the right budget.",
        action: "status", demandId: did, projectId, executionMode: "plan_only",
      }), "sasame_run-demand-status");
      const problems = statusTermsProblems(check, {
        id: did, idKeys: ["demand_id"], projectId, budgetMinor: BUYER_CAP_MINOR,
        allowedStates: ["DRAFT", "CREATED", "PENDING_REVIEW"],
      });
      if (problems.length) {
        stepFail("sasame_run-demand-status", `read-back terms failed for ${did}: ${problems.join("; ")} — NOT marking done; re-run to verify`);
      }
      state = markPhaseDone({ ...state, project_id: projectId, demand_id: did, demand_id_unconfirmed: undefined, pending: undefined }, "demand");
      saveBuyerState(statePath, state);
      console.log(`[gec-interop] confirmed + persisted: ${did} — state → ${statePath}`);
    } else {
      console.log("[gec-interop] plan_only — demand draft returned, nothing written (use --submit post-audit)");
    }
  } finally {
    release();
  }
}

const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const ERC20_BALANCE = parseAbi(["function balanceOf(address) view returns (uint256)"]);

/** Audit H3/N-11: publish is funded-only — the CANONICAL funding-state
 * must show a confirmed mint AND the pinned buyer's on-chain Base USDC
 * must cover the cap. */
async function assertPublishFunded(statePath: string, wallet: string): Promise<void> {
  // N-11: never derive the funding path from the caller's --state — a
  // foreign buyer-state dir could smuggle in an unrelated funding file.
  const fundingPath =
    process.env.GEC_FUNDING_STATE ??
    resolve(SCRIPT_DIR, "../../../docs/EPICS/209-gec-buyer-route/evidence/funding-state.json");
  if (!existsSync(fundingPath)) {
    stepFail("publish-funding", `no funding-state.json at ${fundingPath} — run the CCTP funding leg first`);
  }
  const funding = JSON.parse(readFileSync(fundingPath, "utf8")) as {
    mint_tx?: string; mint_confirmed?: boolean;
  };
  const minted =
    funding.mint_tx === "relayed-externally" ||
    (typeof funding.mint_tx === "string" && /^0x[0-9a-fA-F]{64}$/.test(funding.mint_tx) && funding.mint_confirmed === true);
  if (!minted) {
    stepFail("publish-funding",
      `funding-state at ${fundingPath} shows no CONFIRMED mint (mint_tx=${funding.mint_tx ?? "none"}) — finish the CCTP leg first`);
  }
  const pub = createPublicClient({ chain: base, transport: http() });
  const chainId = await pub.getChainId();
  if (chainId !== 8453) {
    stepFail("publish-funding", `Base client reports chainId ${chainId} != 8453 — refusing balance gate`);
  }
  const bal = await pub.readContract({
    address: USDC_BASE, abi: ERC20_BALANCE, functionName: "balanceOf", args: [wallet as `0x${string}`],
  });
  if (bal < BigInt(BUYER_CAP_MINOR)) {
    stepFail("publish-funding",
      `buyer Base USDC ${Number(bal) / 1e6} < cap ${Number(BUYER_CAP_MINOR) / 1e6} — funding not landed`);
  }
  console.log(`[gec-interop] funding verified: mint_tx=${funding.mint_tx} baseUsdc=${Number(bal) / 1e6} ≥ cap`);
}

/** Audit N-7: publishing a paid demand gets the same explicit YES as the
 * funding spend — TTY prompt, or GEC_INTEROP_CONFIRM=YES non-interactive. */
async function confirmPublish(argv: string[], summary: Record<string, unknown>): Promise<void> {
  console.log(`[gec-interop] PUBLISH PLAN: ${JSON.stringify(summary)}`);
  if (!argv.includes("--submit")) {
    console.log("[gec-interop] dry-run — pass --submit to publish (post re-audit)");
    return;
  }
  if (process.stdin.isTTY) {
    const { createInterface } = await import("node:readline");
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise<string>((r) => rl.question("Type YES to publish: ", r));
    rl.close();
    if (answer.trim() !== "YES") stepFail("publish-confirm", "publish aborted by operator");
    return;
  }
  if (process.env.GEC_INTEROP_CONFIRM !== "YES") {
    stepFail("publish-confirm", "non-interactive publish requires GEC_INTEROP_CONFIRM=YES");
  }
}

async function runBuyerPublish(t: Transcript, argv: string[]): Promise<void> {
  const statePath = parseStatePath(argv);
  assertFreshStateAllowed(statePath, argv);
  const release = acquireBuyerLock(statePath);
  try {
    const { address } = loadWallet();
    let state = bindBuyerState(loadBuyerState(statePath), address);
    if (buyerPhaseDone(state, "publish")) {
      console.log(`[gec-interop] demand already published: ${state.demand_id ?? "?"} — idempotent skip`);
      return;
    }
    pendingGuard(state, "publish", argv);
    const demandId = parseIdArg(argv, "demand") ?? state.demand_id;
    if (!demandId) stepFail("publish-args", "no demand_id — run --phase=demand first or pass --demand=<id>");
    validateBuyerId(demandId, "demand_id");
    if (state.demand_id && demandId !== state.demand_id && !argv.includes("--allow-id-mismatch")) {
      stepFail("publish-args", `--demand=${demandId} differs from state ${state.demand_id} — --allow-id-mismatch to override`);
    }
    const auth = await buyerSession(t);
    const mode = parseExecMode(argv);
    if (mode === "auto") {
      // Audit H3: never publish an unfunded or unverified Demand.
      await assertPublishFunded(statePath, address);
      const pre = await sasameRun(t, auth, buildSasameRunArgs({
        goal: "Read-only: report the draft demand's current state before publish.",
        action: "status", demandId, projectId: state.project_id, executionMode: "plan_only",
      }), "sasame_run-pre-publish-status");
      const preProblems = statusTermsProblems(pre, {
        id: demandId, idKeys: ["demand_id"], projectId: state.project_id,
        budgetMinor: BUYER_CAP_MINOR,
        allowedStates: ["DRAFT", "CREATED", "PENDING_REVIEW", "READY"],
      });
      if (preProblems.length) {
        stepFail("pre-publish-status", `status terms failed for ${demandId}: ${preProblems.join("; ")} — refusing to publish`);
      }
      console.log(`[gec-interop] pre-publish status confirmed ${demandId}`);
      // Audit N-7: explicit operator YES on the publish plan.
      await confirmPublish(argv, {
        demand_id: demandId, project_id: state.project_id,
        cap_minor: BUYER_CAP_MINOR, wallet: address,
      });
    }
    const args = buildSasameRunArgs({
      goal: "Publish the drafted Demand so external providers can bid on it. Deadline is T+7d from now.",
      action: "publish",
      demandId,
      projectId: state.project_id,
      deadline: demandDeadlineFrom(new Date()), // audit H3: T+7d from PUBLISH
      confirmed: mode === "auto",
      acquisitionChannel: "OTHER_AGENT",
      executionMode: mode,
    });
    if (mode === "auto") {
      state = { ...state, pending: { phase: "publish", at: new Date().toISOString() } };
      saveBuyerState(statePath, state);
    }
    const payload = await sasameRun(t, auth, args, "sasame_run-demand-publish");
    if (mode === "auto") {
      // Audit N-2: the write response itself can already say "pending
      // approval" — that is NOT a landed publish.
      assertNoPendingMarkers(payload, "sasame_run-demand-publish");
      const check = await sasameRun(t, auth, buildSasameRunArgs({
        goal: "Read-only: confirm the demand is published/OPEN.",
        action: "status", demandId, projectId: state.project_id, executionMode: "plan_only",
      }), "sasame_run-post-publish-status");
      const problems = statusTermsProblems(check, {
        id: demandId, idKeys: ["demand_id"], projectId: state.project_id,
        budgetMinor: BUYER_CAP_MINOR,
        allowedStates: ["OPEN", "PUBLISHED", "ACTIVE", "LIVE"],
      });
      if (problems.length) {
        stepFail("post-publish-status", `read-back terms failed for ${demandId}: ${problems.join("; ")} — NOT marking done; verify manually`);
      }
      state = markPhaseDone({ ...state, demand_id: demandId, pending: undefined }, "publish");
      saveBuyerState(statePath, state);
      console.log(`[gec-interop] demand published + confirmed: ${demandId}`);
    } else {
      console.log("[gec-interop] plan_only — publish dry-run only (use --submit post-audit)");
      void payload;
    }
  } finally {
    release();
  }
}

async function runBuyerLifecycle(t: Transcript, argv: string[]): Promise<void> {
  const statePath = parseStatePath(argv);
  const { address } = loadWallet();
  const state = bindBuyerState(loadBuyerState(statePath), address);
  const demandId = parseIdArg(argv, "demand") ?? state.demand_id;
  if (!demandId) stepFail("lifecycle-args", "no demand_id — publish a demand first or pass --demand=<id>");
  // Audit M7: lifecycle is read-only — --submit has no business flipping a
  // status report into "auto". Reject it outright instead of passing it on.
  if (argv.includes("--submit")) {
    stepFail("lifecycle-args", "--submit is meaningless on a read-only status report");
  }
  const auth = await buyerSession(t);
  const args = buildSasameRunArgs({
    goal: BUYER_GOAL_LIFECYCLE,
    action: "status",
    demandId,
    projectId: state.project_id,
    constraints: ["read-only lifecycle report — no writes"],
    executionMode: "plan_only", // hard-coded — never auto
  });
  const payload = await sasameRun(t, auth, args, "sasame_run-demand-status");
  console.log(`[gec-interop] lifecycle status: ${JSON.stringify(redact(payload)).slice(0, 800)}`);
}

async function main(): Promise<void> {
  const phase = parsePhase(process.argv.slice(2));

  // Env + identity check WITHOUT printing secrets (key never logged).
  const { address } = loadWallet();
  const steps = phase === "rehearsal" ? REHEARSAL_STEPS
    : phase === "bid" ? BID_STEPS
      : phase === "tools" ? TOOLS_STEPS
        : phase === "verify" ? VERIFY_STEPS
          : phase === "project" ? PROJECT_STEPS
            : phase === "demand" ? DEMAND_STEPS
              : phase === "publish" ? PUBLISH_STEPS
                : phase === "lifecycle" ? LIFECYCLE_STEPS
                  : AWARD_STEPS;

  console.log(`[gec-interop] phase=${phase}`);
  // Audit H5: no longer "zero-funds" — this key also holds the buyer's
  // funded Base USDC, which is exactly why challenge validation exists.
  console.log(`[gec-interop] wallet=${address} (funded buyer wallet — EIP-191 + Base USDC)`);
  console.log(`[gec-interop] client_id=${clientId()}`);
  console.log(`[gec-interop] redirect_uri=${redirectUri()}`);
  console.log(`[gec-interop] target demand=${GEC_TARGET_DEMAND}`);
  console.log(`[gec-interop] planned steps:`);
  steps.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));

  const t = new Transcript();
  try {
    if (phase === "rehearsal") {
      await runRehearsal(t);
    } else if (phase === "bid") {
      await runBid(t, process.argv.slice(2));
    } else if (phase === "tools") {
      await runTools(t);
    } else if (phase === "verify") {
      await runVerify(t, process.argv.slice(2));
    } else if (phase === "project") {
      await runBuyerProject(t, process.argv.slice(2));
    } else if (phase === "demand") {
      await runBuyerDemand(t, process.argv.slice(2));
    } else if (phase === "publish") {
      await runBuyerPublish(t, process.argv.slice(2));
    } else if (phase === "lifecycle") {
      await runBuyerLifecycle(t, process.argv.slice(2));
    } else if (phase === "award") {
      // Audit H4: explicit case — the old fallthrough ran award for ANY
      // unmatched phase, a fragile default for an irreversible write.
      await runAward(t, process.argv.slice(2));
    } else {
      stepFail("dispatch", `unhandled phase ${phase} — exhaustive dispatch, no default`);
    }
  } finally {
    const out = outPath(process.argv.slice(2));
    if (out) {
      const { writeFileSync, mkdirSync } = await import("node:fs");
      const { dirname } = await import("node:path");
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, t.toJSON());
      console.log(`[gec-interop] transcript → ${out} (${t.entries.length} entries)`);
    }
  }
}

if (import.meta.main) {
  main().catch((e) => {
    console.error(`[gec-interop] fatal: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });
}
