/**
 * SLICE-259-18: workflow contract bodies for
 * /.well-known/agent-workflows.json. Extracted from agent-workflows.ts
 * (300-line cap) — types/probes/builder live there.
 */
import type { DiscoverySources } from "./sources";
import type { AgentWorkflow } from "./agent-workflows";

const X402_AUTH =
  "x402 exact — first call returns 402 + PAYMENT-REQUIRED (base64 JSON: " +
  "scheme exact, network eip155:5042, USDC 0x3600000000000000000000000000000000000000); " +
  "sign EIP-3009 transferWithAuthorization and retry with `payment-signature` header";

export function agentWorkflows(src: DiscoverySources): AgentWorkflow[] {
  const b = src.baseUrl;
  return [
    {
      id: "knowledge-search",
      name: "Search the knowledge base",
      description:
        "Full-text search over published rules, guides and articles. " +
        "Anonymous allowed (rate-limited); an agb_ key raises limits.",
      discovery: { endpoint: `${b}/api/specs`, method: "GET", protocol: "https" },
      preconditions: {
        authentication: "none (Bearer agb_… optional — higher limits)",
        permissions: [],
        ownership_required: false,
      },
      input: {
        content_type: "query-params",
        schema$ref: `${b}/api/specs#/paths/~1api~1v1~1agent~1knowledge~1search`,
      },
      execution: {
        method: "GET",
        endpoint: `${b}/api/v1/agent/knowledge/search?q={query}&limit={1..50}&kind={kind}`,
        async: false,
        idempotency: "idempotent",
      },
      inspection: {
        response_schema: "{results:[{itemId,slug,kind,title,summary,snippet,rank}],query,engine,tookMs}",
        result_fields: ["results", "results[].slug", "results[].rank", "engine"],
      },
      verification: {
        method: "response_fields",
        success_conditions: ["status == 200", "results is an array", "query echoes input"],
      },
      autonomy: "autonomous",
      next_actions: [`GET ${b}/blog/{slug}.json — fetch the matching knowledge object`],
      errors: [
        { code: "invalid_input", http: 400, retryable: false },
        { code: "rate_limited", http: 429, retryable: true },
      ],
    },
    {
      id: "passport-verify",
      name: "Verify an agent passport",
      description:
        "Read a passport NFT by tokenId+serial — tier, status, revocation — " +
        "from the mirror of the canonical ERC-8004 registry.",
      discovery: { endpoint: `${b}/api/specs`, method: "GET", protocol: "https" },
      preconditions: {
        authentication: "none",
        permissions: [],
        ownership_required: false,
      },
      input: {
        content_type: "path-params",
        schema$ref: `${b}/api/specs#/paths/~1passport~1{tokenId}~1{serial}`,
      },
      execution: {
        method: "GET",
        endpoint: `${b}/passport/{tokenId}/{serial}`,
        async: false,
        idempotency: "idempotent",
      },
      inspection: {
        response_schema: "{tokenId,serial,owner,tier,status,...,_links}",
        result_fields: ["tier", "status", "owner", "_links"],
      },
      verification: {
        method: "response_fields",
        endpoint: `${b}/passport/address/{address}`,
        success_conditions: ["status == 200", "tier and status present", "_links.verified resolvable"],
      },
      autonomy: "autonomous",
      next_actions: [`GET ${b}/passports — list all passports (paginated)`],
      errors: [
        { code: "invalid_input", http: 400, retryable: false },
        { code: "passport_not_found", http: 404, retryable: false },
        { code: "mirror_node_unavailable", http: 503, retryable: true },
      ],
    },
    {
      id: "agent-register",
      name: "Self-serve agent registration",
      description:
        "Mint into the canonical ERC-8004 identity registry and receive an " +
        "agb_ API key (observer tier). The key is shown once — persist it. " +
        "Optional sponsored path: human owner pre-signs an EIP-191 intent.",
      discovery: { endpoint: `${b}/.well-known/agent-registration.json`, method: "GET", protocol: "https" },
      preconditions: {
        authentication: "none for basic path; owner EIP-191 signature for sponsored mint",
        permissions: [],
        ownership_required: false,
      },
      input: {
        content_type: "application/json",
        schema$ref: `${b}/api/specs#/paths/~1api~1v1~1agents~1register`,
      },
      execution: {
        method: "POST",
        endpoint: `${b}/api/v1/agents/register`,
        async: false,
        idempotency: "none",
      },
      inspection: {
        response_schema: "201 {agent:{agentId,...}, api_key:'agb_…'}",
        result_fields: ["agent.agentId", "api_key"],
      },
      verification: {
        method: "authenticated_read",
        endpoint: `${b}/api/v1/agents/me`,
        success_conditions: ["GET /api/v1/agents/me with Bearer api_key → 200", "agentId matches registration record"],
      },
      autonomy: "autonomous",
      next_actions: [
        `GET ${b}/mcp with Authorization: Bearer agb_… — full public+authenticated tool list`,
        `DELETE ${b}/api/v1/agents/me — self-revoke the key`,
      ],
      errors: [
        { code: "invalid_json", http: 400, retryable: false },
        { code: "register_rate_limited", http: 429, retryable: true },
        { code: "execution_failed", http: 503, retryable: true },
      ],
    },
    {
      id: "website-scan",
      name: "Agent-readiness scan of a website",
      description:
        "Full ruleset scan (robots/llms.txt/conneg/JSON-LD/MCP/…) streamed " +
        "as SSE: progress events → result event {score,grade,categories} → " +
        "done. Auth via x402 payment or an AccessPassNFT (X-Wallet/X-Sig/" +
        "X-Timestamp challenge headers — see /agent-access.md). " +
        "Optional packs:[] scopes to rule bundles (ids at GET /api/scan-packs).",
      discovery: { endpoint: `${b}/pricing.json`, method: "GET", protocol: "https" },
      preconditions: {
        authentication: `${X402_AUTH}; or access-pass headers (X-Wallet/X-Sig/X-Timestamp)`,
        permissions: ["public-web-fetch"],
        ownership_required: false,
      },
      input: {
        content_type: "application/json",
        schema$ref: `${b}/api/specs#/paths/~1api~1total-scan`,
      },
      execution: {
        method: "POST",
        endpoint: `${b}/api/total-scan`,
        async: true,
        idempotency: "none",
      },
      inspection: {
        response_schema: "text/event-stream: event:progress → event:result {score,grade,categories,gaps} → event:done",
        result_fields: ["score", "grade", "categories", "gaps"],
      },
      verification: {
        method: "stream_events",
        success_conditions: ["event:result carries report with numeric score", "stream terminates with event:done"],
      },
      autonomy: "conditional",
      next_actions: [
        `GET ${b}/api/scan-packs — bundle catalog + prices`,
        `GET ${b}/api/v1/demo/scan-lite?url={url} — $0.001 teaser before full scan`,
      ],
      errors: [
        { code: "invalid_input", http: 400, retryable: false },
        { code: "unauthorized", http: 401, retryable: false },
        { code: "payment_required", http: 402, retryable: true },
        { code: "forbidden", http: 403, retryable: false },
        { code: "rate_limited", http: 429, retryable: true },
      ],
    },
    {
      id: "x402-paid-call",
      name: "Execute a paid call over x402",
      description:
        "The generic paid-call flow, demonstrated on the cheapest live " +
        "endpoint (GET /api/v1/demo/scan-lite?url=…, ~$0.001 USDC): call → " +
        "402 + PAYMENT-REQUIRED → decode requirements → human approval → " +
        "EIP-3009 signature → retry with payment-signature → result. " +
        "Same flow applies to /api/total-scan and /api/scan-packs.",
      discovery: { endpoint: `${b}/.well-known/x402`, method: "GET", protocol: "https" },
      preconditions: {
        authentication: X402_AUTH,
        permissions: ["usdc-spend"],
        ownership_required: false,
      },
      input: {
        content_type: "query-params",
        schema$ref: `${b}/api/specs#/paths/~1api~1v1~1demo~1scan-lite`,
      },
      execution: {
        method: "GET",
        endpoint: `${b}/api/v1/demo/scan-lite?url={url}`,
        async: false,
        idempotency: "none",
      },
      inspection: {
        response_schema: "{scan:'lite',price_usdc,signals:{...},upgrade:{full_scan,pricing}}",
        result_fields: ["scan", "price_usdc", "signals"],
      },
      verification: {
        method: "response_fields",
        success_conditions: ["status == 200", "scan == 'lite'", "price_usdc echoes charged amount"],
      },
      autonomy: "requires_human",
      approval: {
        required_for: "USDC spend — EIP-3009 signature authorizes a real transfer; a human (or a policy engine acting for one) must approve the amount in the decoded PAYMENT-REQUIRED body",
        resume_after_approval: "retry the identical request with `payment-signature: <payload>` — the server verifies and settles, then serves the resource",
      },
      next_actions: [
        `POST ${b}/api/total-scan {url} — full scan via the same payment flow`,
        `GET ${b}/pricing.json — machine-readable price list`,
      ],
      errors: [
        { code: "missing_url", http: 400, retryable: false },
        { code: "payment_required", http: 402, retryable: true },
        { code: "fetch_failed", http: 502, retryable: true },
      ],
    },
  ];
}
