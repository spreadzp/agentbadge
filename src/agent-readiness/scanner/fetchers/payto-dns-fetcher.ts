/**
 * Fetches `_x402-payto.<domain>` TXT records (x402 payout-proof spec).
 *
 * Mechanics per spec + SLICE-258-2:
 * - dual-DoH query (resolvers must agree — see doh-txt.ts)
 * - parent-walk: if the exact name is absent, walk up to the
 *   registrable suffix; a record on the closest ancestor wins
 * - PSL-lite: records at shared-hosting parents (onrender.com,
 *   vercel.app, github.io, …) are NOT accepted — one customer's
 *   record cannot prove another's subdomain
 * - cache discipline: positive entries live min(record TTL, 24h);
 *   negative results cache for NEGATIVE_CACHE_MS; an explicit live
 *   re-check is rate-limited to once per RECHECK_MIN_MS per domain
 * - resolver failure => status "unchecked", NEVER "absent"
 *
 * NOTE: `lookupNameCandidates`/`isSharedHostingSuffix` mirror
 * packages/x402-payto-proof/src/psl.ts — keep the sets in sync
 * until @agentbadge/x402-payto-proof is published and can be
 * imported directly.
 */
import { queryDohTxt } from "./doh-txt";

const SHARED_HOSTING_SUFFIXES = new Set([
  "onrender.com",
  "workers.dev",
  "vercel.app",
  "netlify.app",
  "herokuapp.com",
  "fly.dev",
  "pages.dev",
  "github.io",
  "gitlab.io",
  "web.app",
  "firebaseapp.com",
  "azurewebsites.net",
  "cloudfront.net",
  "amazonaws.com",
  "up.railway.app",
  "railway.app",
  "repl.co",
  "replit.app",
  "glitch.me",
  "surge.sh",
  "deno.dev",
  "edgecompute.app",
]);

function isSharedHostingSuffix(name: string): boolean {
  const lower = name.toLowerCase().replace(/\.$/, "");
  for (const suffix of SHARED_HOSTING_SUFFIXES) {
    if (lower === suffix || lower.endsWith(`.${suffix}`)) return true;
  }
  return false;
}

/**
 * Host + parents up to (but not including) the registrable suffix.
 * On shared hosting, customer subdomains walk to their own
 * platform-level root (myapp.onrender.com) but never the platform
 * domain itself.
 */
export function paytoLookupNames(host: string): string[] {
  const labels = host.toLowerCase().replace(/\.$/, "").split(".");
  const names: string[] = [];
  for (let i = 0; i <= labels.length - 2; i++) {
    const name = labels.slice(i).join(".");
    if (SHARED_HOSTING_SUFFIXES.has(name)) break;
    names.push(name);
  }
  return names;
}

export type PayToDnsStatus = "hit" | "absent" | "unchecked";

export interface PayToDnsFetchResult {
  domain: string;
  /** DNS name that produced records (may be a parent), else null. */
  hitName: string | null;
  queryNames: string[];
  /** Raw TXT `data` payloads as DoH returned them. */
  records: { data: string; ttl: number }[];
  status: PayToDnsStatus;
  /** true when a shared-hosting parent cut the walk short. */
  pslStopped: boolean;
  fromCache: boolean;
  fetchTime: number;
}

const MAX_POSITIVE_TTL_MS = 24 * 60 * 60 * 1000;
const NEGATIVE_CACHE_MS = 5 * 60 * 1000;
export const RECHECK_MIN_MS = 60 * 1000;

