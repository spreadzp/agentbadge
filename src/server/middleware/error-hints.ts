/**
 * SLICE-206-11 (EPIC-206): machine-readable recovery hints on JSON
 * 401/402/403 error bodies.
 *
 * Post-response middleware: after the handler (or an x402 gate) produces
 * a JSON error, the body is merged with onboarding pointers so an agent
 * can self-recover without reading prose docs:
 *
 *   401 → how_to_fix + register (/api/v1/agents/register) + auth guide
 *   402 → how_to_fix + payment metadata (x402, USDC on Arc, pricing.json)
 *   403 → how_to_fix + register + trust-tiers ladder
 *
 * Scope rules (landmine-safe):
 * - JSON bodies only — HTML and plain-text errors pass through untouched.
 * - Fields are only ADDED — `accepts`, `x402Version`, `error`, `code`,
 *   `hint`, `refund` etc. all survive (x402 clients ignore extras).
 * - A route that already set `how_to_fix` keeps its own value.
 */

import type { Context, Next } from "hono";
import { BASE_URL } from "../lib/page-meta";

const HINTS: Record<number, Record<string, unknown>> = {
  401: {
    how_to_fix:
      "Provide valid credentials: Authorization: Bearer agb_<key> for keyed endpoints, X-Wallet/X-Sig/X-Timestamp EIP-191 (agentbadge-access:v1) for task writes and pass-gated endpoints, or X-AgentBadge-* DID headers for legacy writes. See /agent-guide/getting-started.",
    register: "/api/v1/agents/register",
    docs: "/agent-guide/getting-started",
    machine_entry: "/.well-known/agentbadge-machine.json",
  },
  402: {
    how_to_fix:
      "This endpoint is x402-paid. Sign the payment requirements from the accepts[] array (USDC, EIP-3009 on Arc eip155:5042) and retry with a PAYMENT-SIGNATURE header. Prices: /pricing.json.",
    payment: {
      protocol: "x402",
      asset: "USDC",
      network: "eip155:5042",
      pricing: "/pricing.json",
      services: "/api/v1/services",
    },
  },
  403: {
    how_to_fix:
      "Access denied — the caller lacks identity, tier, or role. Register at /api/v1/agents/register for the observer tier (Bearer agb_ key); tiers in /api/meta/trust-tiers. On task writes, role rules apply (verdict signer must differ from owner/worker/platform — see machine_entry invariants).",
    register: "/api/v1/agents/register",
    trust_tiers: "/api/meta/trust-tiers",
    machine_entry: "/.well-known/agentbadge-machine.json",
  },
};

export function errorHints() {
  return async (c: Context, next: Next): Promise<void> => {
    await next();

    const res = c.res;
    if (!res) return;
    const hints = HINTS[res.status];
    if (!hints) return;

    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("application/json")) return; // HTML/text — untouched

    let body: Record<string, unknown>;
    try {
      body = (await res.clone().json()) as Record<string, unknown>;
    } catch {
      return; // unparseable body — leave as-is
    }
    if (body === null || typeof body !== "object" || Array.isArray(body)) return;

    const merged = { ...body };
    for (const [k, v] of Object.entries(hints)) {
      if (!(k in merged)) merged[k] = v;
    }
    merged.docs = merged.docs ?? `${BASE_URL}/agent-guide/getting-started`;

    const headers = new Headers(res.headers);
    headers.delete("content-length");
    c.res = new Response(JSON.stringify(merged), {
      status: res.status,
      statusText: res.statusText,
      headers,
    });
  };
}
