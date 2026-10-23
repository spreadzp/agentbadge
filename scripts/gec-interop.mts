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

import { createHash, randomBytes } from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";

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
  // 32 random bytes → 43-char base64url verifier (spec range 43–128)
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
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
  /** Store name=value pairs from a Response's Set-Cookie headers. */
  capture(res: Response): void;
  /** Cookie header value for the next request, or undefined when empty. */
  header(): string | undefined;
  /** Cookie names held (never values — for debugging/transcripts). */
  names(): string[];
}

export function createCookieJar(): CookieJar {
  const store = new Map<string, string>();
  return {
    capture(res: Response) {
      // undici: getSetCookie() returns each Set-Cookie line separately
      for (const line of res.headers.getSetCookie?.() ?? []) {
        const first = line.split(";", 1)[0];
        const eq = first.indexOf("=");
        if (eq > 0) store.set(first.slice(0, eq).trim(), first.slice(eq + 1).trim());
      }
    },
    header() {
      if (store.size === 0) return undefined;
      return [...store.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    },
    names() {
      return [...store.keys()];
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
  body: unknown; // caller decides what survives via responseShapeOf
}

export async function timedFetch(url: string, opts: FetchOpts = {}): Promise<FetchResult> {
  const headers: Record<string, string> = { ...opts.headers };
  const cookie = opts.jar?.header();
  if (cookie) headers["cookie"] = cookie;
  if (opts.bearer) headers["authorization"] = `Bearer ${opts.bearer}`;

  const t0 = Date.now();
  const res = await fetch(url, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body,
    redirect: opts.redirectManual ? "manual" : "follow",
  });
  const ms = Date.now() - t0;

  opts.jar?.capture(res);
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* non-JSON body (HTML/empty) — keep raw text, truncated on record */
  }
  return { status: res.status, ms, location: res.headers.get("location"), body };
}

// ─── EIP-191 personal_sign (machine_entry step 4) ────────────────────────────
// Signature and challenge text are secrets — returned to the caller, never
// recorded into the transcript (mask would catch them, but we don't even try).

export function loadWallet(): { address: `0x${string}`; key: Hex } {
  const key = process.env.GEC_INTEROP_PRIVATE_KEY;
  const address = process.env.GEC_INTEROP_ADDRESS;
  if (!key || !key.startsWith("0x")) {
    throw new Error("GEC_INTEROP_PRIVATE_KEY missing/invalid in env");
  }
  const derived = privateKeyToAccount(key as Hex).address;
  if (address && derived.toLowerCase() !== address.toLowerCase()) {
    throw new Error(`GEC_INTEROP_ADDRESS mismatch: env=${address} derived=${derived}`);
  }
  return { address: derived, key: key as Hex };
}

export async function signChallenge(message: string, key: Hex): Promise<Hex> {
  const account = privateKeyToAccount(key);
  return account.signMessage({ message });
}

// ─── MCP JSON-RPC (initialize / tools/list / tools/call) ─────────────────────

export interface McpCallResult {
  status: number;
  ms: number;
  result?: unknown;
  error?: unknown;
}

export async function mcpCall(
  endpoint: string,
  method: string,
  params: Record<string, unknown>,
  opts: { bearer?: string; jar?: CookieJar } = {},
): Promise<McpCallResult> {
  const r = await timedFetch(endpoint, {
    method: "POST",
    jar: opts.jar,
    bearer: opts.bearer,
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const b = r.body as { result?: unknown; error?: unknown };
  return { status: r.status, ms: r.ms, result: b?.result, error: b?.error };
}

// ─── Phase plans (live execution: 205-5 rehearsal / 205-6 bid) ───────────────

export const REHEARSAL_STEPS = [
  "GET openDemandsApi — projection CURRENT + target demand OPEN",
  "MCP initialize on publicMcp (keyless)",
  "MCP tools/list on publicMcp",
  "MCP tools/call gec_open_demands on publicMcp",
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

function parsePhase(argv: string[]): "rehearsal" | "bid" {
  const arg = argv.find((a) => a.startsWith("--phase="));
  const phase = arg?.split("=", 2)[1];
  if (phase === "rehearsal" || phase === "bid") return phase;
  throw new Error("usage: bun run scripts/gec-interop.mts --phase=rehearsal|bid");
}

async function main(): Promise<void> {
  const phase = parsePhase(process.argv.slice(2));

  // Env + identity check WITHOUT printing secrets (key never logged).
  const { address } = loadWallet();
  const steps = phase === "rehearsal" ? REHEARSAL_STEPS : BID_STEPS;

  console.log(`[gec-interop] phase=${phase}`);
  console.log(`[gec-interop] wallet=${address} (burner, EIP-191 only, zero-funds)`);
  console.log(`[gec-interop] client_id=${clientId()}`);
  console.log(`[gec-interop] redirect_uri=${redirectUri()}`);
  console.log(`[gec-interop] target demand=${GEC_TARGET_DEMAND}`);
  console.log(`[gec-interop] planned steps:`);
  steps.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));

  // SLICE-205-3 boundary: no live network calls yet. Live execution is
  // gated to SLICE-205-5 (rehearsal, after /arc-audit) and SLICE-205-6 (bid).
  console.log(
    `\n[gec-interop] STOP before first live step — live execution is gated to ` +
      (phase === "rehearsal" ? "SLICE-205-5 (post-/arc-audit)" : "SLICE-205-6") +
      `. No network calls made.`,
  );
}

if (import.meta.main) {
  main().catch((e) => {
    console.error(`[gec-interop] fatal: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });
}
