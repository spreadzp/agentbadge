// SLICE-258-5: MPP (WWW-Authenticate: Payment) challenge parsing.
// A 402 response can carry `Payment` auth-scheme challenges whose
// `request` param is a base64/base64url JSON document:
//   Payment method="tempo", request="<b64 x402-style {accepts[]}>"
//   Payment method="stripe", request="<b64url {amount,currency,recipient>}>"
// The payout-relevant fields are `recipient` (stripe), `accepts[].payTo`
// (tempo embeds an x402 payload) and a bare `payTo` (tolerant fallback).
export interface MppQuote {
  method: string;
  payTo: string;
  network?: string;
  asset?: string;
}

/** Split the header into per-challenge segments that start with the
 *  `Payment` auth scheme — params of one challenge never bleed into
 *  the next (a new challenge begins at `, <token> <params>`). */
function paymentSegments(wwwAuth: string): string[] {
  const out: string[] = [];
  // A challenge boundary = `,` followed by `<scheme> ` where the next
  // token is NOT `key=` — inside-challenge params are `key="v"` pairs.
  const re = /(?:^|,)\s*Payment\s+([^,]*(?:,(?!\s*[A-Za-z][A-Za-z0-9-]*\s)[^,]*)*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(wwwAuth)) !== null) {
    out.push(`Payment ${m[1]}`);
  }
  return out;
}

function decodeB64Any(s: string): unknown | null {
  for (const enc of ["base64", "base64url"] as const) {
    try {
      return JSON.parse(Buffer.from(s, enc).toString("utf-8"));
    } catch {
      /* try the other alphabet */
    }
  }
  return null;
}

function param(segment: string, name: string): string | null {
  const m = segment.match(new RegExp(`(?:^|[,\\s])${name}="([^"]+)"`));
  return m ? m[1] : null;
}

interface MppAcceptLike {
  payTo?: string;
  network?: string;
  asset?: string;
}

function quotesFromRequest(doc: unknown, method: string): MppQuote[] {
  if (typeof doc !== "object" || doc === null) return [];
  const d = doc as Record<string, unknown>;
  const out: MppQuote[] = [];
  if (typeof d.recipient === "string" && d.recipient) {
    out.push({ method, payTo: d.recipient });
  }
  if (typeof d.payTo === "string" && d.payTo) {
    out.push({ method, payTo: d.payTo });
  }
  if (Array.isArray(d.accepts)) {
    for (const a of d.accepts as MppAcceptLike[]) {
      if (a && typeof a.payTo === "string" && a.payTo) {
        out.push({
          method,
          payTo: a.payTo,
          network: typeof a.network === "string" ? a.network : undefined,
          asset: typeof a.asset === "string" ? a.asset : undefined,
        });
      }
    }
  }
  return out;
}

/**
 * All payout quotes (`recipient`/`payTo`) inside `WWW-Authenticate`
 * Payment challenges. Unknown methods still yield quotes — the checker
 * compares addresses, not methods. Malformed challenges are skipped.
 */
export function parsePaymentChallengeQuotes(
  wwwAuth: string | null | undefined,
): MppQuote[] {
  if (!wwwAuth) return [];
  const out: MppQuote[] = [];
  for (const seg of paymentSegments(wwwAuth)) {
    const request = param(seg, "request");
    if (!request) continue;
    const method = param(seg, "method") ?? "unknown";
    out.push(...quotesFromRequest(decodeB64Any(request), method));
  }
  return out;
}

function quoteKey(q: MppQuote): string {
  const t = q.payTo.trim();
  return /^0x[0-9a-fA-F]{40}$/.test(t) ? t.toLowerCase() : t;
}

function quoteSet(quotes: MppQuote[] | undefined | null): Set<string> {
  const s = new Set<string>();
  for (const q of quotes ?? []) s.add(quoteKey(q));
  return s;
}

/** Two probes quoted different recipient sets → possible per-payment. */
export function mppQuotesDivergent(
  a: MppQuote[] | undefined | null,
  b: MppQuote[] | undefined | null,
): boolean {
  const sa = quoteSet(a);
  const sb = quoteSet(b);
  if (sa.size === 0 || sb.size === 0) return false;
  if (sa.size !== sb.size) return true;
  for (const k of sa) if (!sb.has(k)) return true;
  return false;
}
