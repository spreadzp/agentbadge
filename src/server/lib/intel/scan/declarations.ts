// EPIC-262 (SLICE-262-4 corpus): agent-surface declaration parsing —
// the audit-259 checker corpus (kid-unification, nonzero sha256,
// price-consistency, dead-advertised-URL) needs structured facts out
// of the well-known JSON documents a site publishes. Everything here
// is extraction only: parse → bounded facts, never trust escalation.
import type { CanonicalEnvelope } from "../evidence/envelope";
import type { CollectorSubmission } from "../evidence/submission";
import type { ScanObservation } from "./fetcher";

/** Well-known declaration endpoints added to the probe plan. */
export const DECLARATION_PATHS = [
  "/.well-known/agent-card.json",
  "/.well-known/agent.json",
  "/.well-known/did.json",
  "/.well-known/jwks.json",
  "/.well-known/http-message-signatures-directory",
  "/.well-known/agent-start.json",
  "/.well-known/x402-payto.json",
  "/pricing.json",
] as const;

export const ADVERTISED_FANOUT_MAX = 8;
const URLS_MAX = 16;
const PAIRS_MAX = 16;
const PRICES_MAX = 16;
const DIGESTS_MAX = 8;

interface KeyPair {
  kid: string;
  x: string;
}
interface DeclaredPrice {
  amount: string;
  asset: string | null;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/** All string values under any key that look like http(s) URLs. */
function harvestUrls(v: unknown, out: Set<string>, depth: number): void {
  if (out.size >= URLS_MAX || depth > 6) return;
  if (typeof v === "string") {
    if (/^https?:\/\//i.test(v)) out.add(v);
    return;
  }
  if (Array.isArray(v)) {
    for (const item of v) harvestUrls(item, out, depth + 1);
    return;
  }
  if (isObj(v)) {
    for (const item of Object.values(v)) harvestUrls(item, out, depth + 1);
  }
}

/** (kid → x) pairs across did.json verificationMethod, jwks keys,
 *  WBA directory keys — every object carrying both an identifier
 *  (kid|id) and raw key material (publicKeyJwk.x | x). */
function harvestKeyPairs(
  v: unknown,
  out: KeyPair[],
  depth: number,
): void {
  if (out.length >= PAIRS_MAX || depth > 6) return;
  if (Array.isArray(v)) {
    for (const item of v) harvestKeyPairs(item, out, depth + 1);
    return;
  }
  if (!isObj(v)) return;
  const x =
    typeof v.x === "string"
      ? v.x
      : isObj(v.publicKeyJwk) && typeof v.publicKeyJwk.x === "string"
        ? v.publicKeyJwk.x
        : null;
  const kid =
    typeof v.kid === "string" ? v.kid : typeof v.id === "string" ? v.id : null;
  if (x && kid) out.push({ kid, x });
  for (const item of Object.values(v)) harvestKeyPairs(item, out, depth + 1);
}

/** Field paths whose value is a placeholder digest: ≥32 hex chars,
 *  all identical — the zero-sha256 class of bug (259 F5). */
function harvestPlaceholderDigests(
  v: unknown,
  out: string[],
  path: string,
  depth: number,
): void {
  if (out.length >= DIGESTS_MAX || depth > 6) return;
  if (Array.isArray(v)) {
    v.forEach((item, i) =>
      harvestPlaceholderDigests(item, out, `${path}[${i}]`, depth + 1),
    );
    return;
  }
  if (!isObj(v)) return;
  for (const [k, val] of Object.entries(v)) {
    const p = path ? `${path}.${k}` : k;
    if (
      /sha256|digest|hash/i.test(k) &&
      typeof val === "string" &&
      /^[0-9a-f]{32,}$/i.test(val) &&
      new Set(val.toLowerCase().split("")).size === 1
    ) {
      out.push(p);
    }
    harvestPlaceholderDigests(val, out, p, depth + 1);
  }
}

/** Declared prices: objects with `price`/`amount`/`maxAmountRequired`
 *  (+asset when present) — the declaration side of price-consistency. */
function harvestPrices(v: unknown, out: DeclaredPrice[], depth: number): void {
  if (out.length >= PRICES_MAX || depth > 6) return;
  if (Array.isArray(v)) {
    for (const item of v) harvestPrices(item, out, depth + 1);
    return;
  }
  if (!isObj(v)) return;
  const amount = v.maxAmountRequired ?? v.price ?? null;
  if (typeof amount === "string" || typeof amount === "number") {
    const asset =
      typeof v.asset === "string"
        ? v.asset
        : typeof v.priceCurrency === "string"
          ? v.priceCurrency
          : typeof v.currency === "string"
            ? v.currency
            : null;
    out.push({ amount: String(amount), asset });
  }
  for (const item of Object.values(v)) harvestPrices(item, out, depth + 1);
}

/** document_fact facts for a well-known JSON document. */
export function wellKnownFacts(bodyText: string): Record<string, unknown> {
  let doc: unknown;
  try {
    doc = JSON.parse(bodyText);
  } catch {
    return { parse_ok: false };
  }
  const urls = new Set<string>();
  const pairs: KeyPair[] = [];
  const digests: string[] = [];
  const prices: DeclaredPrice[] = [];
  harvestUrls(doc, urls, 0);
  harvestKeyPairs(doc, pairs, 0);
  harvestPlaceholderDigests(doc, digests, "", 0);
  harvestPrices(doc, prices, 0);
  return {
    parse_ok: true,
    advertised_urls: [...urls],
    key_pairs: pairs,
    placeholder_digests: digests,
    declared_prices: prices,
  };
}

/** Same-origin advertised URLs collected from emitted envelopes —
 *  the bounded fan-out set (cross-origin declarations are noted but
 *  never fetched: SSRF surface stays the site itself). */
export function collectAdvertisedUrls(
  envelopes: CanonicalEnvelope[],
  baseUrl: string,
): string[] {
  let origin: string;
  try {
    origin = new URL(baseUrl).origin;
  } catch {
    return [];
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of envelopes) {
    if (e.payload.type !== "document_fact") continue;
    const urls = e.payload.facts.advertised_urls;
    if (!Array.isArray(urls)) continue;
    for (const u of urls) {
      if (typeof u !== "string" || seen.has(u) || out.length >= ADVERTISED_FANOUT_MAX)
        continue;
      try {
        if (new URL(u).origin !== origin) continue;
      } catch {
        continue;
      }
      seen.add(u);
      out.push(u);
    }
  }
  return out;
}

/** x402 402-body → the ACTUAL demanded prices (the served side of
 *  price-consistency): accepts[].{maxAmountRequired, asset}. */
export function paidAccepts(bodyText: string): DeclaredPrice[] {
  let doc: unknown;
  try {
    doc = JSON.parse(bodyText);
  } catch {
    return [];
  }
  if (!isObj(doc)) return [];
  const accepts = Array.isArray(doc.accepts)
    ? doc.accepts
    : Array.isArray(doc.paymentRequirements)
      ? doc.paymentRequirements
      : [];
  const out: DeclaredPrice[] = [];
  for (const a of accepts) {
    if (!isObj(a) || out.length >= PRICES_MAX) continue;
    const amount = a.maxAmountRequired ?? a.amount;
    if (typeof amount === "string" || typeof amount === "number") {
      out.push({
        amount: String(amount),
        asset: typeof a.asset === "string" ? a.asset : null,
      });
    }
  }
  return out;
}

/** Submissions for one fanned advertised URL: http_observation when
 *  a response exists + a document_fact marker ALWAYS (reachable:false
 *  honestly covers transport failure — status 0 isn't a legal obs). */
export function fannedToSubmissions(opts: {
  siteId: string;
  scanId: string;
  collectorId: string;
  collectedAt: string;
  url: string;
  obs: ScanObservation | null;
}): CollectorSubmission[] {
  const { url, obs } = opts;
  const base = {
    site_ref: opts.siteId,
    scan_id: opts.scanId,
    collector_id: opts.collectorId,
    collected_at: opts.collectedAt,
    evidence_refs: [] as CollectorSubmission["evidence_refs"],
  };
  // reachable = the URL serves meaningfully: any non-404/410/<500
  // answer counts (401/402/403 are live gates), dead = 404/410/5xx
  // or transport failure — the dead-advertised-URL finding class.
  const facts: Record<string, unknown> = {
    fanned_advertised: true,
    reachable:
      obs !== null &&
      obs.status !== 404 &&
      obs.status !== 410 &&
      obs.status < 500,
    ...(obs ? { status: obs.status } : {}),
  };
  if (obs?.status === 402) {
    const accepts = paidAccepts(obs.bodyText);
    if (accepts.length > 0) facts.paid_accepts = accepts;
  }
  const docFact: CollectorSubmission = {
    ...base,
    subject: { type: "url", url },
    payload: { type: "document_fact", doc_type: "other", url, facts },
  };
  if (!obs) return [docFact];
  const httpObs: CollectorSubmission = {
    ...base,
    subject: { type: "url", url },
    payload: {
      type: "http_observation",
      url,
      status: obs.status,
      headers: {},
      content_hash: undefined,
      content_type: obs.headers["content-type"] ?? null,
      resolved_ip: obs.resolvedIp,
    },
  };
  return [httpObs, docFact];
}
