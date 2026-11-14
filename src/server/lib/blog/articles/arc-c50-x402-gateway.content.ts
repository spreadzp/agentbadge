/**
 * EPIC-223 · EPIC-162 C50 — x402 machine payment gateway (EN).
 * Canonical markdown: docs/ARTICLES/content-plan/round-2/articles/arc-c50-x402-gateway/AgentBadge-Blog.md
 */
export const arcC50X402GatewayContent = `
<h2>Why would a machine need a cash register?</h2>

<p> Because every other way of charging for an API assumes a human. Stripe checkout assumes a person with a card and a browser. API keys assume someone who registered an account first. An autonomous agent has none of that — it has a wallet. x402 is the pattern where HTTP status <code>402 Payment Required</code> becomes real: the server answers a request not with a login page but with a price tag, and the client retries the same request carrying a cryptographic payment proof. </p>

<p> For a junior: think of a vending machine instead of a supermarket. No account, no cart, no checkout wizard. You walk up with exact change, the machine prices the item, takes the coin, and gives you the thing plus a receipt — all in one interaction. Our gateway is that vending machine for HTTP resources, built on the payment rails from the previous episodes. </p>

<h2>How does the 402 loop work?</h2>

<p> In four layers, bottom to top. Everything the client sees is derived server-side — the price, the network, the recipient — so a client can never say "I paid" for a resource that wasn't charged. </p>

<p><img src="/images/blog/arc-c50-x402-gateway-d2.webp" alt="Flowchart of the gateway's four layers: a PaidResource registry resolves a route into a resource and price; a PriceResolver can override the catalog price; the X402PaymentService builds requirements and delegates verification and settlement to the existing seam; the Hono middleware either answers a 402 challenge or lets a settled request through and records a UsageRecord" /></p>
<p><em> Domain types live in the payments package; transport lives in the server; settlement stays in the existing seam. </em></p>

<ol>
<li> <strong>Registry</strong> — a <code>PaidResource</code> declares <code>id, method, path, priceUsd, network</code>. Unregistered routes pass the gate untouched, so the gateway is strictly opt-in per route. </li>
<li> <strong>Price resolution</strong> — a catalog-first <code>PriceResolver</code>, falling back to the registry's declared price. Resolved USD is converted to USDC atomic units at the boundary. </li>
<li> <strong>Service facade</strong> — builds the payment requirements, delegates verify+settle to the existing x402 seam (the same one the legacy routes use — we didn't reimplement settlement), appends a <code>UsageRecord</code>, and resolves <code>agentId</code> from the payer's wallet binding — or <code>null</code> when unbound. </li>
<li> <strong>Middleware</strong> — the Hono gate. No <code>PAYMENT-SIGNATURE</code> header → spec-compliant <code>402 + PAYMENT-REQUIRED</code>. Signature present → settle → record usage → <code>PAYMENT-RESPONSE</code> receipt header → serve the resource. </li>
</ol>

<p><img src="/images/blog/arc-c50-x402-gateway-d1.webp" alt="Sequence diagram of one paid request: agent GETs /api/v1/fx/delta/premium without a signature and gets 402 + PAYMENT-REQUIRED with server-derived accepts; the agent signs an EIP-3009 authorization and retries with PAYMENT-SIGNATURE; the seam verifies and settles on Arc; usage and payer binding are recorded; the handler returns 200 + PAYMENT-RESPONSE + payment{} in the body" /></p>
<p><em> One round trip for the price tag, one for the goods. The receipt travels in the response header. </em></p>

<h2>What did the adversarial audit break?</h2>

<p> After the pilots shipped — 30 unit tests + 8 end-to-end tests, all green — we ran an Arc Studio adversarial review. Verdict: <strong>REQUEST CHANGES</strong> — 1 Critical, 6 High, 9 Medium. The green tests had covered the happy path and the "payment rejected" path. The audit covered the third path: <em>payment accepted, then something else breaks</em>. </p>

<ul>
<li> <strong>C-1 — paid but nothing received.</strong> Settlement succeeded on-chain, then a database hiccup in the usage-record write threw a bare 500. The payer's nonce was already spent, so a retry could never recover — no resource, no record, no receipt. Now: post-settle accounting is wrapped so a paid request <em>always</em> serves the resource and emits <code>PAYMENT-RESPONSE</code>; failures are logged as reconciliation records instead. </li>
<li> <strong>H-1 — the free HEAD request.</strong> Hono answers <code>HEAD</code> through the <code>GET</code> handler, but our route lookup matched methods exactly — <code>HEAD /api/v1/fx/delta/premium</code> skipped the gate entirely. Now HEAD is normalized to GET before lookup. </li>
<li> <strong>H-2 — client-controlled dedupe key.</strong> <code>x-request-id</code> anchored usage dedupe; a client could reuse it across different payments and silently suppress records. The anchor is now the settlement tx — cryptographically unique per payment. </li>
<li> <strong>H-3 — charge first, fail later.</strong> Settlement ran before the handler even existed in memory; a dead downstream engine meant a paid 503. A <code>preCheck</code> now refuses unbootable requests <em>before</em> the 402 challenge — you can't be charged for what can't be served. </li>
<li> <strong>H-5 — wrong attribution.</strong> The usage record wrote the registry's declared network instead of what actually settled. Now it records <code>settle.sourceChain</code>, and the advertised accepts are filtered to the resource's own network. </li>
<li> <strong>H-6 — a mount that leaked.</strong> <code>app.route("/api/v1", passportRoutes)</code> exposed every future passport route under the paid prefix. The pilot now mounts the single handler explicitly. </li>
</ul>

<p><img src="/images/blog/arc-c50-x402-gateway-audit.webp" alt="A magnifying glass hovering over a glowing pipeline joint between a settled block and a usage record block, the joint burning red where the audit found the unguarded post-settle code path" /></p>
<p><em> The audit found the gap between "payment succeeded" and "resource served" — the seam every money path is made of. </em></p>

<h2>What's live and how do I try it?</h2>

<p> Behind <code>X402_GATEWAY_ENABLED</code> on Arc testnet — Arc USDC only in v1: </p>

<ul>
<li> <code>POST https://agentbadge.xyz/api/v1/passport/request</code> — <code>$0.10</code>, issues an agent passport (same handler as the legacy route) </li>
<li> <code>GET https://agentbadge.xyz/api/v1/fx/delta/premium</code> — <code>$0.02</code>, premium FX-delta snapshot + <code>payment: {txHash, network, amount, receiptId}</code> in the body </li>
</ul>

<p><img src="/images/blog/arc-c50-x402-gateway-pilots.webp" alt="Two vending-machine slots on a dark panel — $0.10 dispensing a passport card, $0.02 dispensing an FX chart card, with a TESTNET ribbon in the corner" /></p>
<p><em> The two pilot slots: same handlers as the legacy rails, now reachable by a machine carrying coins. </em></p>

<p> Registering a new paid resource is a registry entry, not a new code path: <code>{ id, method, path, priceUsd, network }</code>. The middleware, challenge, settlement, usage record and receipt come free. </p>

<h2>What are the honest limits?</h2>

<ul>
<li> <strong>Pilots, not production.</strong> Two routes, flag-gated, Arc testnet. The legacy passport rail and the Celo FX gate are untouched on purpose — migration is additive, never a silent swap. </li>
<li> <strong>No live numbers yet.</strong> End-to-end is proven with the seam stubbed at the boundary (8 e2e tests). Real testnet txs through the gateway haven't run at press time — we say so rather than quote a receipt count we don't have. </li>
<li> <strong>Bearer payments.</strong> A valid signature pays; it isn't bound to a specific resource by the wire protocol. That's x402's design, and the mitigation lives in the requirements the server derives, not in the client's wallet. </li>
<li> <strong>One audit.</strong> Adversarial review we fixed and re-verified, not a formal verification. The regression tests — HEAD gating, zero-price, post-settle crash, engine-off refusal — are the artifact that outlives this article. </li>
</ul>

<p> The deeper principle is the same one the reconciliation episode ended on: <strong>a chain payment isn't an event you receive, it's a claim you verify</strong> — and this episode adds the other half: <em>once verified, everything after the money moves is customer service, and it must never cancel the sale.</em> </p>

<hr />

<h2>For AI Agents</h2>

<p> Machine-readable summary: this gateway gates <code>/{method,path}</code> pairs by a <code>PaidResource</code> registry, issues HTTP 402 + <code>PAYMENT-REQUIRED</code> (official <code>@x402/core/http</code> helpers) with server-derived <code>accepts[]</code>, verifies+settles via the shared x402 seam, and returns <code>PAYMENT-RESPONSE</code> + a JSON <code>payment{}</code> receipt field. Priced pilots on Arc testnet: <code>POST /api/v1/passport/request</code> ($0.10 USDC), <code>GET /api/v1/fx/delta/premium</code> ($0.02 USDC). Dedupe anchor = settlement tx; <code>agentId</code> resolves from payer wallet binding (null when unbound). </p>

<p> If you're human and still here: the registry file is 40 lines, the middleware is 120, and the audit report is public in the repo docs. Steal the pattern — the C-1 fix alone is worth the read. </p>

<p><em> Stack: <code>@agentbadge/payments</code> (pure TS domain) + <code>@x402/core</code> official header helpers, Bun + Hono, existing <code>x402-settle-seam</code> for verify/settle, Arc testnet USDC (<code>eip155:5042002</code>). 30 unit + 8 e2e tests green; audit findings + triage table in <code>docs/EPICS/223-x402-payment-gateway/reviews/x402-gateway-REVIEW.md</code>. </em></p>
`;
