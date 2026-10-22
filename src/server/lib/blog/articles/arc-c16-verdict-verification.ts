import type { BlogArticle } from "../../blog-data";

export const article: BlogArticle = {
  slug: "arc-c16-verdict-verification",
  title:
    "Don't Trust Us — Check the Chain: Public Verification for AI Agent Verdicts",
  description:
    "Every verdict ships with an on-chain receipt: GET /api/verify/:verdictId (public facade), the /verify SSR page accepting verdict id | tx hash | memo id, and @agentbadge/verify-verdict — a standalone package that re-checks the memo anchor, epoch head anchor, and full chain recompute with zero calls to our server.",
  author: "AgentBadge Team",
  authorRole: "Agency for the Agentic Web",
  date: "2026-10-14",
  dateModified: "2026-10-14",
  tags: ["arc", "ai-agents", "verification", "hash-chain", "verdict", "x402"],
  readingTime: "6 min",
  shortAnswer:
    "Every AgentBadge verdict can be verified independently of our server. GET /api/verify/:verdictId returns the artifact, reason codes, memo anchor, hash-chain status, and the PROOF_KINDS_V1 registry (verdict | witness | anchor-head; ?kind= narrows per layer, unknown → 400 unknown_proof_kind). The paid response itself carries an inline receipt — verify:{api,page,memoId} — with the deterministic memo id. Level-2 is npx @agentbadge/verify-verdict: proofs[] across verdict anchor, anchor-tx, anchor-head, and chain-recompute (firstBrokenSeq on tamper), exit 0/1, memo contract 0x5294E9927c3306DcBaDb03fe70b92e01cCede505. Unanchored renders pending, never valid; RPC failure is an honest rpc_unavailable error.",
  agentGuideSlug: "arc-c16-verdict-verification",
  heroImage: "/images/blog/arc-c16-verdict-verification-hero.webp",
  ogImage: "/images/blog/arc-c16-verdict-verification-og.jpeg",
  content: `<p>What happens if we lie to you? Not a bug — a lie. The verdict endpoint says "approved," the signature is ours, the JSON looks right. If verification means "ask the issuer whether the issuer is honest," the answer is worthless by construction. The only honest design is one where the issuer's own claims are checkable by a stranger with an RPC endpoint and no faith in the issuer at all.</p>
<p>That is what we shipped for every verdict our evaluator signs. Each paid response now carries its own <strong>verification receipt</strong> — links and a deterministic memo id — and every claim in that receipt re-verifies on-chain through a standalone package that never calls our API. If our server disappears tomorrow, the proofs still check.</p>
<p><img src="/images/blog/arc-c16-verdict-verification-hero.webp" alt="A magnifying glass held over a sealed verdict document on a chain; the document's hash glows where it matches the on-chain record" /></p>
<h2 id="verify-api">How do you verify a verdict through the public API?</h2>
<p>One GET, no auth: <code>GET /api/verify/:verdictId</code> returns the stored verdict artifact, machine <code>reason_codes</code>, the per-verdict <strong>memo anchor</strong> state (<code>status</code>, <code>memoId</code>, <code>txHash</code>, <code>blockNumber</code>), the <strong>hash-chain</strong> status (<code>anchored</code>/<code>pending</code>/<code>disabled</code> with a <code>head_ref</code> pointer for offline recomputation), and a <code>proof_kinds</code> registry summary. Unknown id → <code>404 verdict_not_found</code>; it never answers a fake-valid.</p>
<p>The response is layered by design. <code>?kind=verdict</code> returns only the verdict layer (artifact + memo anchor); <code>?kind=anchor-head</code> returns only the chain layer; <code>?kind=witness</code> answers <code>implemented:false</code> — the kind is declared in the registry so verifiers can feature-detect it before it ships. Ask for an unregistered kind and you get <code>400 unknown_proof_kind</code> with the full <code>known</code> list, not a silent fallback.</p>
<p><img src="/images/blog/arc-c16-verdict-verification-2.webp" alt="Two-level verification: the public API facade vs a standalone verifier reading the chain directly — both check the same memo anchor" /></p>
<h2 id="verify-page">What does the /verify page do?</h2>
<p>It is the same check for humans: a server-rendered page at <code>/verify</code> that accepts a <strong>verdict id, an anchor transaction hash, or a memo id</strong> — all <code>0x</code>-prefixed 64-hex strings — and resolves which one you pasted via the anchor reverse-lookup. It renders the verdict, the reason codes, the anchor status with an explicit <em>pending</em> banner when the on-chain write has not landed, explorer links, and JSON-LD metadata — all without JavaScript, so it works in <code>curl</code> and in an agent's text browser.</p>
<p>Honest statuses are the point. An unanchored verdict renders "pending," never "valid." A malformed id is a <code>400</code>, a well-formed unknown id is a <code>404</code>, and the page tells you which of the two happened.</p>
<h2 id="level-2">How do you verify without trusting AgentBadge at all?</h2>
<p>Run the standalone package. <code>@agentbadge/verify-verdict</code> re-checks everything against the chain itself — the memo contract at <code>0x5294E9927c3306DcBaDb03fe70b92e01cCede505</code> on Arc, no call to our API, no account, no key:</p>
<pre><code>npx @agentbadge/verify-verdict 0x&lt;verdictId-or-txHash&gt;
# exit 0 — every executed proof passed
# exit 1 — invalid, unanchored, or a typed error (rpc_unavailable)</code></pre><p>Exit 0 is not the same as full coverage. If a check ran in a weaker mode — for example <code>verdict</code> without <code>--artifact</code>, which proves only that a memo exists, not what it says — the run still exits 0 but prints <code>VALID (partial)</code> and sets <code>partial: true</code> in the JSON. Treat <code>partial</code> as "not tamper-proven" and pass <code>--artifact</code> to close the gap.</p>
<p>Each run produces a <code>proofs[]</code> report — one entry per layer, each <code>ok:true/false</code> plus detail:</p>
<ul>
<li><strong>verdict</strong> — the per-verdict memo anchor exists at <code>memoIdFor("eaas", verdictId)</code> and its memo data equals <code>keccak256</code> of the canonical artifact JSON (pass the artifact via <code>--artifact</code> for the tamper check).</li>
<li><strong>anchor-tx</strong> — a memo event for <em>this</em> verdict lives inside the transaction you supplied. A bare txHash without a verdictId cannot bind anything, so the proof is <code>ok:false</code> with reason <code>no verdictId supplied</code>. A transaction that carries other memos does not prove this verdict; the bound event's memo is reported as <code>artifactHash</code>.</li>
<li><strong>anchor-head</strong> — the periodic epoch anchor at <code>memoIdFor("chain", "eaas-verdicts", epochSeq)</code> binds <code>(headHash, count, prevAnchoredHeadHash)</code>, chaining epochs.</li>
<li><strong>chain-recompute</strong> — feed it the chain entries (<code>--entries</code>) and it folds them locally: a broken entry fails with <code>firstBrokenSeq</code>, a verdict absent from the entries fails honest-invalid.</li>
</ul>
<p>Every verdict we sign lands in that hash chain at issue time, and the head flushes on-chain per epoch — so the Level-2 verifier answers the only question that matters: <em>is the thing the server showed me the thing the chain holds?</em></p>
<pre><code>verify-verdict 0x4af3… --artifact verdict.json --entries chain.json
# proofs: verdict ok | anchor-head ok | chain-recompute ok
# valid: true — exit 0
# without --artifact the same run prints:
# VALID (partial)
#   coverage: partial — see proof warnings above
#   ✓ verdict  … warning: artifact not supplied — only memo existence checked
# exit 0</code></pre>
<p><img src="/images/blog/arc-c16-verdict-verification-3.webp" alt="Terminal output: three proofs ok with a VALID badge; a second frame shows firstBrokenSeq under an INVALID badge" /></p>
<h2 id="proof-kinds">What is the proof-kind registry?</h2>
<p>A versioned enum of every on-chain proof the verification surface understands. <code>PROOF_KINDS_V1</code> declares three kinds — <code>verdict</code>, <code>witness</code>, <code>anchor-head</code> — each with its memo format, the verifier rule for <code>ok:true</code>, and a <code>specVersion</code> for negotiation. The registry is itself the contract: a verifier can enumerate what exists, check which kinds a deployment supports, and fail loudly on an unknown kind rather than skipping a layer it was asked to verify.</p>
<p>The <code>witness</code> kind is the telling entry. It is declared — with memo format and rule stub — but returns <code>implemented:false</code>, because the witness layer (independent attestations per job) is still shipping. A registry that lists unimplemented kinds lets third parties build against the future surface today, and lets anyone see the full honesty map: what is checkable now, what is declared, and what would be a lie if we claimed it early.</p>
<p><img src="/images/blog/arc-c16-verdict-verification-d1.webp" alt="Flow diagram: verdict artifact → memo anchor and hash-chain entry → epoch head anchor; Level-1 API and Level-2 package both re-check the anchors; chain recompute catches tampering at firstBrokenSeq" /></p>
<p><em>The seam in one picture: a verdict writes two proofs — its own memo anchor and a chain entry — and the chain's head anchors each epoch. Level-1 is our facade over the same data; Level-2 checks both layers from the RPC directly, and the recompute fold fails at the first tampered entry.</em></p>
<h2 id="pending">What does "pending" mean — and why is there no fake-valid?</h2>
<p>Because a verification surface that lies is worse than none. Anchor writes are fire-and-forget after the verdict issues — the paid response returns instantly, and the memo lands on-chain asynchronously. Until it lands, every surface says <code>pending</code>: the API's <code>anchor.status</code>, the page's banner, and the package's <code>verdict</code> proof (<code>ok:false</code>, detail says no memo events found). When our RPC dies, the package throws <code>VerifyError("rpc_unavailable")</code> and exits 1 — an honest "cannot determine," never a shrug stamped VALID.</p>
<p>The inline receipt makes the pending state useful rather than invisible. The paid response's <code>verify:{api, page, memoId}</code> block carries the deterministic memo id computed from the verdict id — a client can start polling the chain for its own anchor the moment the response arrives, without waiting for a second API round-trip.</p>
<p><em>This is C16 in the Arc Campaign series. Previously: <a href="https://agentbadge.xyz/blog/arc-c15-x402-bazaar">The x402 Bazaar — a service catalog machines can shop</a>. Next: <a href="https://agentbadge.xyz/blog/arc-c17-honest-refusal">Never Charged for a No — the machine-checkable refusal contract</a>.</em></p>
<p><strong>Links:</strong> <a href="https://agentbadge.xyz/verify">Verify page</a> · <a href="https://agentbadge.xyz/openapi.yaml">openapi.yaml</a> · <a href="https://agentbadge.xyz/llms.txt">llms.txt</a> · <a href="https://www.npmjs.com/package/@agentbadge/verify-verdict">@agentbadge/verify-verdict</a> · <a href="https://agentbadge.xyz">AgentBadge</a></p>
<p><em>Don't certify. Measure.</em></p>`,
};
