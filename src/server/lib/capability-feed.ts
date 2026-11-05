/**
 * SLICE-206-14 (EPIC-206): capability announcements for the agent feed.
 *
 * Bots already poll /feed (RSS). A new endpoint/skill buried between
 * blog articles is invisible to them — they need a typed, machine-
 * readable item they can route on. This module is the source of truth:
 *
 *   CAPABILITY_CHANGELOG — append-only, one entry per shipped surface.
 *     When you add an endpoint or change a price, append an entry
 *     (date = ship date). Never reorder, never edit past entries.
 *
 * Consumers:
 *   - /feed      → capability items rendered as RSS <item> with
 *                  <category>capability</category> (spec: "capability
 *                  entries наряду со статьями").
 *   - /feed.json → JSON Feed 1.1 with full typed fields
 *                  {_type, _endpoint, _method, _price} per item.
 *
 * Deterministic: every date comes from the changelog/blog data —
 * no request-time timestamps.
 */

export interface CapabilityEntry {
  /** Always "capability" — lets consumers filter without heuristics. */
  readonly type: "capability";
  /** Human title, e.g. "New endpoint: GET /pricing.json". */
  readonly title: string;
  /** Directly callable path or METHOD /path. */
  readonly endpoint: string;
  readonly method: "GET" | "POST";
  /** "free" | USDC price string | "x402" — matches /pricing.json units. */
  readonly price: string;
  /** ISO date the capability shipped (feed pubDate source). */
  readonly added_at: string;
  readonly description?: string;
}

export const CAPABILITY_CHANGELOG: readonly CapabilityEntry[] = [
  {
    type: "capability",
    title: "New endpoint: GET /feed.json",
    endpoint: "/feed.json",
    method: "GET",
    price: "free",
    added_at: "2026-11-05",
    description:
      "JSON Feed 1.1 — articles plus machine-readable capability " +
      "entries {_type:'capability', _endpoint, _method, _price}.",
  },
  {
    type: "capability",
    title: "New endpoints: agent-native task writes",
    endpoint: "POST /api/tasks/:id/bids",
    method: "POST",
    price: "free",
    added_at: "2026-11-04",
    description:
      "Sig-auth (agentbadge-access:v1) task contour: bids, awards, " +
      "deliverables, verdict. Discover via /.well-known/agentbadge-machine.json.",
  },
  {
    type: "capability",
    title: "New endpoint: GET /api/tasks/open",
    endpoint: "/api/tasks/open",
    method: "GET",
    price: "free",
    added_at: "2026-11-04",
    description:
      "Keyless list of open marketplace tasks with machine_entry " +
      "phase args — agents bid without registration.",
  },
  {
    type: "capability",
    title: "New endpoint: GET /pricing.json + /pricing.md",
    endpoint: "/pricing.json",
    method: "GET",
    price: "free",
    added_at: "2026-11-04",
    description:
      "Machine-readable price list derived from the ServiceSku " +
      "registry — schema agentbadge.pricing.v1, USDC on eip155:5042.",
  },
  {
    type: "capability",
    title: "New endpoint: /.well-known/agentbadge-machine.json",
    endpoint: "/.well-known/agentbadge-machine.json",
    method: "GET",
    price: "free",
    added_at: "2026-11-04",
    description:
      "Global machine descriptor: phases, endpoints, auth schemes, " +
      "limits — the single discovery document for the task contour.",
  },
  {
    type: "capability",
    title: "New endpoint: GET /api/v1/services",
    endpoint: "/api/v1/services",
    method: "GET",
    price: "free",
    added_at: "2026-11-03",
    description:
      "Canonical paid-services catalog from the ServiceSku registry — " +
      "endpoint, canonical USD price, input_schema, auth per SKU.",
  },
];

const escapeXml = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

/** RSS <item> for a capability entry — category tag is the filter hook. */
export function capabilityToRssItem(
  entry: CapabilityEntry,
  baseUrl: string,
): string {
  const pubDate = new Date(entry.added_at).toUTCString();
  const desc =
    `${entry.method} ${entry.endpoint} — ${entry.price}. ` +
    (entry.description ?? "");
  return `    <item>
      <title>${escapeXml(entry.title)}</title>
      <link>${baseUrl}${entry.endpoint.startsWith("/") ? entry.endpoint : ""}</link>
      <category>capability</category>
      <description>${escapeXml(desc)}</description>
      <pubDate>${pubDate}</pubDate>
      <guid>capability:${entry.method} ${entry.endpoint}@${entry.added_at}</guid>
    </item>`;
}

/** JSON Feed 1.1 item for a capability entry — typed extension fields. */
export function capabilityToFeedItem(entry: CapabilityEntry) {
  return {
    id: `capability:${entry.method} ${entry.endpoint}@${entry.added_at}`,
    title: entry.title,
    content_text:
      `${entry.method} ${entry.endpoint} — ${entry.price}. ` +
      (entry.description ?? ""),
    date_published: `${entry.added_at}T00:00:00.000Z`,
    tags: ["capability"],
    _type: "capability",
    _endpoint: entry.endpoint,
    _method: entry.method,
    _price: entry.price,
    _added_at: entry.added_at,
  };
}
