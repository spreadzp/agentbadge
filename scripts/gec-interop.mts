/**
 * EPIC-205 (SLICE-205-3): SaSame GEC interop client — OAuth 2.1 + PKCE S256
 * + EIP-191 wallet auth, as an external public client against their live
 * Production provider path.
 *
 * Phases:
 *   --phase=rehearsal  read-only: Public MCP (keyless) gec_open_demands
 *   --phase=bid        full: CIMD → authorize → EIP-191 wallet → consent
 *                      → token exchange → gec_bid_submit (5,000,000 microUSDC)
 *
 * In SLICE-205-3 both phases STOP before the first live network call —
 * live execution is gated to SLICE-205-5 (rehearsal, post-audit) and
 * SLICE-205-6 (bid). Tests cover the pure functions only.
 *
 * Env:
 *   GEC_INTEROP_PRIVATE_KEY=0x...  burner wallet (EIP-191 sign only, zero funds)
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
import type { Hex, LocalAccount } from "viem";

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

export const GEC_TARGET_DEMAND = "demand:owner:aefcd63292d520374a1c2ac7fca6a8a5";
export const GEC_BID_AMOUNT_MINOR = "5000000"; // 5 USDC = max_budget_minor
export const GEC_TARGET_AWARD = "award:155c2787a74b57b557dc6a69d3d4fb56";

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
      const bucket = store.get(origin) ?? new Map<string, string>();
      store.set(origin, bucket);
      for (const line of res.headers.getSetCookie?.() ?? []) {
        const first = line.split(";", 1)[0];
        const eq = first.indexOf("=");
        if (eq <= 0) continue; // "=value" (no name) or bare flag — skip
        const name = first.slice(0, eq).trim();
        const value = first.slice(eq + 1).trim();
        if (!name) continue;
        if (value === "") bucket.delete(name);
        else bucket.set(name, value);
      }
      if (bucket.size === 0) store.delete(origin);
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

const SECRET_KEY_RE =
  /authorization|cookie|set-cookie|token|signature|challenge|message|code_verifier|code$|state|client_secret|private|secret|mcp_state|mcp_base/i;

export function redact<T>(value: T): T {
  if (Array.isArray(value)) return value.map(redact) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEY_RE.test(k) ? "<redacted>" : redact(v);
    }
    return out as T;
  }
  if (typeof value === "string" && value.length > 500) {
    return (value.slice(0, 500) + "…<truncated>") as T;
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
    this.entries.push({ ...e, responseShape: e.responseShape === undefined ? undefined : redact(e.responseShape) });
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
  // Flaky upstream (sasame.online 522/timeouts): up to 3 attempts on network
  // errors or 5xx responses; retryable state is cheap because every step of
  // the OAuth chain is idempotent-by-design (new challenge/nonce per attempt).
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 2000 * attempt));
    try {
      const r = await timedFetchOnce(url, opts);
      if (r.status < 500) return r;
      lastErr = new Error(`HTTP ${r.status}`);
    } catch (e) {
      lastErr = e;
    }
  }
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
  return { address: account.address, account };
}

export async function signChallenge(message: string, account: LocalAccount): Promise<Hex> {
  return account.signMessage({ message });
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
  opts: { bearer?: string; jar?: CookieJar; sessionId?: string } = {},
): Promise<McpCallResult & { sessionId?: string | null }> {
  const headers: Record<string, string> = {
    "content-type": "application/json", accept: "application/json, text/event-stream",
  };
  if (opts.sessionId) headers["mcp-session-id"] = opts.sessionId;
  const r = await timedFetch(endpoint, {
    method: "POST",
    jar: opts.jar,
    bearer: opts.bearer,
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

function parsePhase(argv: string[]): "rehearsal" | "bid" | "tools" | "award" {
  const arg = argv.find((a) => a.startsWith("--phase="));
  const phase = arg?.split("=", 2)[1];
  if (phase === "rehearsal" || phase === "bid" || phase === "tools" || phase === "award") return phase;
  throw new Error("usage: bun run scripts/gec-interop.mts --phase=rehearsal|bid|tools|award [--out=<transcript.json>] [--report=<file>]");
}

function outPath(argv: string[]): string | undefined {
  return argv.find((a) => a.startsWith("--out="))?.split("=", 2)[1];
}

// ─── SLICE-205-5: live rehearsal — full OAuth cycle, read-only finish ────────
// Every step is recorded as {step, method, path, status, ms, responseShape}.
// path NEVER contains query (code_challenge/state live there). Secrets —
// signature, bearer, cookies, challenge text — never enter the transcript;
// the redact() denylist is a second belt, not the first.

function stepFail(step: string, what: string): never {
  throw new Error(`[kill-gate] ${step}: ${what}`);
}

async function authenticateUserMcp(t: Transcript): Promise<{ bearer: string; jar: CookieJar; sessionId: string }> {
  const jar = createCookieJar();
  const { address, account } = loadWallet();
  const { verifier, challenge } = pkce();
  const state = makeState(verifier);

  // 0. Projection: target demand must still be OPEN
  const proj = await timedFetch(GEC_ENDPOINTS.openDemandsApi, { jar });
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
  const auth = await timedFetch(authUrl, { jar, redirectManual: true });
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
    jar, method: "POST",
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

  // 4. EIP-191 personal_sign — LOCAL, signature never recorded
  const signature = await signChallenge(message, account);

  // 5. POST verify — returned challenge fields + signature (cookie jar keeps session)
  const verify = await timedFetch(GEC_ENDPOINTS.verify, {
    jar, method: "POST",
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
      break;
    }
    const r = await timedFetch(next.toString(), { jar, redirectManual: true });
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
    jar, method: "POST",
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
  }, { bearer, jar });
  t.record({
    step: "mcp-initialize", method: "POST", path: "/mcp",
    status: init.status, ms: init.ms, responseShape: responseShapeOf(init.result ?? init.error)
  });
  if (init.error || init.status !== 200) stepFail("mcp-initialize", JSON.stringify(init.error ?? init.status));
  // MCP Streamable HTTP: session id issued on initialize must be echoed on all later calls
  const sessionId = init.sessionId ?? undefined;
  if (!sessionId) stepFail("mcp-initialize", "no mcp-session-id in initialize response headers");
  await mcpCall(GEC_ENDPOINTS.resource, "notifications/initialized", {}, { bearer, jar, sessionId });

  return { bearer, jar, sessionId };
}

async function runRehearsal(t: Transcript): Promise<void> {
  const { bearer, jar, sessionId } = await authenticateUserMcp(t);

  // 10. tools/list — gec_bid_submit schema is 205-6 input, persisted in evidence (not secret)
  const tools = await mcpCall(GEC_ENDPOINTS.resource, "tools/list", {}, { bearer, jar, sessionId });
  if (tools.error || tools.status !== 200) stepFail("mcp-tools-list", JSON.stringify(tools.error ?? tools.status));
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
  }, { jar });
  t.record({
    step: "public-mcp-initialize", method: "POST", path: "/public-mcp",
    status: pubInit.status, ms: pubInit.ms,
    responseShape: responseShapeOf((pubInit.result as { serverInfo?: unknown })?.serverInfo ?? pubInit.error)
  });
  if (pubInit.error || pubInit.status !== 200) stepFail("public-mcp-initialize", JSON.stringify(pubInit.error ?? pubInit.status));
  const pubSession = pubInit.sessionId ?? undefined;
  // Their server binds the session via cookies + notifications/initialized;
  // without it tools/call answers "Tool not found" even though tools/list shows it.
  await mcpCall(GEC_ENDPOINTS.publicMcp, "notifications/initialized", {}, { jar, sessionId: pubSession });

  const demands = await mcpCall(GEC_ENDPOINTS.publicMcp, "tools/call",
    { name: "gec_open_demands", arguments: {} }, { jar, sessionId: pubSession });
  const isErr = (demands.result as { isError?: boolean })?.isError;
  t.record({
    step: "gec_open_demands", method: "POST", path: "/public-mcp",
    status: demands.status, ms: demands.ms, responseShape: responseShapeOf(demands.result ?? demands.error)
  });
  if (demands.error || demands.status !== 200 || isErr) stepFail("gec_open_demands", JSON.stringify(demands.error ?? demands.result));

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
async function runBid(t: Transcript): Promise<void> {
  const { bearer, jar, sessionId } = await authenticateUserMcp(t);

  const bidArgs = {
    demand_id: GEC_TARGET_DEMAND,
    idempotency_key: `agentbadge-205-bid-aefcd6-${crypto.randomUUID().slice(0, 8)}`,
    amount_minor: GEC_BID_AMOUNT_MINOR,
    expected_completion: "2026-10-26T23:00:00Z", // on-or-before demand deadline
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

  const bid = await mcpCall(GEC_ENDPOINTS.resource, "tools/call",
    { name: "gec_bid_submit", arguments: bidArgs }, { bearer, jar, sessionId });
  const isErr = (bid.result as { isError?: boolean })?.isError;
  t.record({
    step: "gec_bid_submit", method: "POST", path: "/mcp",
    status: bid.status, ms: bid.ms,
    note: `demand=aefcd6… amount=${GEC_BID_AMOUNT_MINOR} idem=${bidArgs.idempotency_key}`,
    responseShape: responseShapeOf(bid.result ?? bid.error)
  });
  if (bid.error || bid.status !== 200 || isErr) {
    stepFail("gec_bid_submit", JSON.stringify(bid.error ?? bid.result));
  }
  console.log("[gec-interop] bid submitted — 5,000,000 microUSDC on demand aefcd6…");
}

async function runTools(t: Transcript): Promise<void> {
  const { bearer, jar, sessionId } = await authenticateUserMcp(t);

  const tools = await mcpCall(GEC_ENDPOINTS.resource, "tools/list", {}, { bearer, jar, sessionId });
  if (tools.error || tools.status !== 200) stepFail("mcp-tools-list", JSON.stringify(tools.error ?? tools.status));
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
  const arg = process.argv.find((a) => a.startsWith("--report="));
  const file = arg?.split("=", 2)[1]
    ?? "../../docs/EPICS/205-sasame-gec-interop/evidence/deliverable-summary-2026-10-23.md";
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  return readFileSync(file, "utf8");
}

// Live schemas captured 2026-10-23 via --phase=tools:
//   gec_award_accept        required: award_id
//   gec_deliverable_submit  required: award_id, idempotency_key(8-128),
//                           summary(1-4000), evidence_refs(1-50, each <=1000)
function buildAwardAcceptArgs(): Record<string, unknown> {
  return { award_id: GEC_TARGET_AWARD };
}

function buildDeliverableArgs(summary: string): Record<string, unknown> {
  return {
    award_id: GEC_TARGET_AWARD,
    idempotency_key: `agentbadge-205-deliver-155c27-${crypto.randomUUID().slice(0, 8)}`,
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

async function runAward(t: Transcript): Promise<void> {
  const { bearer, jar, sessionId } = await authenticateUserMcp(t);

  // Re-list tools so the transcript carries the exact schemas this call used.
  const tools = await mcpCall(GEC_ENDPOINTS.resource, "tools/list", {}, { bearer, jar, sessionId });
  if (tools.error || tools.status !== 200) stepFail("mcp-tools-list", JSON.stringify(tools.error ?? tools.status));
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
    { name: "gec_award_accept", arguments: acceptArgs }, { bearer, jar, sessionId });
  const acceptErr = (accept.result as { isError?: boolean })?.isError;
  t.record({
    step: "gec_award_accept", method: "POST", path: "/mcp",
    status: accept.status, ms: accept.ms,
    note: `award=155c27…fb56 args=${Object.keys(acceptArgs).join(",")}`,
    responseShape: responseShapeOf(accept.result ?? accept.error)
  });
  if (accept.error || accept.status !== 200 || acceptErr) {
    stepFail("gec_award_accept", JSON.stringify(accept.error ?? accept.result));
  }
  console.log("[gec-interop] award accepted — 155c27…fb56");

  const reportText = loadReport();
  if (reportText.length > 4000) {
    stepFail("deliverable-args", `summary too long: ${reportText.length} > 4000 chars (schema bound)`);
  }
  const deliverArgs = buildDeliverableArgs(reportText);
  const deliver = await mcpCall(GEC_ENDPOINTS.resource, "tools/call",
    { name: "gec_deliverable_submit", arguments: deliverArgs }, { bearer, jar, sessionId });
  const deliverErr = (deliver.result as { isError?: boolean })?.isError;
  t.record({
    step: "gec_deliverable_submit", method: "POST", path: "/mcp",
    status: deliver.status, ms: deliver.ms,
    note: `args=${Object.keys(deliverArgs).join(",")} report_bytes=${reportText.length}`,
    responseShape: responseShapeOf(deliver.result ?? deliver.error)
  });
  if (deliver.error || deliver.status !== 200 || deliverErr) {
    stepFail("gec_deliverable_submit", JSON.stringify(deliver.error ?? deliver.result));
  }
  console.log("[gec-interop] deliverable submitted — redacted friction report");
}

async function main(): Promise<void> {
  const phase = parsePhase(process.argv.slice(2));

  // Env + identity check WITHOUT printing secrets (key never logged).
  const { address } = loadWallet();
  const steps = phase === "rehearsal" ? REHEARSAL_STEPS
    : phase === "bid" ? BID_STEPS
      : phase === "tools" ? TOOLS_STEPS
        : AWARD_STEPS;

  console.log(`[gec-interop] phase=${phase}`);
  console.log(`[gec-interop] wallet=${address} (burner, EIP-191 only, zero-funds)`);
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
      await runBid(t);
    } else if (phase === "tools") {
      await runTools(t);
    } else {
      await runAward(t);
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
