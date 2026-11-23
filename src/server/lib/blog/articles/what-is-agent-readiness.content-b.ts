/* eslint-disable max-lines -- article HTML content (prose data, not code) */
// EPIC-259 (SLICE-259-30): article content split under the 20KB staged-file cap.
export const whatIsAgentReadinessContentB = `
<h2>One score — but with a transparent structure</h2>

<p>AgentBadge uses a single score, because humans need a simple answer:</p>

<blockquote>"How ready is my API?"</blockquote>

<p>But one score must never hide the details.</p>

<p>Categories and evidence sit right next to it:</p>

<pre><code>Agent Readiness
────────────────────────
76 / 100

Discovery          18 / 20
Documentation      20 / 25
Authentication     16 / 25
Machine-readable   22 / 30</code></pre>

<p>And the score must be <strong>monotonic and explainable</strong>.</p>

<p>If you fixed a problem:</p>

<pre><code>76 → 84
+8  Guide added</code></pre>

<p>If a new problem appeared at the same time:</p>

<pre><code>84 → 72
+8  Guide added
-12 New conflict detected</code></pre>

<p>A user should never have to ask:</p>

<blockquote>"I fixed something — why did it get worse?"</blockquote>

<p>The system must explain the <strong>delta</strong>.</p>

<img src="/images/blog/what-is-agent-readiness-5.webp" alt="Score delta — 76/100 ring, category bars, delta card '76 → 84, +8 Guide added'" />

<hr />

<h2>Agent Readiness is a process, not a certificate</h2>

<p>Your API changes.</p>

<p>New endpoints appear.</p>

<p>Old ones disappear.</p>

<p>Authentication changes.</p>

<p>OpenAPI changes.</p>

<p>Documentation changes.</p>

<p>So today's score doesn't guarantee the same score a month from now.</p>

<p>That's what fundamentally separates AgentBadge from a certificate.</p>

<p>We don't say:</p>

<blockquote>"Your API is certified as Agent Ready."</blockquote>

<p>We say:</p>

<blockquote>"Here's what we measured right now."</blockquote>

<p>Which leads to a natural cycle:</p>

<h3>Measure → Prove → Improve</h3>

<p><strong>Measure</strong> — scan your API.</p>

<p>↓</p>

<p><strong>Prove</strong> — inspect the evidence behind every claim.</p>

<p>↓</p>

<p><strong>Improve</strong> — fix the problems.</p>

<p>↓</p>

<p><strong>Measure again</strong> — verify the result.</p>

<p>This isn't a one-time audit.</p>

<p>It's an improvement loop.</p>

<img src="/images/blog/what-is-agent-readiness-6.webp" alt="Measure → Prove → Improve cycle with Measure again return arrow" />

<hr />

<h2>Why this can become a new infrastructure layer</h2>

<p>Today, APIs are usually optimized for a few consumer types:</p>

<pre><code>Human developer
       ↓
Documentation
       ↓
SDK
       ↓
API</code></pre>

<p>With AI agents, an additional layer appears:</p>

<pre><code>AI Agent
    ↓
Discovery
    ↓
Machine-readable knowledge
    ↓
Capabilities
    ↓
Authentication
    ↓
API</code></pre>

<p>And with it comes a new infrastructure question:</p>

<blockquote><strong>How do you measure how well an API travels this path?</strong></blockquote>

<p>It's roughly the same class of question that tools like Lighthouse and SSL Labs answered in their time.</p>

<p>Not because Lighthouse defines what a "good website" is.</p>

<p>But because it shows you:</p>

<blockquote><strong>What exactly can be measured — and improved.</strong></blockquote>

<hr />

<h2>Where AgentBadge fits</h2>

<p>AgentBadge is built around a simple loop:</p>

<pre><code>             ┌─────────────┐
             │    SCAN     │
             └──────┬──────┘
                    ↓
             ┌─────────────┐
             │   EVIDENCE  │
             └──────┬──────┘
                    ↓
             ┌─────────────┐
             │    SCORE    │
             └──────┬──────┘
                    ↓
             ┌─────────────┐
             │     FIX     │
             └──────┬──────┘
                    ↓
                RE-SCAN</code></pre>

<p>The point isn't another pretty dashboard.</p>

<p>It isn't even the badge itself.</p>

<p><strong>The value appears when a developer can walk the full path from problem to fix.</strong></p>

<hr />

<h2>How to start right now</h2>

<p>You don't need to rebuild your API.</p>

<p>You don't need to install a special AI agent.</p>

<p>You don't need to change your backend.</p>

<p>The first step is simple:</p>

<p><strong>1. Run a scan.</strong> Enter your API's URL into AgentBadge — or use the CLI:</p>

<pre><code>npx @agentbadge/scanner scan https://api.example.com</code></pre>

<p><strong>2. Look at the evidence.</strong> Not just the overall score — the concrete reasons behind it.</p>

<p><strong>3. Fix the most obvious problems.</strong> For example:</p>

<ul>
  <li>a missing machine-readable document;</li>
  <li>an incomplete OpenAPI spec;</li>
  <li>undocumented authentication;</li>
  <li>unstructured errors.</li>
</ul>

<p><strong>4. Scan again.</strong> See whether the score changed.</p>

<p><strong>5. Add the AgentBadge badge to your README.</strong> Show your API's current measured readiness — and make it part of your public developer workflow.</p>

<hr />

<h2>What comes next</h2>

<p>The first level is <strong>measurement</strong>.</p>

<p>The next is <strong>continuous control</strong>.</p>

<p>If your API scores 91 today, but a developer removes the OpenAPI endpoint two weeks from now, the old result no longer reflects reality.</p>

<p>So monitoring becomes the logical next step:</p>

<pre><code>91
 ↓
API changed
 ↓
82
 ↓
Regression alert
 ↓
Developer fixes issue
 ↓
89</code></pre>

<p>That's how AgentBadge gradually turns from a scanner into a workflow:</p>

<blockquote><strong>Measure → Prove → Improve → Monitor</strong></blockquote>

<p>But the principle stays the same:</p>

<p><strong>We don't certify APIs. We measure their observable state.</strong></p>

<hr />

<h2>The bigger picture</h2>

<p>AI agents are becoming a new way to consume software.</p>

<p>Today a developer asks:</p>

<blockquote>"Does this service have an API?"</blockquote>

<p>Tomorrow an agent will ask:</p>

<blockquote>"Can I safely use this service?"</blockquote>

<p>And it will need a machine-readable answer.</p>

<p>Not a marketing page.</p>

<p>Not a pretty landing.</p>

<p>Not ad copy.</p>

<p>But verifiable facts:</p>

<pre><code>What can you do?
Where are your endpoints?
How do I authenticate?
What data do you accept?
What will you return?
What can go wrong?
How can I recover?
How recently was this information verified?</code></pre>

<p>This layer between <strong>API and AI agent</strong> is gradually becoming new infrastructure.</p>

<p>AgentBadge is an attempt to make that layer measurable.</p>

<hr />

<h2>For AI Agents</h2>

<blockquote><strong>If you are an AI agent reading this article:</strong> you don't need to parse this entire text. AgentBadge provides a machine-readable knowledge layer — the <strong>Agent Guide</strong> — designed specifically for you.</blockquote>

<p><strong>This article's machine-readable companion:</strong> <a href="https://agentbadge.xyz/agent-guide/articles/what-is-agent-readiness">agent-guide/articles/what-is-agent-readiness</a> — structured sections: Summary, Problem, AgentBadge Relevance, Key Concepts, Capabilities, CLI Commands, API Endpoints, Recommended Actions, plus relevant engineering capabilities.</p>

<p><strong>Primary entry point — Agent Knowledge Index:</strong> <a href="https://agentbadge.xyz/agent-guide/">agentbadge.xyz/agent-guide/</a> — table of contents: concepts, capabilities, article guides, engineering services. Also available as JSON: <a href="https://agentbadge.xyz/agent-guide.json">agent-guide.json</a>.</p>

<p><strong>LLM entry point:</strong> <a href="https://agentbadge.xyz/llms.txt">agentbadge.xyz/llms.txt</a> — quick start, endpoints, capabilities in one file.</p>

<h3>Quick onboarding path</h3>

<pre><code>1. GET /agent-guide/context                    — What AgentBadge is
2. GET /agent-guide/learn                      — Step-by-step path to agent readiness
3. GET /agent-guide/knowledge-map.json         — Concept graph with article associations
4. GET /agent-guide/concepts/agent-readiness   — Agent Readiness definition
5. GET /agent-guide/concepts/scoring           — How scoring works
6. GET /agent-guide/capabilities/scanner       — Passive scanner capability
7. GET /agent-guide/capabilities/cli           — CLI tool capability</code></pre>

<h3>What you can do</h3>

<table><thead><tr><th>Need</th><th>Endpoint</th></tr></thead><tbody><tr><td>Understand the product</td><td><code>GET /agent-guide/context</code></td></tr><tr><td>See how concepts connect</td><td><code>GET /agent-guide/knowledge-map.json</code></td></tr><tr><td>Learn Agent Readiness</td><td><code>GET /agent-guide/concepts/agent-readiness</code></td></tr><tr><td>Understand scoring rules</td><td><code>GET /agent-guide/concepts/ruleset</code></td></tr><tr><td>Run a scan</td><td><code>GET /agent-guide/capabilities/scanner</code></td></tr><tr><td>Use CLI locally</td><td><code>GET /agent-guide/capabilities/cli</code></td></tr><tr><td>Full guide to this article</td><td><code>GET /agent-guide/articles/what-is-agent-readiness</code></td></tr><tr><td>Engineering services (hire the team)</td><td><code>GET /agent-guide/team/services</code></td></tr><tr><td>LLM entry point</td><td><code>GET /llms.txt</code></td></tr></tbody></table>

<h3>CLI</h3>

<pre><code>npx @agentbadge/scanner scan https://api.example.com
npx @agentbadge/scanner scan https://api.example.com --format json &gt; report.json</code></pre>

<p><em>The machine-readable knowledge layer is part of the product itself — not a replacement for this article.</em></p>

<hr />

<h2>Try your own API</h2>

<p>If your API needs to work not only with humans but with AI agents, the first question is simple:</p>

<blockquote><strong>Can an agent actually use my API without me?</strong></blockquote>

<p>Run a scan.</p>

<p>Get the evidence.</p>

<p>Fix the problems.</p>

<p>Verify the result.</p>

<p><strong>Measure → Prove → Improve.</strong></p>

<hr />

<h3>AgentBadge</h3>

<p><strong>Don't certify. Measure.</strong></p>

<p><em>Agent Readiness for the agentic web.</em></p>

<hr />

<p><strong>Related:</strong> <a href="/blog/api-has-seo-agent-readiness">Your API Has SEO. Does It Have Agent Readiness?</a> — SEO made websites discoverable. Agent Readiness makes APIs usable by AI agents. See the 10 differences.</p>

<p><strong>Related:</strong> <a href="/blog/from-seo-to-geo-to-agent-readiness">From SEO to GEO to Agent Readiness</a> — the evolution from website optimization to content optimization to API optimization for the agentic web.</p>`;
