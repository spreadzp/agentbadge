import type { BlogArticle } from "../../blog-data";

export const article: BlogArticle = 
  {
    slug: "what-is-agent-readiness",
    title: "What Is Agent Readiness?",
    description:
      "Agent Readiness is the ability of your API to be discovered, understood, and used by an AI agent — without a human intervening. SEO for the agentic web.",
    author: "AgentBadge Team",
    authorRole: "Agency for the Agentic Web",
    date: "2026-08-14",
    dateModified: "2026-08-14",
    agentGuideSlug: "what-is-agent-readiness",
    heroImage: "/images/blog/what-is-agent-readiness-hero.png",
    ogImage: "/images/blog/what-is-agent-readiness-og.png",
    shortAnswer: "Agent Readiness is the ability of your API to be discovered, understood, and used by an AI agent without human intervention. It extends SEO principles to machine-readable interfaces — OpenAPI, MCP, llms.txt, and structured discovery layers that let agents navigate your service autonomously.",
    tags: ["agent-readiness", "seo", "aeo", "agentic-web", "api"],
    readingTime: "15 min",
    content: `<h2>Why a good API can be invisible to AI agents</h2>

<p>Imagine this scenario.</p>

<p>You've built an excellent API. It's fast, stable, well documented, with clean authentication and a sane architecture.</p>

<p>A human developer opens your docs — and an hour later they've integrated your service.</p>

<p>Now an AI agent tries to use the same API.</p>

<p>It searches for the service. It doesn't find it.</p>

<p>It tries to understand the documentation. It can't locate the OpenAPI spec.</p>

<p>It finds an endpoint, but can't figure out which authentication it needs.</p>

<p>It gets an error — and the error explains nothing about what went wrong.</p>

<p>Eventually the agent does what any inexperienced integrator would do: it gives up, or asks a human to step in.</p>

<p><strong>The problem may not be your API. The problem is that your API isn't prepared for machine consumption.</strong></p>

<p>That problem is what we call <strong>Agent Readiness</strong>.</p>

<img src="/images/blog/what-is-agent-readiness-hero.png" alt="Hero — a human developer walks into API Docs while an AI agent faces a featureless wall" />

<hr />

<h2>Agent Readiness is not "how smart your AI is"</h2>

<p>Agent Readiness is the degree to which an API or service can be:</p>

<ul>
  <li><strong>found</strong> by an AI agent;</li>
  <li><strong>understood</strong> without human help;</li>
  <li><strong>called</strong> correctly;</li>
  <li><strong>authenticated</strong> against properly;</li>
  <li><strong>recovered</strong> when errors occur.</li>
</ul>

<p>Put simply:</p>

<blockquote><strong>Agent Readiness is the ability of your API to be discovered, understood, and used by an AI agent — without a human intervening.</strong></blockquote>

<p>Here's a useful analogy with the internet we already know.</p>

<p><strong>SEO made websites visible to search engines.</strong></p>

<p><strong>Agent Readiness makes APIs visible and understandable to AI agents.</strong></p>

<hr />

<h2>From SEO to Agent Readiness</h2>

<p>For decades, companies optimized websites for search engines.</p>

<p>We got:</p>

<ul>
  <li><code>robots.txt</code>;</li>
  <li>sitemaps;</li>
  <li>structured data;</li>
  <li>meta tags;</li>
  <li>canonical URLs;</li>
  <li>performance optimization;</li>
  <li>search ranking.</li>
</ul>

<p>All of these mechanisms solved one big problem:</p>

<blockquote><strong>How do you make a resource understandable to a machine that must find and process it?</strong></blockquote>

<p>AI agents create a similar problem — but at a different level.</p>

<p>A search engine only needs to understand:</p>

<blockquote>"This page is about payments."</blockquote>

<p>An agent needs to understand much more:</p>

<blockquote>"This service can create payments. The endpoint is here. An API key is required. The request should look like this. The response has this structure. And if a 402 error comes back — here's the next step."</blockquote>

<p>That's no longer just <strong>discoverability</strong>.</p>

<p>That's <strong>machine usability</strong>.</p>

<h3>The analogy, side by side</h3>

<table><thead><tr><th>Web / SEO</th><th>Agentic Web</th></tr></thead><tbody><tr><td>Search engine finds a website</td><td>AI agent finds an API</td></tr><tr><td><code>robots.txt</code></td><td>machine-readable instructions</td></tr><tr><td>Sitemap</td><td>capability discovery</td></tr><tr><td>Meta description</td><td>structured API description</td></tr><tr><td>Open Graph / structured data</td><td>OpenAPI / agent metadata</td></tr><tr><td>Search ranking</td><td>Agent Readiness score</td></tr><tr><td>Web crawler</td><td>AI agent</td></tr><tr><td>Website visitor</td><td>API-consuming agent</td></tr></tbody></table>

<p>But there's one fundamental difference.</p>

<p><strong>A search engine needs to understand a page.</strong></p>

<p><strong>An agent needs to take an action.</strong></p>

<p>And that's why the requirements for APIs are quietly changing.</p>

<img src="/images/blog/what-is-agent-readiness-2.png" alt="Web vs Agentic Web — two parallel flows: robots.txt/sitemap/search vs machine-readable docs/capabilities/action" />

<hr />

<h2>Why documentation written for humans isn't enough</h2>

<p>Most API documentation was written assuming a human on the other side.</p>

<p>A human can:</p>

<ol>
  <li>open the docs;</li>
  <li>read the description;</li>
  <li>look at an example;</li>
  <li>infer the context;</li>
  <li>guess which endpoint is needed;</li>
  <li>figure out authentication from a screenshot;</li>
  <li>try a request;</li>
  <li>interpret an error message.</li>
</ol>

<p>A human has context.</p>

<p>An AI agent has to <strong>reconstruct that context from machine-readable signals alone</strong>.</p>

<p>For example, an agent may need to answer:</p>

<pre><code>What does this API do?

Where are its endpoints?

Which endpoint should I call?

What parameters are required?

How do I authenticate?

What does a successful response look like?

What happens when the request fails?

Can I safely retry?

How much does this operation cost?</code></pre>

<p>If the answers are scattered across prose, hidden behind JavaScript-rendered pages, described only in natural language, or missing entirely — the agent has to guess.</p>

<p>And guessing is a terrible foundation for automated interaction.</p>

<hr />

<h2>Agent Readiness has several layers</h2>

<p>It's tempting to reduce the problem to a single file — "just add an <code>agent-guide.json</code> and you're done."</p>

<p>A genuinely agent-ready system passes through several layers.</p>

<h3>1. Discovery</h3>

<p><strong>Can an agent find your API at all?</strong></p>

<p>For example:</p>

<ul>
  <li>is there a clear public URL;</li>
  <li>is there a machine-readable description;</li>
  <li>are discovery files available (<code>llms.txt</code>, agent manifests, API catalogs);</li>
  <li>is it obvious where the documentation lives.</li>
</ul>

<p>If the API can't be found, the remaining layers don't matter.</p>

<h3>2. Understanding</h3>

<p>The agent found the API.</p>

<p>Now it must understand:</p>

<blockquote>"What can I actually do here?"</blockquote>

<p>That requires structured descriptions of capabilities, endpoints, parameters, and responses.</p>

<p>OpenAPI is one of the most important sources of this information.</p>

<p>But the mere existence of an OpenAPI file doesn't guarantee an agent can use the API correctly. The spec may be:</p>

<ul>
  <li>outdated;</li>
  <li>incomplete;</li>
  <li>contradictory;</li>
  <li>poorly described;</li>
  <li>out of sync with real API behavior.</li>
</ul>

<p><strong>Having documentation and having quality machine-readable documentation are different things.</strong></p>

<h3>3. Authentication</h3>

<p>Next question:</p>

<blockquote>"How do I get access?"</blockquote>

<p>For a human, you can write:</p>

<blockquote>Create an API key in your dashboard.</blockquote>

<p>An agent needs something like:</p>

<pre><code>Authentication type: API key

Location: Authorization header

Header: X-API-Key

Required: yes</code></pre>

<p>The less an agent has to guess, the higher the chance of a successful interaction.</p>

<h3>4. Machine-readable responses</h3>

<p>The agent must understand responses.</p>

<p>For example:</p>

<pre><code>{
  "id": "pay_123",
  "status": "completed",
  "amount": 49.00
}</code></pre>

<p>is dramatically easier to process automatically than an HTML page saying:</p>

<blockquote>Your payment has been successfully processed.</blockquote>

<p>The same applies to errors.</p>

<p>A good error shouldn't just be readable by a human.</p>

<p>It should be <strong>operationally useful to an agent</strong>:</p>

<pre><code>{
  "error": "insufficient_balance",
  "message": "Insufficient account balance",
  "retryable": false
}</code></pre>

<p>Now the agent can make a decision.</p>

<img src="/images/blog/what-is-agent-readiness-3.png" alt="Four layers of Agent Readiness — Discovery, Understanding, Authentication, Machine-readable responses" />

<hr />

<h2>The most important distinction: an API can be good — and still agent-hostile</h2>

<p>This difference matters.</p>

<p><strong>An agent-hostile API is not necessarily a bad API.</strong></p>

<p>It was simply designed for a different consumer.</p>

<p>Imagine a restaurant.</p>

<p>For a human:</p>

<blockquote>"Ask the waiter about the special menu."</blockquote>

<p>For an agent:</p>

<pre><code>{
  "action": "order",
  "menu": "special",
  "quantity": 1
}</code></pre>

<p>Both interfaces lead to the same result.</p>

<p>But the second one is far easier to automate.</p>

<p>AI agents are creating a new class of API consumer.</p>

<p>And that forces developers to answer a new question:</p>

<blockquote><strong>"If 10,000 AI agents wanted to use my API tomorrow, could they do it without a human's help?"</strong></blockquote>

<hr />

<h2>How AgentBadge measures Agent Readiness</h2>

<p>This is where AgentBadge comes in.</p>

<p>AgentBadge doesn't try to say:</p>

<blockquote>"This API is good."</blockquote>

<p>And it definitely doesn't say:</p>

<blockquote>"This API is certified."</blockquote>

<p>We follow a different principle:</p>

<blockquote><strong>Don't certify. Measure.</strong></blockquote>

<p>AgentBadge checks observable properties of an API and shows:</p>

<ul>
  <li>what was found;</li>
  <li>what's missing;</li>
  <li>which rule fired;</li>
  <li>what evidence was collected;</li>
  <li>why the score changed.</li>
</ul>

<h3>Evidence first</h3>

<p>Suppose a system shows you:</p>

<blockquote><strong>Agent Readiness: 76/100</strong></blockquote>

<p>The number itself is almost useless.</p>

<p>Every developer's next question is:</p>

<blockquote><strong>Why 76?</strong></blockquote>

<p>That's why AgentBadge is built around an <strong>evidence-first</strong> approach.</p>

<p>Instead of:</p>

<pre><code>Documentation: 62</code></pre>

<p>you get:</p>

<pre><code>AB-004 OpenAPI specification

Status: VERIFIED

Evidence:
GET https://example.com/openapi.json

HTTP: 200
Content-Type: application/json

Confidence: 1.0</code></pre>

<p>Now the result is verifiable.</p>

<p>That's a fundamental difference.</p>

<p><strong>AgentBadge doesn't ask you to trust the number.</strong></p>

<p><strong>It shows you where the number came from.</strong></p>

<img src="/images/blog/what-is-agent-readiness-4.png" alt="Evidence card — rule AB-004 VERIFIED, HTTP 200, confidence 1.0" />

<hr />

<h2>Deterministic before intelligent</h2>

<p>Another foundational principle of AgentBadge.</p>

<p>We don't want to start with:</p>

<blockquote>"Let an LLM look at the API and decide how agent-ready it is."</blockquote>

<p>The problem is obvious.</p>

<p>Different models will score the same API differently.</p>

<p>So the base checks must be <strong>deterministic</strong>:</p>

<pre><code>Does /openapi.json exist?
        ↓
HTTP 200?
        ↓
Valid OpenAPI?
        ↓
Authentication described?
        ↓
Structured error schema present?</code></pre>

<p>This can be verified programmatically.</p>

<p>AI can be layered on top of that.</p>

<p>But here, AI must be a <strong>copilot, not a judge</strong>.</p>

<hr />

<h2>What AI should actually do</h2>

<p>AI is excellent at tasks that require interpretation.</p>

<p>For example:</p>

<blockquote>"We found a description of this endpoint. Help the developer understand what to add to the machine-readable documentation."</blockquote>

<p>Or:</p>

<blockquote>"We found a capability that looks like a payment operation. Draft a description — but ask the API owner to confirm it."</blockquote>

<p>This is fundamentally different from:</p>

<blockquote>"AI decided your API has capability X, so we recorded it in the official guide."</blockquote>

<p>The second option is dangerous — especially if the result silently lands in a file that other agents will rely on.</p>

<p>That's why we separate fixes into two types.</p>

<h3>Deterministic Fix</h3>

<p>Can be applied automatically.</p>

<pre><code>missing robots.txt
missing sitemap
missing badge configuration</code></pre>

<h3>Assisted Fix</h3>

<p>Requires human confirmation.</p>

<pre><code>Agent inferred:

POST /refund

Capability:
Refund a completed payment

Confidence:
0.71</code></pre>

<p>Here the system must show:</p>

<p><strong>Confirm / Edit / Reject</strong></p>

<p>— not silently write a guess into production documentation.</p>

<hr />

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

<img src="/images/blog/what-is-agent-readiness-5.png" alt="Score delta — 76/100 ring, category bars, delta card '76 → 84, +8 Guide added'" />

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

<img src="/images/blog/what-is-agent-readiness-6.png" alt="Measure → Prove → Improve cycle with Measure again return arrow" />

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

<pre><code>npx @agentbadge/cli scan https://api.example.com</code></pre>

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

<pre><code>npx @agentbadge/cli scan https://api.example.com
npx @agentbadge/cli scan https://api.example.com --format json &gt; report.json</code></pre>

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

<p><strong>Related:</strong> <a href="/blog/from-seo-to-geo-to-agent-readiness">From SEO to GEO to Agent Readiness</a> — the evolution from website optimization to content optimization to API optimization for the agentic web.</p>`,
    externalLinks: [
      {
        platform: "devto",
        url: "https://dev.to/spread2009/what-is-agent-readiness-1b59",
      },
      {
        platform: "medium",
        url: "https://paulspread-99907.medium.com/what-is-agent-readiness-agentbadge-blog-agentbadge-6661bd18750a",
      },
      {
        platform: "linkedin",
        url: "https://www.linkedin.com/posts/paul-spread-bb337b63_ai-api-aiagents-share-7494045030396039169-QbUp/",
      },
      {
        platform: "hackernews",
        url: "https://news.ycombinator.com/item?id=49361630",
      },
      {
        platform: "twitter",
        url: "https://x.com/paul_spread/status/2088268170003907062",
      },
      {
        platform: "qiita",
        url: "https://qiita.com/buidl25/items/071c755727117a117c30",
      },
      {
        platform: "velog",
        url: "https://velog.io/@buidl_25/What-Is-Agent-Readiness-エージェント対応度とは",
      },
      {
        platform: "hsoub",
        url: "https://io.hsoub.com/artificial_intelligence/185154-ما-هي-جاهزية-الوكلاء-agent-readiness",
      },
    ],
    relatedLinks: [
      { label: "FAQ", href: "/faq", description: "Common questions about agent readiness" },
      { label: "Agent Guide", href: "/agent-guide/articles/what-is-agent-readiness", description: "Step-by-step guide to becoming agent-ready" },
      { label: "Run a Scan", href: "/services/scanner", description: "Check your API's agent readiness score" },
    ],
  };
