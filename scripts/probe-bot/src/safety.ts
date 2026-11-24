/**
 * Safety rails (D-234-38-Q11): mandatory because target may be ANY
 * url from env (Q7). A typo in env must not turn the bot into an
 * attacker of a foreign host.
 *
 * - PROBE_ALLOWED_HOSTS env (comma list) + built-in defaults.
 * - mutating scenarios require explicit --allow-mutations.
 * - budget: max-requests cap, rate cap, dry-run prints plan, sends 0.
 * - Payment signatures are never sent — the runner has no code path
 *   that attaches PAYMENT-SIGNATURE; documented as invariant.
 */

import type { Variant } from "./types";

export const DEFAULT_ALLOWED_HOSTS = [
  "agentbadge.xyz",
  "www.agentbadge.xyz",
  "localhost",
  "127.0.0.1",
  "::1",
];

export function allowedHosts(): string[] {
  const extra = (process.env.PROBE_ALLOWED_HOSTS ?? "")
    .split(",").map(s => s.trim()).filter(Boolean);
  return [...new Set([...DEFAULT_ALLOWED_HOSTS, ...extra])];
}

/** Алиасы target'а для local↔prod переключения (SLICE-234-39):
 *  `prod` → agentbadge.xyz, `local|dev` → dev-сервер :PORT (4021). */
export function normalizeTarget(raw: string): string {
  const a = raw.trim().toLowerCase();
  if (a === "prod" || a === "production") return "https://agentbadge.xyz";
  if (a === "local" || a === "dev" || a === "localhost") {
    return `http://localhost:${process.env.PROBE_LOCAL_PORT ?? process.env.PORT ?? 4021}`;
  }
  return raw;
}

export function checkTarget(rawUrl: string, extraAllowed: string[] = []): { ok: boolean; host: string; reason?: string } {
  let u: URL;
  try {
    u = new URL(normalizeTarget(rawUrl));
  } catch {
    return { ok: false, host: "", reason: `bad target URL: ${rawUrl}` };
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    return { ok: false, host: u.hostname, reason: `protocol ${u.protocol} not allowed` };
  }
  const allowed = [...allowedHosts(), ...extraAllowed];
  if (!allowed.includes(u.hostname)) {
    return { ok: false, host: u.hostname, reason: `host ${u.hostname} not in PROBE_ALLOWED_HOSTS (${allowed.join(",")})` };
  }
  return { ok: true, host: u.hostname };
}

/** Paths the bot never fires — even mutating-allowed runs. */
const HARD_DENY = [
  /pay|payment|settle|payout|withdraw/i,
  /admin\/(settlement|finance)/i,
  /passport\/request/i, // paid passport mint ($0.10 + writes)
];

export function isHardDenied(path: string): boolean {
  return HARD_DENY.some(re => re.test(path));
}

export interface PlanItem {
  caseKey: string;
  endpoint: string;
  method: string;
  scenario: string;
  layer: string;
  mutating: boolean;
  dbVerify: boolean;
  variantHash: string;
  variant: Variant;
  /** SLICE-258-25: audited read-only endpoint may bypass hard-deny
   *  (registry per-endpoint opt-in; e.g. /.well-known/x402-payto.json
   *  is static GET but matches /pay/i). Mutating-flag rules apply
   *  on top regardless. */
  denyExempt?: boolean;
  skippedReason?: string;
}

export interface PlanResult {
  fire: PlanItem[];
  skipped: PlanItem[];
  abortedReasons: string[];
}

/** Apply safety policy to a raw plan: denylist, mutating flag, budget. */
export function applySafety(items: PlanItem[], opts: {
  allowMutations: boolean;
  maxRequests: number;
}): PlanResult {
  const fire: PlanItem[] = [];
  const skipped: PlanItem[] = [];
  const abortedReasons: string[] = [];

  for (const it of items) {
    if (it.skippedReason) {           // dedupe-скип из buildPlan (pass/newOnly/suspectOnly)
      skipped.push(it);
      continue;
    }
    if (isHardDenied(it.variant.path) && !it.denyExempt) {
      skipped.push({ ...it, skippedReason: "hard-deny path" });
      continue;
    }
    if (it.mutating && !opts.allowMutations) {
      skipped.push({ ...it, skippedReason: "mutating (needs --allow-mutations)" });
      continue;
    }
    fire.push(it);
  }

  if (fire.length > opts.maxRequests) {
    abortedReasons.push(`plan ${fire.length} > --max-requests ${opts.maxRequests} — truncated`);
    return { fire: fire.slice(0, opts.maxRequests), skipped, abortedReasons };
  }
  return { fire, skipped, abortedReasons };
}
