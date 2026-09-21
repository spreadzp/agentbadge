import type { BlogArticle } from "../../blog-data";

export const article: BlogArticle = 
  {
    slug: "how-do-you-measure-agent-readiness",
    title: "How Do You Measure Agent Readiness?",
    description:
      "Don't ask an LLM if your API is agent-ready. Measure specific properties with deterministic checks and show evidence for each result. A reproducible measurement framework for Agent Readiness.",
    author: "AgentBadge Team",
    authorRole: "Agency for the Agentic Web",
    date: "2026-08-26",
    dateModified: "2026-08-26",
    agentGuideSlug: "how-do-you-measure-agent-readiness",
    heroImage: "/images/blog/how-do-you-measure-agent-readiness/1s.webp",
    ogImage: "/images/blog/how-do-you-measure-agent-readiness/og.webp",
    shortAnswer:
      "Agent Readiness should be measured with deterministic checks and evidence, not LLM opinions. The framework uses four categories (Discovery, Documentation, Authentication, Machine Readability), four assertion statuses (VERIFIED, INFERRED, CONFLICT, MISSING), and a reproducibility formula: same URL + same ruleset + same time = same result.",
    tags: ["agent-readiness", "measurement", "evidence", "deterministic", "scoring"],
    readingTime: "10 min",
    content: `<blockquote><p>If Agent Readiness is real, it should be measurable. And the measurement should be reproducible.</p></blockquote>

<p>You've read about <a href="/blog/what-is-agent-readiness">what Agent Readiness is</a>. You've seen <a href="/blog/why-ai-agents-fail-to-use-apis">why AI agents fail to use APIs</a> and <a href="/blog/what-ai-agent-needs-to-understand-api">what an agent needs to understand</a>. You know <a href="/blog/why-openapi-isnt-enough">why OpenAPI alone isn't enough</a>.</p>

<p>Now the question shifts from "what" to "how":</p>

<blockquote><p><strong>How do you objectively determine whether an API is ready for AI agents?</strong></p></blockquote>

<p>This article introduces a measurement framework for Agent Readiness — one built on deterministic checks, evidence, and reproducibility. Not opinions. Not LLM scores. Measurable properties that any scanner can verify.</p>

<img src="/images/blog/how-do-you-measure-agent-readiness/1s.webp" alt="Hero — Subjective labels on the left (AI-friendly, Agent-ready, Optimized for AI) with question marks, deterministic formula on the right (same URL + same ruleset + same time = same result) with a green checkmark" />

<hr />

<h2>The Measurement Problem</h2>

<p>Labels like "AI-friendly API", "Agent-ready", and "Optimized for AI" are everywhere. They sound useful. They aren't.</p>

<p>Two auditors can look at the same API and disagree on whether it's "agent-friendly." An LLM can score the same API differently on different runs. A marketing page can claim "AI-optimized" without any way to verify what that means.</p>

<p>The problem isn't that these labels are wrong. The problem is that they're <strong>not reproducible</strong>. If two people can look at the same API and reach different conclusions, the measurement isn't real — it's an opinion.</p>

<p>If Agent Readiness is a real property of an API, it should be measurable. And the measurement should satisfy a simple requirement:</p>

<pre><code>same URL + same ruleset + same point in time = same result</code></pre>

<p>This is the reproducibility requirement. It's what separates measurement from opinion.</p>

<hr />

<h2>What Should We Measure?</h2>

<p>Agent Readiness isn't a single number. It's a set of properties across four categories:</p>

<ul>
  <li><strong>Discovery</strong> — Can an agent find the API?</li>
  <li><strong>Documentation</strong> — Can an agent understand the API?</li>
  <li><strong>Authentication</strong> — Can an agent authenticate autonomously?</li>
  <li><strong>Machine Readability</strong> — Can an agent interact machine-to-machine?</li>
</ul>

<p>But these aren't just checkboxes. Each category contains specific, testable assertions — properties that can be verified with HTTP requests:</p>

<pre><code>Discovery
  ✓ OpenAPI is discoverable
  ✓ llms.txt exists
  ✓ Documented API entry point exists

Authentication
  ✓ Authentication mechanism is declared
  ✓ Required credentials are documented
  ✓ Protected endpoint behavior is understandable</code></pre>

<p>The question isn't "does the API have OpenAPI?" The question is "can we verify that OpenAPI is discoverable?" — and that's a testable property.</p>

<img src="/images/blog/how-do-you-measure-agent-readiness/2s.webp" alt="Deterministic pipeline: URL → Scanner → Evidence → Rules → Score, with AI copilot as optional dashed step at the end" />

<hr />

<h2>Deterministic Before Intelligent</h2>

<p>This is the central principle of the measurement framework.</p>

<p>First:</p>

<pre><code>HTTP response → Rule → Evidence → Result</code></pre>

<p>Then, AI can help interpret complex cases. But the AI is a copilot, not the primary engine.</p>

<p>The wrong approach:</p>

<pre><code>URL → LLM → "Looks agent-ready: 76/100"</code></pre>

<p>The right approach:</p>

<pre><code>URL → Deterministic scanner → Evidence → Rules → Score → AI copilot (optional)</code></pre>

<p>This is what distinguishes AgentBadge from an AI auditor. Deterministic checks are reproducible — same input, same output, every time. LLM assessments are not. An LLM might score the same API as 76 today and 82 tomorrow. A deterministic scanner will give you the same result as long as the API hasn't changed.</p>

<p>This doesn't mean AI is useless. AI is excellent at interpreting ambiguous evidence, suggesting fixes, and explaining results. But the measurement itself — the check, the evidence, the score — should be deterministic.</p>

<hr />

<h2>Evidence, Not Opinions</h2>

<p>Every assertion in the measurement framework comes with evidence. Not "we think this is true" — but the actual HTTP response that proves it.</p>

<p>Here's what an evidence card looks like:</p>

<pre><code>OPENAPI_DISCOVERABLE
Status: VERIFIED

Evidence:
  GET /openapi.json
  HTTP 200
  Content-Type: application/json
  Valid OpenAPI document</code></pre>

<img src="/images/blog/how-do-you-measure-agent-readiness/3s.webp" alt="Evidence card: OPENAPI_DISCOVERABLE with Status: VERIFIED in green, evidence block showing GET /openapi.json, HTTP 200, Content-Type: application/json, Valid OpenAPI document" />

<p>This is the key difference between measuring and certifying. A certification says "this API is agent-ready." An evidence card says "here is the HTTP response that proves OpenAPI is discoverable."</p>

<blockquote><p><strong>Don't tell developers what to believe. Show them what we measured.</strong></p></blockquote>

<p>When every assertion includes evidence, the conversation changes. Instead of debating whether an API is "ready," you can point to specific findings: 72 checks run, 58 passed, 14 failed — here's the evidence for each.</p>

<hr />

<h2>Assertions</h2>

<p>A scan result is not a magic score. It's a set of assertions — each one testable, each one with a status and evidence:</p>

<table>
  <thead>
    <tr><th>Assertion</th><th>Status</th><th>Evidence</th></tr>
  </thead>
  <tbody>
    <tr><td>OpenAPI discoverable</td><td>VERIFIED</td><td><code>/openapi.json → 200</code></td></tr>
    <tr><td>Authentication documented</td><td>VERIFIED</td><td><code>securitySchemes</code> present in spec</td></tr>
    <tr><td>Machine-readable errors</td><td>MISSING</td><td>HTML error response, not structured</td></tr>
    <tr><td>Agent guide</td><td>MISSING</td><td><code>404 /agent-guide.json</code></td></tr>
  </tbody>
</table>

<img src="/images/blog/how-do-you-measure-agent-readiness/4s.webp" alt="Assertions table: four rows showing Assertion, Status, and Evidence columns — two VERIFIED in green, two MISSING in red" />

<p>This table is the heart of the measurement. Before you look at the score, you look at the assertions. Each assertion tells you something specific about the API — and each one is independently verifiable.</p>

<hr />

<h2>VERIFIED / INFERRED / CONFLICT / MISSING</h2>

<p>Every assertion has one of four statuses:</p>

<ul>
  <li><strong>VERIFIED</strong> — Direct proof exists. The scanner found the evidence.</li>
  <li><strong>MISSING</strong> — Not found. The scanner looked and didn't find it.</li>
  <li><strong>INFERRED</strong> — There are reasonable grounds to believe this is true, but the evidence is insufficient for verification.</li>
  <li><strong>CONFLICT</strong> — Two sources contradict each other.</li>
</ul>

<p>Here's a real example of CONFLICT:</p>

<pre><code>OpenAPI spec says:    POST /refund
Agent Guide says:     POST /refund-request</code></pre>

<p>Two sources, same API, different paths. The assertion status is CONFLICT — not VERIFIED, not MISSING. The scanner can't verify which is correct without making a live request, so it flags the contradiction.</p>

<img src="/images/blog/how-do-you-measure-agent-readiness/5s.webp" alt="Status model: four cards in a 2x2 grid — VERIFIED (green checkmark), MISSING (red x), INFERRED (yellow question mark), CONFLICT (orange warning) with one-line definitions" />

<p>The distinction between INFERRED and VERIFIED matters. INFERRED means "this looks right, but we can't prove it." VERIFIED means "here's the proof." An API that claims to have structured errors but returns <code>text/html</code> on error responses isn't VERIFIED — it might be INFERRED or MISSING depending on what the scanner found.</p>

<blockquote><p><strong>Confidence is not the same thing as verification.</strong></p></blockquote>

<hr />

<h2>Scoring</h2>

<p>Only after assertions are established do we compute a score. The score is derived from the assertions — not the other way around.</p>

<pre><code>Discovery           18/20
Documentation       19/25
Authentication      17/20
Machine Readability 15/20
Verification        10/15
─────────────────────────
Total               79/100</code></pre>

<img src="/images/blog/how-do-you-measure-agent-readiness/6s.webp" alt="Scoring breakdown: five category bars in cyan with scores, total 79/100 in green, and a category floor example showing Discovery = 0 blocking a 91/100 total" />

<p>There's a critical rule in the scoring model: <strong>category floor</strong>. A high total score should not hide a critical zero in a fundamental category.</p>

<p>If Discovery = 0, the API is effectively invisible to agents. No amount of excellent documentation or perfect authentication can compensate for the fact that agents can't find the API. A score of 91/100 with Discovery = 0 is misleading — it suggests the API is nearly ready when it's actually missing the most fundamental layer.</p>

<p>The category floor prevents this. If any critical category is zero, the total score is capped. A high score should reflect actual readiness, not average out a fatal gap.</p>

<blockquote><p><strong>A high score should not hide a critical zero.</strong></p></blockquote>

<hr />

<h2>Score ≠ Certification</h2>

<p>AgentBadge doesn't say "this API is safe" or "this API is approved for agents."</p>

<p>It says: <strong>"Here is what we measured, under this ruleset, at this point in time."</strong></p>

<p>This distinction matters for three reasons:</p>

<ol>
  <li><strong>Trust</strong> — Developers can verify the evidence themselves. They don't need to trust a badge; they can check the proof.</li>
  <li><strong>Legal risk</strong> — Certification implies endorsement. Measurement implies observation. AgentBadge observes and reports; it doesn't endorse.</li>
  <li><strong>Reproducibility</strong> — Anyone can run the same checks and get the same results. The measurement is transparent, not opaque.</li>
</ol>

<blockquote><p><strong>Don't certify. Measure.</strong></p></blockquote>

<hr />

<h2>Reproducibility</h2>

<p>A measurement is only useful if it can be independently verified. The reproducibility formula is:</p>

<pre><code>URL + timestamp + ruleset version + scan artifact + report hash</code></pre>

<p>Example:</p>

<pre><code>Agent Readiness v1.0
Scan: 2026-08-26T14:03:22Z
Ruleset: agentbadge-ruleset@1.0.0
Report hash: a3f7b2c1...
Score: 79/100</code></pre>

<p>Every scan records the URL, the timestamp, the ruleset version, and produces a report hash. The scan artifact is preserved. Another scanner — or another developer — can run the same checks against the same URL with the same ruleset and verify the results.</p>

<p>This is what makes the measurement real. It's not a subjective assessment that changes with the auditor. It's a deterministic process that produces the same output for the same input.</p>

<hr />

<h2>Static Measurement vs Real Agent Behavior</h2>

<p>An honest caveat: <strong>static readiness does not prove that every AI agent will successfully use an API.</strong></p>

<p>AgentBadge measures whether an API <em>can be</em> discovered, understood, and potentially used by an agent — based on observable evidence. It doesn't measure whether every agent <em>will</em> successfully complete every task.</p>

<p>These are different questions:</p>

<ul>
  <li><strong>Static measurement</strong>: "Does the API expose the properties that an agent needs?" (Phase 1)</li>
  <li><strong>Active verification</strong>: "Can an agent actually perform specific operations?" (Phase 2)</li>
  <li><strong>Behavioral verification</strong>: "What does the agent do when it encounters this API in production?" (Future)</li>
</ul>

<p>The measurement framework starts with Phase 1 — static measurement. It's the foundation. But it's not the end of the road.</p>

<pre><code>Phase 1: Static measurement (current)
    ↓
Phase 2: Active verification (next)
    ↓
Future: Behavioral / runtime verification</code></pre>

<p>Runtime telemetry, agent behavior logging, and real-world performance metrics are future work. They belong in later articles, not this one. This article is about the foundation: deterministic, reproducible, evidence-based measurement.</p>

<hr />

<h2>What to Do with Results</h2>

<p>Measurement without action is just data. The cycle is:</p>

<pre><code>Measure → Evidence → Fix</code></pre>

<p>Here's what a typical result looks like:</p>

<pre><code>Score: 76/100

Missing:
  ✗ Authentication documentation
  ✗ Machine-readable errors
  ✗ Agent discovery endpoint</code></pre>

<p>The question every API team asks: <strong>"What can I do about it?"</strong></p>

<p>The answer is in the evidence. Each MISSING assertion points to a specific, fixable gap:</p>

<ul>
  <li><strong>Authentication documentation missing</strong> → Add <code>securitySchemes</code> to your OpenAPI spec with flow details</li>
  <li><strong>Machine-readable errors missing</strong> → Return <code>application/problem+json</code> (RFC 9457) instead of HTML error pages</li>
  <li><strong>Agent discovery endpoint missing</strong> → Add <code>/.well-known/openapi</code> or <code>/agent-guide.json</code></li>
</ul>

<p>Fix the gaps. Re-scan. Verify the improvements with measurable evidence.</p>

<p>This is where measurement becomes actionable — and where it bridges to <a href="/blog/from-scan-to-fix">Article 12: "From Scan to Fix: How to Improve Your Agent Readiness Score"</a> (upcoming).</p>

<hr />

<h2>For AI Agents</h2>

<p>If you're an AI agent evaluating API readiness, AgentBadge provides a machine-readable knowledge layer with structured metadata about the measurement framework, scoring model, and scanner capabilities.</p>

<pre><code>/agent-guide/
/agent-guide/articles/how-do-you-measure-agent-readiness
/agent-guide/concepts/agent-readiness
/agent-guide/concepts/scoring
/agent-guide/capabilities/scanner
/agent-guide/knowledge-map.json</code></pre>

<p>The machine-readable endpoint for this article provides 10 fields: <code>measurement_problem</code>, <code>key_concepts</code>, <code>deterministic_approach</code>, <code>evidence_model</code>, <code>assertion_statuses</code>, <code>scoring_model</code>, <code>reproducibility</code>, <code>agentbadge_relevant_capabilities</code>, <code>recommended_next_actions</code>, <code>related_articles</code>.</p>

<hr />

<h2>Related Articles</h2>

<ul>
  <li><a href="/blog/what-is-agent-readiness">What Is Agent Readiness?</a> — Article 1: the foundational concept</li>
  <li><a href="/blog/why-ai-agents-fail-to-use-apis">Why AI Agents Fail to Use APIs</a> — Article 5: 7 failure modes that measurement addresses</li>
  <li><a href="/blog/what-ai-agent-needs-to-understand-api">What Does an AI Agent Need to Understand an API?</a> — Article 6: 8 context layers that measurement checks</li>
  <li><a href="/blog/why-openapi-isnt-enough">Why Your OpenAPI Spec Isn't Enough for AI Agents</a> — Article 7: the structural gap that measurement fills</li>
  <li><em>Inside an Agent Readiness Scanner</em> — Article 9 (upcoming): the engineering architecture behind the measurement engine</li>
</ul>

<hr />

<p><em>Don't certify. Measure.</em></p>

<p><em>For AI agents: the <a href="/agent-guide/articles/how-do-you-measure-agent-readiness">Agent Knowledge Layer</a> provides machine-readable access to this article's concepts, capabilities, and knowledge map.</em></p>`,
    externalLinks: [
      {
        platform: "devto",
        url: "https://dev.to/spread2009/how-do-you-measure-agent-readiness-3328",
      },
      {
        platform: "medium",
        url: "https://paulspread-99907.medium.com/how-do-you-measure-agent-readiness-7cb901d373ea",
      },
      {
        platform: "linkedin",
        url: "https://www.linkedin.com/feed/update/urn:li:activity:7498387449077989376/",
      },
      {
        platform: "hackernoon",
        url: "https://app.hackernoon.com/articles/6a8f0df5807c8a77117228a5",
      },
      {
        platform: "reddit",
        url: "https://www.reddit.com/r/AIDiscussion/comments/1vz30hb/how_do_you_measure_if_an_api_is_ready_for_ai/",
      },
      {
        platform: "hashnode",
        url: "https://agentbadge.hashnode.dev/how-do-you-measure-agent-readiness",
      },
      {
        platform: "twitter",
        url: "https://x.com/paul_spread/status/2092620769977082069",
      },
      {
        platform: "zenn",
        url: "https://zenn.dev/buidl25/articles/how-do-you-measure-agent-readiness",
      },
      {
        platform: "velog",
        url: "https://velog.io/@buidl_25/How-Do-You-Measure-Agent-Readiness",
      },
      {
        platform: "hsoub",
        url: "https://io.hsoub.com/artificial_intelligence/185233-كيف-تقيس-جاهزية-الوكلاء",
      },
    ],
  };
