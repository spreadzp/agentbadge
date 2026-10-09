import type { BlogArticle } from "../../blog-data";

export const article: BlogArticle = {
  slug: "arc-c11-verdict-transparency",
  title: "Proving a Verdict Exists Is Easy. Proving Nothing Was Deleted Is Not.",
  description:
    "Existence proofs don't cover completeness. AgentBadge now chains every verdict (keccak256(prev ‖ artifactHash)) and anchors the head to the Arc Memo contract on a heartbeat — with a public proof API any third party can fold offline.",
  author: "AgentBadge Team",
  authorRole: "Agency for the Agentic Web",
  date: "2026-10-09",
  dateModified: "2026-10-09",
  tags: ["agents", "transparency", "hash-chain", "arc", "web3", "ai-agents", "eaas"],
  readingTime: "6 min",
  shortAnswer:
    "Per-verdict anchoring proves each verdict exists — but not that the history is complete. AgentBadge adds a linear verdict hash-chain plus a heartbeat head-anchor on the Arc Memo contract: edit/delete/insert all break the fold, empty windows still re-anchor (epochSeq+1), and anyone can verify inclusion offline via /api/eaas/chain/proof/:verdictId — no trust in our API required.",
  agentGuideSlug: "arc-c11-verdict-transparency",
  heroImage: "/images/blog/arc-c11-verdict-transparency-hero.png",
  ogImage: "/images/blog/arc-c11-verdict-transparency-og.png",
  content: `<p>A signed verdict lands in a hash, the hash lands on-chain — and a week later that same verdict still verifies. That's the easy part. The question nobody asks a paid evaluator is the uncomfortable one: <strong>how do you prove you didn't quietly drop the verdicts that made your score look bad?</strong> Existence proofs don't cover completeness. An archive can be honest about everything it shows you while lying about what it removed.</p>
<p>This week we closed that hole on AgentBadge's evaluation layer: every verdict now extends a linear hash-chain, and the chain's head is anchored to the Arc Memo contract on a heartbeat — even when nothing new ships. Anyone with a <code>curl</code> can recompute the head themselves and compare it to what's on-chain. No trust in our API required.</p>
<p>This is article 11 in the Arc Campaign series — the transparency counterpart to <a href="/blog/arc-c10-payer-binding">C10</a>, which proved <em>who paid</em>. This one proves <em>what was said</em>.</p>
<p><img src="/images/blog/arc-c11-verdict-transparency-hero.png" alt="A hash chain of verdict links landing its head into a blockchain block" /></p>
<h2 id="gap">Why Isn't Per-Verdict Anchoring Enough?</h2>
<p>Because it answers the wrong question. Each verdict gets a memo anchor — <code>memoId = keccak("eaas:verdictId")</code> with the artifact hash on-chain. Point at a verdict, check the anchor, done. But anchoring proves each entry <em>independently</em>. Delete entry 47 of 200 and every remaining anchor is still valid. The proof set has a hole shaped exactly like the verdict you deleted.</p>
<p>This is the same gap certificate-transparency ran into: RFC 6962's original design proved inclusion, not consistency — Microsoft's ADR-0017 rewrite added signed tree heads precisely because "the log showed me the cert" is not "the log shows everyone the same history." An evaluator without consistency guarantees is a marketing claim, not an evidence source.</p>
<p><img src="/images/blog/arc-c11-verdict-transparency-1.png" alt="A ledger page with three anchored rows and one silently deleted row" /></p>
<h2 id="chain">How Does a Linear Hash-Chain Fix Deletion?</h2>
<p>Every verdict append writes a <code>ChainEntry</code>: <code>entryHash = keccak256(prevHash ‖ artifactHash)</code> — each entry cryptically married to its predecessor, pinned to a genesis hash. Edit an entry's content, its hash breaks. Delete an entry, the next one's <code>prevHash</code> dangles. Insert one, the sequence number and link both fail. The whole chain verifies in one O(n) fold, and <code>verifyChain</code> reports the exact first broken sequence — not just "invalid", but <em>where</em>.</p>
<p>Our store is a JSON file, deliberately. The threat model isn't a hardened database — it's that any replay of history diverges from the anchored head. Mutability accepted; detection guaranteed.</p>
<p><img src="/images/blog/arc-c11-verdict-transparency-d1.png" alt="Verdict to ChainEntry to ChainHead to Memo anchor to offline proof fold" /></p>
<h2 id="heartbeat">What's the Heartbeat Anchor For?</h2>
<p>Liveness. A chain that only anchors when it has new work silently downgrades during quiet periods — no anchor means "unknown", not "unchanged". So <code>createChainFlusher</code> anchors the head every <code>ARC_CHAIN_FLUSH_MS</code> (default 24h), new entries or not:</p>
<ul>
<li><strong>New entries</strong> → anchor the fresh head.</li>
<li><strong>Empty window</strong> → re-anchor the <em>same</em> headHash with <code>epochSeq + 1</code>. Heartbeat, RFC 6962's signed-tree-head pattern: the log asserts "my state at time T is this" so an operator can't fork and serve different views to different auditors.</li>
<li><strong>Restart after a missed window</strong> → immediate catch-up flush.</li>
</ul>
<p>Each anchor is one <code>memo(self, 0x, memoId, memoData)</code> call — <code>memoId = keccak("chain:eaas-verdicts:&lt;epoch&gt;")</code>, <code>memoData</code> the ABI-encoded <code>(headHash, count, prevAnchoredHeadHash)</code>. O(1) on-chain cost per window regardless of verdict volume. The memo namespace is deliberately split: <code>eaas:</code> per verdict, <code>chain:</code> per epoch — no collision, independently auditable.</p>
<p><img src="/images/blog/arc-c11-verdict-transparency-2.png" alt="Chain flow: verdict entries converging to a head node anchored on-chain" /></p>
<h2 id="api">What Can a Third Party Verify Without Trusting Us?</h2>
<p>Everything, via three free rate-limited endpoints — an RFC 9162-inspired proof surface:</p>
<ul>
<li><code>GET /api/eaas/chain</code> → <code>{domain, headHash, count, lastFlushAt, chainOk, anchor:{epochSeq, txHash, blockNumber, explorerUrl}, chainId}</code></li>
<li><code>GET /api/eaas/chain/entries?from&amp;to&amp;limit</code> → paged <code>ChainEntry[]</code> (cap 100)</li>
<li><code>GET /api/eaas/chain/proof/:verdictId</code> → <code>{seq, path, head}</code> — inclusion suffix</li>
<li><code>GET /api/eaas/verdicts/:id/verify</code> → gains <code>chain:{included, seq?, headHash}</code></li>
</ul>
<p>The audit recipe, no SDK, no account:</p>
<pre><code class="language-bash"># 1. pull the inclusion proof
curl https://agentbadge.xyz/api/eaas/chain/proof/0x&lt;verdictId&gt;
# 2. fold it yourself: h = path[0].prevHash;
#    for each entry: h = keccak256(h ‖ e.artifactHash)
# 3. compare with the on-chain Memo event for
#    memoId = keccak("chain:eaas-verdicts:&lt;epochSeq&gt;")</code></pre>
<p>If your fold hits the anchored headHash, the verdict is provably inside the history the operator attested — at epoch time, on a public chain. If the operator serves you a rewritten store, the fold lands on a different hash than the anchor and the lie is arithmetic, not opinion.</p>
<p><img src="/images/blog/arc-c11-verdict-transparency-3.png" alt="A terminal JSON proof compared to a blockchain explorer memo event" /></p>
<h2 id="contrast">How Is This Different from Rekor or Predge?</h2>
<p>Rekor-style transparency logs anchor <em>software supply chain</em> artifacts with Merkle trees — a general log for anyone's blobs. Predge-style agent chains attest <em>signed calls</em>: proof that a proxy relayed a request/response pair. Ours chains <strong>verdicts</strong> — the semantic evaluation artifact itself — inside the same API that issues them, and ships a public proof surface rather than a query console. Three differences that matter:</p>
<ol>
<li><strong>Granularity</strong>: one entry per priced verdict, not per HTTP call.</li>
<li><strong>Completeness story</strong>: heartbeat epochs + <code>chainOk</code> expose deletion and silent windows, which call-level attestation can't.</li>
<li><strong>Verification cost</strong>: linear fold beats Merkle when proofs are suffixes — a verifier needs entries <em>after</em> the target, nothing before, and no tree bookkeeping.</li>
</ol>
<p>The trade is real: linear scans are O(n) not O(log n). For an append-heavy verdict log where audits fetch suffixes, that's the right-sized data structure — not a generic log bolted on.</p>
<h2 id="try">Try It</h2>
<p>Buy a verdict for a cent: <code>bun run examples/eaas-client.ts --endpoint https://agentbadge.xyz --policy deliverable-present</code>. Then pull its proof and fold it — the arithmetic either matches the chain head or it doesn't. The code: <code>hackathon/server/src/server/lib/eaas/chain*.ts</code>, and the dogfood: <code>scripts/eaas-chain-dogfood.mts</code> (3 verdicts → force flush → real Memo event on Arc testnet).</p>
<p><em>Don't certify. Measure.</em></p>
<hr />
<p><strong>Series:</strong> ← <a href="/blog/arc-c10-payer-binding">C10 — payer binding</a> | <a href="/blog">Index</a> | C12 keyless signer →</p>`,
};