interface CacheEntry {
  status: PayToDnsStatus;
  hitName: string | null;
  records: { data: string; ttl: number }[];
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const lastRecheck = new Map<string, number>();

/** Test hook: reset module-level caches. */
export function resetPayToDnsCache(): void {
  cache.clear();
  lastRecheck.clear();
}

async function lookupLive(
  domain: string,
): Promise<Omit<PayToDnsFetchResult, "domain" | "fromCache" | "fetchTime">> {
  const queryNames = paytoLookupNames(domain).map((n) => `_x402-payto.${n}`);
  // The parent walk was truncated by the shared-suffix rule when the
  // domain itself lives on shared hosting (its own record is fine —
  // the parents' are not).
  const pslStopped = isSharedHostingSuffix(domain);

  for (const qname of queryNames) {
    // Defensive: never accept a record published AT the shared
    // parent itself — it says nothing about the customer subdomain.
    const parentPart = qname.slice("_x402-payto.".length);
    if (SHARED_HOSTING_SUFFIXES.has(parentPart)) continue;
    const r = await queryDohTxt(qname, { dual: true });
    if (r.status === "ok") {
      return {
        hitName: qname,
        queryNames,
        records: r.answers.map((a) => ({ data: a.data, ttl: a.ttl })),
        status: "hit",
        pslStopped,
      };
    }
    if (r.status === "unchecked") {
      // Resolver failure is not absence — stop the walk here.
      return { hitName: null, queryNames, records: [], status: "unchecked", pslStopped };
    }
    // absent → try the parent
  }
  return { hitName: null, queryNames, records: [], status: "absent", pslStopped };
}

/**
 * Fetch `_x402-payto` records for `domain`.
 * `forceRecheck` performs a live lookup bypassing the cache —
 * rate-limited to once per RECHECK_MIN_MS per domain (spec:
 * protects resolvers from a hostile server driving rechecks).
 */
export async function fetchPayToDns(
  domain: string,
  opts: { forceRecheck?: boolean } = {},
): Promise<PayToDnsFetchResult> {
  const start = Date.now();
  const key = domain.toLowerCase();
  const now = Date.now();

  const entry = cache.get(key);
  if (entry && entry.expiresAt > now && !opts.forceRecheck) {
    return {
      domain,
      hitName: entry.hitName,
      queryNames: [],
      records: entry.records,
      status: entry.status,
      pslStopped: false,
      fromCache: true,
      fetchTime: Date.now() - start,
    };
  }
  if (
    opts.forceRecheck &&
    lastRecheck.has(key) &&
    now - lastRecheck.get(key)! < RECHECK_MIN_MS
  ) {
    // Rate limit hit — serve the cached view if any, else unchecked.
    if (entry) {
      return {
        domain,
        hitName: entry.hitName,
        queryNames: [],
        records: entry.records,
        status: entry.status,
        pslStopped: false,
        fromCache: true,
        fetchTime: Date.now() - start,
      };
    }
    return {
      domain,
      hitName: null,
      queryNames: [],
      records: [],
      status: "unchecked",
      pslStopped: false,
      fromCache: false,
      fetchTime: Date.now() - start,
    };
  }
  if (opts.forceRecheck) lastRecheck.set(key, now);

  const live = await lookupLive(domain);
  // Any live lookup counts toward the recheck rate limit — a
  // forceRecheck within RECHECK_MIN_MS of a normal scan's lookup
  // must also be throttled.
  lastRecheck.set(key, now);

  // Only cache evidence: hits for min(record TTL, 24h), verified
  // absence for NEGATIVE_CACHE_MS. "unchecked" is transient —
  // never cache it or a blip suppresses the next real lookup.
  if (live.status !== "unchecked") {
    const ttlMs =
      live.status === "hit"
        ? Math.min(
            Math.max(...live.records.map((r) => r.ttl), 0) * 1000 || MAX_POSITIVE_TTL_MS,
            MAX_POSITIVE_TTL_MS,
          )
        : NEGATIVE_CACHE_MS;
    cache.set(key, {
      status: live.status,
      hitName: live.hitName,
      records: live.records,
      expiresAt: now + ttlMs,
    });
  }

  return {
    domain,
    ...live,
    fromCache: false,
    fetchTime: Date.now() - start,
  };
}
