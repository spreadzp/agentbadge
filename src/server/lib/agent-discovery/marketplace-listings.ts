/**
 * EPIC-242: external marketplace listings — single source of truth for
 * every LLM/SEO/GEO/machine-readable surface that advertises where
 * AgentBadge paid services are distributed.
 *
 * Consumers: llms.txt (llms-core), skill.json, /.well-known/agentbadge.json,
 * Organization JSON-LD (sameAs). Add a venue here → it propagates.
 *
 * status vocabulary:
 *  - "pending_review" — submitted, waiting for marketplace approval
 *    (do NOT claim as live distribution until approved).
 *  - "listed"         — live on the marketplace's public catalog.
 *  - "indexed"        — discoverable via the venue's machine discovery
 *    (e.g. x402 bazaar / Circle Discovery API), no manual listing needed.
 */

export interface MarketplaceListing {
  /** Marketplace display name. */
  marketplace: string;
  /** Public catalog URL (the venue's services page). */
  catalogUrl: string;
  /** What we listed, in words an agent can quote. */
  service: string;
  /** Paid endpoint the listing points at (our URL, POST). */
  endpoint: string;
  /** Settlement rail shown to buyers. */
  rail: string;
  status: "pending_review" | "listed" | "indexed";
  /** ISO date of submission/go-live when known. */
  since?: string;
}

export const MARKETPLACE_LISTINGS: MarketplaceListing[] = [
  {
    marketplace: "Circle Agent Services Marketplace",
    catalogUrl: "https://agents.circle.com/services",
    service: "AgentBadge Agent-Readiness Scan",
    endpoint: "POST https://agentbadge.xyz/api/total-scan",
    rail: "x402 — USDC on Arc (EIP-3009 transferWithAuthorization)",
    status: "pending_review", // submitted 2026-11-12 → flip to "listed" on approval
    since: "2026-11-12",
  },
  {
    marketplace: "x402 Bazaar (in-protocol discovery)",
    catalogUrl: "https://agentbadge.xyz/api/v1/services",
    service: "All paid endpoints — bazaar extension on every HTTP 402 response",
    endpoint: "any x402-gated path (e.g. POST /api/total-scan)",
    rail: "x402 — USDC on Arc",
    status: "indexed", // bazaar extensions ship on each 402 already
  },
];

/** Render-ready lines for markdown surfaces (llms.txt, skill.md). */
export function listingsAsLines(): string[] {
  return MARKETPLACE_LISTINGS.map(
    (l) =>
      `- [${l.marketplace}](${l.catalogUrl}) — ${l.service} \u2192 \`${l.endpoint}\` (${l.rail})${l.status !== "listed" ? ` — *${l.status.replaceAll("_", " ")}*` : ""}`,
  );
}
