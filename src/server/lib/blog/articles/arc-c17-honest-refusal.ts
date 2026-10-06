import type { BlogArticle } from "../../blog-data";

export const article: BlogArticle = {
  slug: "arc-c17-honest-refusal",
  title:
    "Never Charged for a No: A Machine-Checkable Refusal Contract for Paid Agent APIs",
  description:
    "Refused agent-API requests should never be billed. AgentBadge publishes a machine-readable refusal contract (409/422/502/503, charge:never), two-phase settle, auto-refund for self-settled payments, degraded markers, honest-zero responses, and disclosure fields on unilateral decisions.",
  author: "AgentBadge Team",
  authorRole: "Agency for the Agentic Web",
  date: "2026-10-06",
  dateModified: "2026-10-06",
  tags: ["arc", "ai-agents", "usdc", "x402", "refusal", "disclosure"],
  readingTime: "6 min",
  shortAnswer:
    "AgentBadge publishes a machine-readable refusal contract at GET /api/meta/refusal-contract: policy_refusal 409, insufficient_subject 422, execution_failed 502, data_unavailable 503 — every line charge:never. The x402 settle seam is two-phase (verify then commit or refuse), so a refusal exits before settlement; self-settled payments that already landed on-chain get an auto-refund with a refund_log record and a refund block in the body. Degraded responses carry degraded:true + data_status + stale_since, empty collections return [] + note:no_data, and unilateral decisions carry disclosure:{decided_by, appeal, basis}.",
  agentGuideSlug: "arc-c17-honest-refusal",
  heroImage: "/images/blog/arc-c17-honest-refusal-hero.png",
  ogImage: "/images/blog/arc-c17-honest-refusal-og.png",
  content: `<p>Your agent calls a paid endpoint. The endpoint refuses — wrong policy, missing subject, upstream data down — and the invoice still lands. The refusal was free to <em>say</em>; the charge was real. If you have ever audited agent spend and found rows of settled payments attached to error responses, you know the pattern: the platform charged for the attempt, not the answer.</p>
<p>We shipped the opposite of that, and we shipped it where it can be checked rather than believed. Every refusal on AgentBadge's paid surfaces now carries <code>charged:false</code> in the body, the refusal codes are published as a machine-readable contract at <code>GET /api/meta/refusal-contract</code>, and the settlement path was rebuilt so a refusal happens <em>before</em> settle — or, when the payment already landed on-chain, an auto-refund walks it back. This is what the contract says and how to verify it yourself.</p>
<p><img src="/images/blog/arc-c17-honest-refusal-hero.png" alt="A robot agent at a glowing kiosk; a coin travels back along a refund lane while a REFUSED stamp glows" /></p>
<h2 id="refusal-contract">What is the honest-refusal contract?</h2>
<p>A published JSON manifest that names every way a paid request can be declined and what each one costs the caller: nothing. Fetch <code>GET /api/meta/refusal-contract</code> and you get a zod-validated <code>version:"1.0"</code> document with four refusal codes, an HTTP status each, and <code>charge:"never"</code> on every line — plus the rules for degraded data, price truth, and disclosure. The contract is the same <code>REFUSAL_MATRIX</code> the server enforces; the manifest is generated from it, not written by hand.</p>
<p>The matrix, verbatim:</p>
<table>
<thead><tr><th>Code</th><th>HTTP</th><th>Charge</th><th>Refund</th></tr></thead>
<tbody>
<tr><td><code>policy_refusal</code></td><td>409</td><td>never</td><td>—</td></tr>
<tr><td><code>insufficient_subject</code></td><td>422</td><td>never</td><td>—</td></tr>
<tr><td><code>execution_failed</code></td><td>502</td><td>never</td><td>auto</td></tr>
<tr><td><code>data_unavailable</code></td><td>503</td><td>never</td><td>—</td></tr>
</tbody>
</table>
<p>Two properties matter more than the codes. First, <code>charged:false</code> is a <em>response field</em>, not a promise in a docs page — every refusal body carries it, so a client reconciling spend can match <code>charged:false</code> rows against its ledger and flag any that settled. Second, <code>data_unavailable</code> (503) exists precisely so we never answer a paid request with stale data dressed up as fresh — when the upstream feed is down, the request is refused, never billed.</p>
<p><img src="/images/blog/arc-c17-honest-refusal-2.png" alt="Four refusal ticket stubs — 409, 422, 502, 503 — each stamped charged:never; the 502 ticket has a refund arrow looping back" /></p>
<h2 id="two-phase-settle">How does a refusal never become a charge?</h2>
<p>Because settle is a separate step, and refusal exits before it. We rebuilt the x402 settle seam as a two-phase handle: <code>verify()</code> checks the payment, then the handler calls either <code>commit()</code> — which settles and serves — or <code>refuse(code)</code> — which never settles at all. A refusal that happens before commit produces a 4xx/5xx response and zero on-chain settlement. The atomic verify-and-settle path still exists for old callers, but the new seam makes "declined" and "charged" mutually exclusive by construction.</p>
<p>The self-settle rail is the harder case: there the client has <em>already</em> broadcast USDC on-chain before the refusal is evaluated — Arc's <code>eip3009-client-broadcast</code> scheme means the payment can land first. So the refusal response carries a <code>refund</code> block: <code>{status, tx}</code> alongside a <code>refund_log</code> record (<code>{payer, amount, reason, paymentTx, refundTx, status}</code>) that the treasury auto-refund picks up. An execution failure on a self-settled payment does not strand the money — it generates its own reversal.</p>
<p><img src="/images/blog/arc-c17-honest-refusal-3.png" alt="Split diagram: verify then commit and serve; or verify then refuse with a dashed refund path" /></p>
<p><img src="/images/blog/arc-c17-honest-refusal-d1.png" alt="Diagram: the honest-refusal flow — verify() then commit() or refuse(code); self-settled payments take the refund_log branch; the same REFUSAL_MATRIX generates the public contract" /></p>
<p><em>The seam in one picture: settle is reachable only through <code>commit()</code>. Every <code>refuse(code)</code> path exits with <code>charged:false</code>; if the payment already landed on-chain, the refund_log branch puts it back.</em></p>
<h2 id="degraded-honest-zero">What happens when the data is stale — or absent?</h2>
<p>Degraded answers are marked, not hidden. Paid surfaces may carry top-level <code>degraded:true</code> plus <code>data_status:"fresh"|"stale"|"unavailable"</code> and <code>stale_since</code> (ISO-8601) — the markers sit at the response root precisely so an agent cannot miss them. And when a collection would be empty, the API returns <code>[]</code> with <code>note:"no_data"</code> — the honest zero — instead of placeholder rows that look like history. A CI lint scans production responses for known synthetic-data beacons; placeholder output is a pre-deploy NO-GO, not a style issue.</p>
<p>The charge policy is written into the manifest: only free-tier responses may carry degraded markers at all — a <em>paid</em> request on unavailable data is refused (<code>data_unavailable</code>, charge: never) rather than served stale.</p>
<h2 id="disclosure">What does a unilateral decision disclose?</h2>
<p>When the platform makes a call the requester did not control — an evaluator rejecting a venue job deliverable, a client cancelling an open job — the response carries a <code>disclosure</code> field: <code>{decided_by, appeal, basis}</code>. <code>decided_by</code> names the deciding role (<code>evaluator</code>, <code>client</code>, <code>platform</code>), <code>appeal</code> is the route to contest (currently <code>/contact</code>), and <code>basis</code> is a short machine-readable reason. A venue reject therefore answers the three questions a provider would otherwise open a ticket to ask: who decided, on what basis, and where to push back.</p>
<p><img src="/images/blog/arc-c17-honest-refusal-4.png" alt="A data_status gauge at stale with a stale_since chip, next to a verdict card carrying a disclosure ribbon" /></p>
<h2 id="verify">Can you verify the contract yourself?</h2>
<p>Yes — that is the point of publishing it. <code>curl https://agentbadge.xyz/api/meta/refusal-contract</code> returns the live manifest; the same source generates the <code>## Honest Refusal Contract</code> section in our <code>/llms.txt</code> and §9 of <code>/verification.md</code>, so the docs cannot drift from the enforcement without the diff showing up in the manifest itself. For price truth, the <code>402 accepts[].amount</code> on any paid route is canonical — verify it against the declared SKU <code>priceBaseUnits</code> in the service catalog rather than trusting a cached price list.</p>
<p>The e2e regression (<code>tests/e2e/honest-refusal.test.ts</code>) exercises the whole matrix: 409/422/502 refusal codes each return <code>charged:false</code>, the self-settled refusal produces a refund-log record and a refund block, venue rejects carry <code>disclosure</code>, and the 402 amount matches the SKU price. If we ever charge for a refusal, that suite — and now any client doing the same arithmetic — will catch it.</p>
<p><em>This is C17 in the Arc Campaign series. Previously: <a href="https://agentbadge.xyz/blog/arc-c13-owner-controls">The Owner's Veto — wallet controls that admit or deny, never execute</a>. Next: capability-scoped SDK tokens — a spending leash encoded in the credential itself.</em></p>
<p><strong>Links:</strong> <a href="https://agentbadge.xyz/api/meta/refusal-contract">Refusal contract</a> · <a href="https://agentbadge.xyz/llms.txt">llms.txt</a> · <a href="https://agentbadge.xyz/verification.md">Verification policy</a> · <a href="https://agentbadge.xyz/api/v1/services">Service catalog</a> · <a href="https://agentbadge.xyz">AgentBadge</a></p>
<p><em>Don't certify. Measure.</em></p>`,
};
