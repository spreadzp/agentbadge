/**
 * Shared DNS-over-HTTPS TXT resolver for scanner fetchers.
 *
 * Two query modes:
 * - `dual: false` (default) — sequential fallback: dns.google first,
 *   cloudflare-dns only on transport failure (dns-aid semantics).
 * - `dual: true` — both resolvers queried; if both answer with
 *   different TXT sets the result is `unchecked` (SLICE-258-2:
 *   resolver disagreement is never resolved by picking one side).
 *
 * Status semantics (x402 payout-proof spec + dns-aid):
 * - "ok"        — resolver(s) returned TXT answers
 * - "absent"    — NOERROR with no TXT answers, or NXDOMAIN:
 *                 the record verifiably does not exist
 * - "unchecked" — SERVFAIL/REFUSED/timeouts/disagreement:
 *                 no evidence either way; MUST NOT surface as absent
 */

export const DOH_RESOLVERS = [
  "https://dns.google/resolve",
  "https://cloudflare-dns.com/dns-query",
];

export interface DohTxtAnswer {
  name: string;
  data: string;
  ttl: number;
}

export type DohTxtStatus = "ok" | "absent" | "unchecked";

export interface DohTxtResult {
  name: string;
  status: DohTxtStatus;
  answers: DohTxtAnswer[];
  /** dual mode: false when resolvers gave different TXT sets */
  resolversAgreed: boolean;
}

interface DohJsonResponse {
  Status: number;
  Answer?: { name: string; type: number; data: string; TTL?: number }[];
}

async function queryOne(
  resolver: string,
  name: string,
  timeoutMs: number,
): Promise<{ status: DohTxtStatus; answers: DohTxtAnswer[] } | null> {
  try {
    const url = `${resolver}?name=${encodeURIComponent(name)}&type=TXT`;
    const response = await fetch(url, {
      headers: { Accept: "application/dns-json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as DohJsonResponse;
    // 0 NOERROR · 3 NXDOMAIN — record verifiably absent
    // 2 SERVFAIL · 5 REFUSED · others — resolver failure, not absence
    if (data.Status === 3) return { status: "absent", answers: [] };
    if (data.Status !== 0) return null;
    const answers = (data.Answer ?? [])
      .filter((a) => a.type === 16) // TXT
      .map((a) => ({ name: a.name, data: a.data, ttl: a.TTL ?? 0 }));
    return { status: answers.length > 0 ? "ok" : "absent", answers };
  } catch {
    return null;
  }
}

/**
 * Canonical form of a DoH TXT `data` field. dns.google returns the
 * bare character-string; cloudflare-dns returns RFC-1035 quoted
 * presentation (`"str"`, possibly `"s1" "s2"` chunks). Decode to the
 * joined string content so formatting alone cannot fake disagreement
 * (found dogfooding: identical record reported `unchecked`).
 */
function txtCanonical(data: string): string {
  const parts = data.match(/"(?:[^"\\]|\\.)*"/g);
  if (!parts) return data;
  return parts.map((p) => p.slice(1, -1).replace(/\\(.)/g, "$1")).join("");
}

function normalizeSet(answers: DohTxtAnswer[]): string {
  return answers
    .map((a) => txtCanonical(a.data).replace(/\s/g, "").toLowerCase())
    .sort()
    .join("\u0001");
}

export async function queryDohTxt(
  name: string,
  opts: { dual?: boolean; timeoutMs?: number } = {},
): Promise<DohTxtResult> {
  const timeoutMs = opts.timeoutMs ?? 5000;

  if (!opts.dual) {
    for (const resolver of DOH_RESOLVERS) {
      const r = await queryOne(resolver, name, timeoutMs);
      if (r !== null) {
        return { name, status: r.status, answers: r.answers, resolversAgreed: true };
      }
    }
    return { name, status: "unchecked", answers: [], resolversAgreed: true };
  }

  const [a, b] = await Promise.all([
    queryOne(DOH_RESOLVERS[0], name, timeoutMs),
    queryOne(DOH_RESOLVERS[1], name, timeoutMs),
  ]);
  const live = [a, b].filter((r) => r !== null);
  // Dual mode is a *safety* mode (arc-review H1): both resolvers must
  // answer, and they must answer the SAME thing. A single survivor or
  // a status mismatch proves nothing — report unchecked, never pick
  // a side (a poisoned resolver must not inject a proof or force
  // absence).
  if (live.length < 2) {
    return { name, status: "unchecked", answers: [], resolversAgreed: false };
  }
  if (a!.status !== b!.status) {
    return { name, status: "unchecked", answers: [], resolversAgreed: false };
  }
  if (
    a!.status === "ok" &&
    normalizeSet(a!.answers) !== normalizeSet(b!.answers)
  ) {
    return { name, status: "unchecked", answers: [], resolversAgreed: false };
  }
  return {
    name,
    status: a!.status,
    answers: a!.answers,
    resolversAgreed: true,
  };
}
