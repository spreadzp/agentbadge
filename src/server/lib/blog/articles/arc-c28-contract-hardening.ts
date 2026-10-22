import type { BlogArticle } from "../../blog-data";

export const article: BlogArticle = {
  slug: "arc-c28-contract-hardening",
  title: "37 Ways to Break Our Contracts, and Why None of Them Work Anymore",
  description:
    "An adversarial AI audit via Circle's Arc Studio found 37 findings across the AgentBadge contract pack. A week later all eight contracts shipped to Arc mainnet as hardened UUPS proxies with zero open findings — the full audit → fix → re-audit → deploy story.",
  author: "AgentBadge Team",
  authorRole: "Agency for the Agentic Web",
  date: "2026-10-12",
  dateModified: "2026-10-12",
  tags: ["arc", "security", "smart-contracts", "uups", "audit", "arc-studio", "mainnet", "usdc"],
  readingTime: "7 min",
  shortAnswer:
    "AgentBadge ran an adversarial AI audit (Arc Studio, max preset, forge PoC per finding) over its identity and escrow contracts — 37 findings, all closed or disproved. The hardened pack redeployed to Arc mainnet on 2026-10-11 as eight UUPS proxies with role-based access, a platformBps timelock, and a documented EOA→multisig+timelock upgrade-governance path. Total gas: ~0.9 USDC across testnet and mainnet.",
  heroImage: "/images/blog/arc-c28-contract-hardening-hero.webp",
  ogImage: "/images/blog/arc-c28-contract-hardening-og.jpeg",
  content: `<p>On October 10, 2026 we pointed an AI auditor at the AgentBadge contract pack and told it to be mean. It found <strong>37 findings</strong> across identity and escrow — seven of them High, including a fully transferable "soulbound" passport and an escrow operator who could rotate themselves into the payout seat. On October 11, all eight contracts went live on Arc mainnet as hardened UUPS proxies with <strong>zero open findings</strong>.</p>
<p>This is C28 of the Arc Campaign series. <a href="https://agentbadge.xyz/blog/arc-c1-mainnet-deployment">C1</a> was the first deployment story; this one is about what happened when we stopped trusting it.</p>
<p><img src="/images/blog/arc-c28-contract-hardening-hero.webp" alt="Contract fleet behind a shield on an Arc mainnet network map" /></p>
<h2 id="audit-without-a-security-firm">How do you audit contracts without a security firm?</h2>
<p>We used <a href="https://studio.arc.io">Arc Studio</a> — Circle's server-side AI builder — as an adversarial auditor. Not a linter, not a checklist: a max-preset adversarial prompt that required <strong>a runnable forge PoC for every finding</strong> before it counted as a finding at all.</p>
<p>The prompt discipline mattered more than the model. Three rules did the heavy lifting: hunt specific bug classes (access-control bypasses, role confusion between cross-referencing contracts, upgrade/rotation gaps), produce an executable proof-of-concept test for each claim, and <em>don't touch the source</em> — audit only, recommended fixes as diff sketches. Two packs, two reports: identity/passport contracts (<code>VULN-01..21</code>) and escrow/marketplace (<code>VULN-1..16</code>).</p>
<p>The auditor-earned-its-fee numbers:</p>
<ul>
<li><strong>Identity pack</strong>: 21 findings — 7 High, 7 Medium, 6 Low, 1 informational</li>
<li><strong>Escrow pack</strong>: 16 findings — including 3 Critical-class (operator rotation, poster self-release, global platform fee)</li>
<li>Every finding shipped with a forge PoC that compiled and demonstrated the behavior — no "might be exploitable" hand-waving</li>
</ul>
<p><img src="/images/blog/arc-c28-contract-hardening-2.webp" alt="AI auditor red-teaming a contract, findings falling into a report" /></p>
<h2 id="worst-findings">What were the worst things it found?</h2>
<p>The kind of bugs that don't show up in unit tests because the tests were written by the same happy-path brain that wrote the code.</p>
<p>The top of the report, paraphrased:</p>
<ul>
<li><strong>Transferable identity (High)</strong> — <code>AgentPassportNFT</code> had no <code>_update</code> override, so passports — our ERC-8004 identity documents — were fully transferable. An issued identity could be sold or stolen; holder ≠ verified identity. Fixed with the soulbound <code>_update</code> guard.</li>
<li><strong>Operator rotation trap (Critical)</strong> — the escrow <code>operator</code> could be swapped in one call. Two-step <code>proposeOperator</code>/<code>acceptOperator</code> plus a zero-address revert closed it.</li>
<li><strong>Poster self-release (Critical)</strong> — the task poster could call <code>release</code> directly. Now release is 2-of-2: poster approves, operator executes.</li>
<li><strong>Zero-address log DoS (High)</strong> — constructing with <code>log_ == address(0)</code> silently bricked every mint, revoke and attest call forever. <code>initialize</code> now reverts on zero.</li>
<li><strong>Revoked-slot lockout (High)</strong> — revoking a pass poisoned its <code>passOf</code> slot; a subsequent mint took the renewal branch on a dead token. Irrecoverable — until we made the renewal branch check <code>!revoked[id]</code>.</li>
</ul>
<p><img src="/images/blog/arc-c28-contract-hardening-d1.webp" alt="Audit → fix → re-audit → deploy pipeline, bottom-up" /></p>
<p>Three findings were <em>rejected with disproof PoCs</em> — the auditor flagged "NFT owner race" and "pay() shrinks release window," and the same PoC discipline showed the invariants hold. A good audit closes bugs; a great one also kills false alarms.</p>
<h2 id="what-hardened-means">What does "hardened" actually mean on-chain?</h2>
<p>Same eight contracts, rewritten underneath. Every contract is now a UUPS upgradeable proxy (<code>ERC1967Proxy</code> subclass <code>AgentBadgeProxy</code>), with <code>_authorizeUpgrade</code> gated behind <code>UPGRADER_ROLE</code>, <code>_disableInitializers()</code> in every constructor, and 50-slot storage gaps for future layout.</p>
<p>The behavioral fixes on top:</p>
<ul>
<li><code>REVOKER_ROLE</code> — server operator can revoke a compromised pass without touching the admin key</li>
<li><code>redirectClaimer</code> — a claimer key rotates itself without an operator roundtrip</li>
<li><code>platformBps</code> timelock — fee changes are propose → 48h → commit; no instant fee rug</li>
<li><code>xHolds</code> — escrow holds keyed by a separate uint256 space; an NFT tokenId can never collide with a taskId</li>
<li><code>MIN_DEADLINE_OFFSET = 1h</code> — deposits must leave operators time to work</li>
<li><code>CLASS_FULL_COVERED</code> whitelist — a FULL pass covers MEDIUM+HEAVY, not "every future class bit" (the audit caught CLASS_EAAS leaking through)</li>
<li><code>_emitLog</code> in try/catch — a dead event log can't DoS escrow settlement</li>
</ul>
<p>The full list is 33 fixes across Critical/High/Medium/Low — every one with a regression test. Final suite: <strong>197 tests green</strong>.</p>
<p><img src="/images/blog/arc-c28-contract-hardening-d2.webp" alt="UUPS proxy stack: roles → storage → implementation → proxy → callers, bottom-up" /></p>
<h2 id="arc-studio-experience">What's it like auditing with Arc Studio?</h2>
<p>Practically useful, with sharp edges worth documenting.</p>
<p><strong>What worked.</strong> One well-specified prompt per run beat iterative chatting — the agent wrote PoCs, ran forge tests, and assembled the report itself inside the sandbox. The PoC requirement is the killer feature: it converts audit output from opinions into reproducible evidence. Cost was ~3% of the daily budget per pack audit; the whole engagement (two packs + re-audit) fit comfortably inside a week of quota.</p>
<p><strong>What to watch.</strong> Arc Studio is testnet-only — all mainnet deploys stayed on our hardhat/<code>chain-cli</code> path. Its outputs are agent-generated, not attested: we re-verified every finding locally before fixing, and three findings turned out to be false positives. And the audit prompts are worth keeping under version control — ours live in <code>scripts/arc-studio/prompts/</code> (<code>audit-identity.txt</code>, <code>audit-escrow.txt</code>), so the next run is reproducible.</p>
<p>Net: an AI auditor doesn't replace a security firm for mainnet money. But for "find the bugs your own tests were blind to," it earned its tokens.</p>
<h2 id="deployment">How did the deployment go?</h2>
<p>Two chains, one idempotent script, ~0.9 USDC total gas.</p>
<p><code>deploy-arc-v2.ts</code> deploys an implementation, wraps it in <code>AgentBadgeProxy</code>, calls <code>initialize</code> with the right params (USDC, treasury, operator, <code>platformBps</code>), and records every address in <code>deployments/{network}-v2.json</code>. Run it twice and it skips what exists — which we proved unintentionally when the first mainnet run was interrupted halfway: the resume deployed only the missing three.</p>
<ul>
<li><strong>Arc testnet (5042002)</strong>: 8/8 proxies, full write-path smoke PASS (registry → badge → passport → passes → escrow deposit/approve/release)</li>
<li><strong>Arc mainnet (5042)</strong>: 8/8 proxies, read-only sanity PASS — writer → passport, escrow usdc/operator/log, splitter bps=1000/treasury</li>
</ul>
<table>
<colgroup><col style="width: 34%" /><col style="width: 66%" /></colgroup>
<thead><tr><th>Contract</th><th>Mainnet v2 proxy</th></tr></thead>
<tbody>
<tr><td><strong>AgentEventLog</strong></td><td><a href="https://explorer.arc.io/address/0x20387070057178e9629dd6c9037c52487f090a90"><code>0x2038…0a90</code></a></td></tr>
<tr><td><strong>TrustRegistry</strong></td><td><a href="https://explorer.arc.io/address/0x0b56d876fa0b11742e8139b0291fa5080912a222"><code>0x0b56…a222</code></a></td></tr>
<tr><td><strong>TrustBadge</strong></td><td><a href="https://explorer.arc.io/address/0xebcb3adb5f7def429e9c3254bcbe6cd46aef2821"><code>0xebcb…2821</code></a></td></tr>
<tr><td><strong>AgentPassportNFT</strong></td><td><a href="https://explorer.arc.io/address/0x1f2426b102f57ecfeac2ab75c3fd853493f00a76"><code>0x1f24…0a76</code></a></td></tr>
<tr><td><strong>AccessPassNFT</strong></td><td><a href="https://explorer.arc.io/address/0x8e254abfd8e4691b11f8553fb9a9f180a248982f"><code>0x8e25…982f</code></a></td></tr>
<tr><td><strong>MarketplacePassNFT</strong></td><td><a href="https://explorer.arc.io/address/0x6e408672e56001dc24a5db68107f9abf900f87e5"><code>0x6e40…87e5</code></a></td></tr>
<tr><td><strong>TaskEscrow</strong></td><td><a href="https://explorer.arc.io/address/0xc58dd0890a8a186b651cd02f34af629c8cc91d53"><code>0xc58d…1d53</code></a></td></tr>
<tr><td><strong>MarketplaceSplitter</strong></td><td><a href="https://explorer.arc.io/address/0x69043c847e9ee79b7128ec6d280f5f25fc76aba9"><code>0x6904…aba9</code></a></td></tr>
</tbody>
</table>
<p>We checked the v1 contracts first (decision D-196-5): two marketplace passports and nothing else, all owned by our deployer — no external holders — so v2 is a clean restart, not a state migration. The v1 addresses stay frozen as read-only history.</p>
<p><img src="/images/blog/arc-c28-contract-hardening-3.webp" alt="Eight proxy contracts landing on an Arc mainnet map" /></p>
<h2 id="upgrade-governance">Who can upgrade these contracts?</h2>
<p>Today, the deployer EOA — with a documented exit. <code>UPGRADE-GOVERNANCE.md</code> lays out the migration: when the first real USDC lands in <code>TaskEscrow</code>, <code>UPGRADER_ROLE</code> moves to an OZ <code>TimelockController</code> (≥24h delay) whose proposer/executor is a multisig. A queued malicious upgrade becomes cancellable inside the timelock window.</p>
<p>The reasoning is simple: an upgrader key is god — one compromised key swaps in a hostile implementation and repoints every reference. Day-to-day roles (<code>MINTER</code>, <code>RECORDER</code>, <code>REVOKER</code>, <code>OPERATOR</code>) deliberately carry no upgrade power.</p>
<p><img src="/images/blog/arc-c28-contract-hardening-d3.webp" alt="EOA key → trigger → 24h timelock queue → execute → multisig upgrade path, bottom-up" /></p>
<p><img src="/images/blog/arc-c28-contract-hardening-4.webp" alt="Timelock hourglass between a deployer key and an upgrade call" /></p>
<h2 id="for-ai-agents">For AI Agents</h2>
<p>Programmatic endpoints for everything in this article:</p>
<ul>
<li><strong>Contracts</strong>: v2 proxies above, on Arc mainnet <code>eip155:5042</code> — ABIs in the <a href="https://github.com/spreadzp/agentbadge">agentbadge repo</a></li>
<li><strong>Audit artifacts</strong>: <code>VULN-REPORT.md</code> (identity, escrow) and <code>VULN-REPORT-v2.md</code> (re-audit) ship with the contracts package — findings, severities, PoC test names</li>
<li><strong>Verify a deployment</strong>: query <code>owner()</code>/<code>writer()</code>/<code>usdc()</code> on any proxy with <code>eth_call</code>; the event log's <code>writer()</code> is the passport proxy — that's the wiring check</li>
<li><strong>Machine-readable identity</strong>: <code>curl -s https://agentbadge.xyz/.well-known/agent-card.json</code> and <code>/did.json</code> for the platform's DID and ERC-8004 refs</li>
</ul>
<p><em>Don't certify. Measure.</em></p>
<h2 id="try-it">Try it yourself</h2>
<ul>
<li>Deploy ledger: <code>contracts/deployments/arc-mainnet-v2.json</code></li>
<li>Governance plan: <code>contracts/UPGRADE-GOVERNANCE.md</code></li>
<li>Audit prompts: <code>scripts/arc-studio/prompts/audit-{identity,escrow}.txt</code></li>
</ul>
<p><em>This is C28 in the Arc Campaign series. Earlier: C1 told the first deployment story; C11 covered verdict transparency on-chain. The series index lives at <a href="https://agentbadge.xyz/blog">agentbadge.xyz/blog</a>.</em></p>
<p><strong>Links:</strong> <a href="https://agentbadge.xyz">AgentBadge</a> · <a href="https://studio.arc.io">Arc Studio</a> · <a href="https://explorer.arc.io">Arc Explorer</a></p>
<p><em>Don't certify. Measure.</em></p>`,
};
