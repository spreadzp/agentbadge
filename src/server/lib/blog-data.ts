export interface BlogExternalLink {
  platform:
  | "devto"
  | "medium"
  | "linkedin"
  | "hackernews"
  | "hackernoon"
  | "reddit"
  | "github"
  | "hashnode"
  | "twitter"
  | "qiita"
  | "zenn"
  | "velog"
  | "hsoub";
  url: string;
}

export interface BlogArticle {
  slug: string;
  title: string;
  description: string;
  author: string;
  authorRole: string;
  date: string;
  dateModified?: string;
  tags: string[];
  readingTime: string;
  content: string;
  markdown?: string;
  agentGuideSlug?: string;
  heroImage?: string;
  ogImage?: string;
  shortAnswer?: string;
  externalLinks?: BlogExternalLink[];
}

export const BLOG_ARTICLES: BlogArticle[] = [
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
  },
  {
    slug: "api-has-seo-agent-readiness",
    title: "Your API Has SEO. Does It Have Agent Readiness?",
    description:
      "SEO optimized websites for search engines. Agent Readiness optimizes APIs for AI agents. Why a good SEO score doesn't mean your API is agent-ready — and 10 things to check.",
    author: "AgentBadge Team",
    authorRole: "Agency for the Agentic Web",
    date: "2026-08-14",
    dateModified: "2026-08-14",
    agentGuideSlug: "seo-vs-agent-readiness",
    heroImage: "/images/blog/api-has-seo-agent-readiness-hero.png",
    ogImage: "/images/blog/api-has-seo-agent-readiness-og.png",
    shortAnswer: "SEO optimizes websites for search engines. Agent Readiness optimizes APIs for AI agents. A good SEO score doesn't mean your API is agent-ready — you need machine-readable discovery, OpenAPI specs, MCP tools, and structured metadata that agents can parse and act on.",
    tags: ["agent-readiness", "seo", "aeo", "agentic-web", "api"],
    readingTime: "12 min",
    content: `<h2>20 Years of SEO → A New Era</h2>

<p>We've spent 20 years making websites discoverable by search engines. <code>robots.txt</code>, sitemaps, structured data, meta tags, canonical URLs — all of SEO exists to help a search engine find and understand a page.</p>

<p>Now there's a new consumer of information: the AI agent. It doesn't just need to find a page. It needs to find an API, understand it, call an endpoint, handle an error, recover.</p>

<p><strong>Web page → Search engine → SEO. API → AI agent → Agent Readiness.</strong></p>

<p>This isn't an evolution of SEO. It's a new layer.</p>

<img src="/images/blog/api-has-seo-agent-readiness-hero.png" alt="Hero — SEO on the left with green checkmarks, Agent Readiness on the right with red X marks on missing OpenAPI, auth, and structured errors" />

<hr />

<h2>SEO ≠ Discoverability</h2>

<p>Your API might have excellent SEO on its landing page, proper meta tags, a sitemap, and good Google indexing — and still be <strong>invisible</strong> to an AI agent.</p>

<p>Why? Because SEO optimizes for a search engine that needs to <strong>understand a page</strong>. An agent needs to <strong>take an action</strong>. These are different tasks.</p>

<p>A search engine reads. An agent acts.</p>

<p>When a user asks an agent: <em>"Find a service that does X and use its API"</em>, the agent needs to:</p>

<ol>
  <li>Discover the API</li>
  <li>Understand its capabilities</li>
  <li>Figure out authentication</li>
  <li>Understand endpoint parameters and request format</li>
  <li>Understand rate limits and pricing</li>
  <li>Handle errors</li>
  <li>Complete the task</li>
</ol>

<p>SEO helps with step 1 — finding the page. Steps 2–7 require entirely different infrastructure.</p>

<img src="/images/blog/api-has-seo-agent-readiness-2.png" alt="Two parallel pipelines — Web Discovery (SEO, green checkmarks) vs API Discovery (Agent Readiness, question marks and gaps)" />

<hr />

<h2>Human-Readable vs Machine-Readable</h2>

<p>The key difference between SEO and Agent Readiness is the format of information.</p>

<p><strong>Human-readable (good for developers):</strong></p>

<p><em>"To refund an order, contact our support team at support@example.com or visit the refunds page in your dashboard."</em></p>

<p><strong>Machine-readable (good for agents):</strong></p>

<p><code>POST /refund</code> with <code>order_id</code> and <code>reason</code> → returns <code>refund_id</code>, <code>status</code>, <code>amount</code>.</p>

<p>A human can guess. An agent can't. An agent needs structure.</p>

<p>A more powerful model can't fix missing information that the API simply didn't provide.</p>

<img src="/images/blog/api-has-seo-agent-readiness-3.png" alt="Side-by-side comparison — human reading prose documentation vs AI agent parsing structured JSON schema" />

<hr />

<h2>The Four Dimensions of Agent Readiness</h2>

<p>Agent Readiness is not a single metric. It's four independent dimensions:</p>

<table>
  <thead>
    <tr><th>Dimension</th><th>Question</th><th>What We Check</th></tr>
  </thead>
  <tbody>
    <tr><td><strong>Discovery</strong></td><td>Can an agent find the API?</td><td>llms.txt, well-known endpoints, OpenAPI URL, ai-sitemap</td></tr>
    <tr><td><strong>Documentation</strong></td><td>Can an agent understand capabilities?</td><td>OpenAPI spec, machine-readable descriptions</td></tr>
    <tr><td><strong>Authentication</strong></td><td>Can an agent understand auth flow?</td><td>OAuth discovery, token endpoint, scopes</td></tr>
    <tr><td><strong>Machine-readability</strong></td><td>Can an agent process responses?</td><td>Structured errors, rate limit headers, content negotiation</td></tr>
  </tbody>
</table>

<p>Each dimension is independent. An API can be excellent in Documentation but fail in Discovery.</p>

<p><strong>SEO analogy:</strong></p>

<ul>
  <li>Discovery ≈ robots.txt + sitemap (can the search engine find the page?)</li>
  <li>Documentation ≈ structured data + meta tags (can the search engine understand the content?)</li>
  <li>Authentication ≈ no direct SEO equivalent (a new problem)</li>
  <li>Machine-readability ≈ semantic HTML + accessibility (can a parser extract the data?)</li>
</ul>

<img src="/images/blog/api-has-seo-agent-readiness-4.png" alt="Four-layer stack diagram — Discovery, Documentation, Authentication, Machine-readability" />

<hr />

<h2>Self-Test: 7 Questions for Your API</h2>

<p>If a new AI agent encountered your API today, could it independently answer:</p>

<ol>
  <li><strong>Where is the OpenAPI spec?</strong> (is there a machine-readable description of all endpoints?)</li>
  <li><strong>What authorization is needed?</strong> (OAuth flow, token endpoint, scopes — in machine-readable format)</li>
  <li><strong>What capabilities does the API offer?</strong> (what the API can do — not prose, but structured)</li>
  <li><strong>What errors can occur?</strong> (structured error responses, not "500 Internal Server Error")</li>
  <li><strong>What are the rate limits?</strong> (in headers, not in prose)</li>
  <li><strong>How much does it cost?</strong> (machine-readable pricing, not "contact sales")</li>
  <li><strong>Can an agent complete a task?</strong> (end-to-end flow without human intervention)</li>
</ol>

<p>If 3+ answers are "not sure" — you have an Agent Readiness gap.</p>

<img src="/images/blog/api-has-seo-agent-readiness-5.png" alt="Agent Readiness Self-Test checklist card with 7 questions, some checked green, some unchecked red" />

<hr />

<h2>AgentBadge: Measure, Don't Certify</h2>

<p>AgentBadge doesn't certify APIs. AgentBadge <strong>measures</strong> — how accessible an API is to agents.</p>

<blockquote><strong>We don't certify your API. We measure how accessible it is to agents.</strong></blockquote>

<p>The process: <strong>Measure → Evidence → Fix → Monitor</strong></p>

<ul>
  <li><strong>Measure:</strong> 72 deterministic checks (not "AI opinion", but observable facts)</li>
  <li><strong>Evidence:</strong> each check has proof — HTTP response, header, body fragment</li>
  <li><strong>Fix:</strong> specific recommendations on what to change</li>
  <li><strong>Monitor:</strong> regular rescans, delta tracking</li>
</ul>

<p><strong>Why not "AI scoring":</strong> LLMs can hallucinate. Deterministic checks can't. If we say "OpenAPI spec not found" — that's a fact, not an opinion.</p>

<img src="/images/blog/api-has-seo-agent-readiness-6.png" alt="Circular flow diagram — Measure → Evidence → Fix → Monitor → back to Measure, with AgentBadge in the center" />

<hr />

<h2>What Happens When an AI Agent Visits Your API?</h2>

<p>AI agents are becoming a major consumer of APIs. If your API isn't agent-ready, you're invisible to an entire category of users.</p>

<p><strong>Discover → Understand → Act.</strong></p>

<p>Then run a free Agent Readiness scan.</p>

<h3>What you can do</h3>

<ul>
  <li><a href="/services/scanner">Run a free scan</a> — get your Agent Readiness score</li>
  <li><a href="/blog/what-is-agent-readiness">Read Article 1: What Is Agent Readiness?</a> — the foundation</li>
  <li><a href="/agent-guide/">Explore the Agent Knowledge Layer</a> — machine-readable guide for AI agents</li>
</ul>

<h3>CLI</h3>

<p><code>npx @agentbadge/cli scan https://api.example.com</code></p>

<p>The CLI is free, runs locally, and produces the same results as the web scanner.</p>

<hr />

<h2>For AI Agents</h2>

<blockquote><strong>If you are an AI agent reading this article:</strong> you don't need to parse this entire text. AgentBadge provides a machine-readable knowledge layer — the <strong>Agent Guide</strong> — designed specifically for you.</blockquote>

<p><strong>This article's machine-readable companion:</strong> <a href="https://agentbadge.xyz/agent-guide/articles/seo-vs-agent-readiness">agent-guide/articles/seo-vs-agent-readiness</a> — structured sections: Summary, Problem, AgentBadge Relevance, Key Concepts, Capabilities, CLI Commands, API Endpoints, Recommended Actions.</p>

<p><strong>Primary entry point — Agent Knowledge Index:</strong> <a href="https://agentbadge.xyz/agent-guide/">agentbadge.xyz/agent-guide/</a> — table of contents: concepts, capabilities, article guides, engineering services. Also available as JSON: <a href="https://agentbadge.xyz/agent-guide.json">agent-guide.json</a>.</p>

<hr />

<h3>AgentBadge</h3>

<p><strong>Don't certify. Measure.</strong></p>

<p><strong>Related:</strong> <a href="/blog/from-seo-to-geo-to-agent-readiness">From SEO to GEO to Agent Readiness</a> — the evolution from website optimization to content optimization to API optimization for the agentic web.</p>`,
    externalLinks: [
      {
        platform: "devto",
        url: "https://dev.to/spread2009/your-api-has-seo-does-it-have-agent-readiness-2m14",
      },
      {
        platform: "linkedin",
        url: "https://www.linkedin.com/posts/paul-spread-bb337b63_ai-api-aiagents-share-7494123829779378176-Wf8K/",
      },
      {
        platform: "medium",
        url: "https://paulspread-99907.medium.com/your-api-has-seo-does-it-have-agent-readiness-5a5544b89746",
      },
      {
        platform: "twitter",
        url: "https://x.com/paul_spread/status/2088359386578120849",
      },
    ],
  },
  {
    slug: "web-becoming-agentic-api-discovery",
    title: "The Web Is Becoming Agentic. What Happens to API Discovery?",
    description:
      "Search engines solved discovery for humans. Agentic systems need a machine-readable discovery layer for software. Here's what that means — and why existing tools are layers, not competitors.",
    author: "AgentBadge Team",
    authorRole: "Agency for the Agentic Web",
    date: "2026-08-15",
    dateModified: "2026-08-15",
    agentGuideSlug: "web-becoming-agentic-api-discovery",
    heroImage: "/images/blog/web-becoming-agentic-api-discovery-hero.png",
    ogImage: "/images/blog/web-becoming-agentic-api-discovery-hero.png",
    shortAnswer: "As AI agents replace humans as API consumers, discovery shifts from search engines to machine-readable layers like llms.txt, MCP, and A2A protocols. These are not competitors to search — they are a new discovery stack built for software, not humans.",
    tags: ["agent-readiness", "api-discovery", "agentic-web", "llms-txt", "mcp"],
    readingTime: "14 min",
    content: `<h2>Search engines solved discovery for humans. Agentic systems need a machine-readable discovery layer for software.</h2>

<p>For 20 years, the web was built around one discovery model.</p>

<p>A human searches Google. Finds documentation. Reads through API descriptions. Compares options in a marketplace. Makes a decision. Integrates.</p>

<p>Every step of this flow was designed for human judgment — the ability to read prose, infer context, compare unstructured descriptions, and fill in gaps with intuition.</p>

<p>Now a new consumer is emerging: the AI agent.</p>

<p>An agent receiving the instruction "find an API for international payments and execute a transaction" must do everything a human developer would do — but autonomously, using only machine-readable signals.</p>

<p>And the infrastructure that made APIs discoverable for humans? It wasn't built for this.</p>

<img src="/images/blog/web-becoming-agentic-api-discovery-hero.png" alt="Hero — split screen: left side human+Google+docs flow with green checkmarks, right side AI agent+???+API with question marks and dashed lines" />

<hr />

<h2>The old discovery model: human as primary consumer</h2>

<p>In the old model, API discovery looked like this:</p>

<pre><code>Human
  ↓
Google / docs / marketplace
  ↓
API</code></pre>

<p>A developer would:</p>

<ol>
  <li>Google "best API for payments"</li>
  <li>Find a marketplace (RapidAPI, AWS Marketplace)</li>
  <li>Read documentation</li>
  <li>Compare options side by side</li>
  <li>Make a decision based on features, pricing, and reputation</li>
  <li>Integrate</li>
</ol>

<p>Each step required human judgment. Understanding context. Comparing unstructured descriptions. Making decisions with incomplete information. Filling in gaps by reading between the lines.</p>

<p>This model worked because the consumer was always a human who could <strong>guess</strong>.</p>

<hr />

<h2>The new discovery model: agent as primary consumer</h2>

<p>Now imagine the consumer is an AI agent.</p>

<pre><code>Human
  ↓
AI Agent
  ↓
???
  ↓
API</code></pre>

<p>A user says: "Find an API for international payments and execute a transaction."</p>

<p>The agent must independently:</p>

<ul>
  <li><strong>Discover</strong> which providers exist</li>
  <li><strong>Understand</strong> what each API can do</li>
  <li><strong>Compare</strong> options against the user's requirements</li>
  <li><strong>Check pricing</strong> — is this transaction cost-effective?</li>
  <li><strong>Handle authentication</strong> — how do I get access?</li>
  <li><strong>Select</strong> a provider</li>
  <li><strong>Call</strong> the API</li>
  <li><strong>Handle errors</strong> — what if something goes wrong?</li>
</ul>

<p>At each step, the agent needs <strong>machine-readable information</strong>. Not prose documentation. Not a landing page. Not a marketing description.</p>

<p>Structured, parseable, actionable data.</p>

<p>If the information exists only in human-readable documentation — scattered across prose, hidden behind JavaScript-rendered pages, described only in natural language — the agent cannot complete the path autonomously.</p>

<p>The question is not whether agents can read documentation.</p>

<p>The question is: <strong>where is the machine-readable information that lets an agent complete the full discovery-to-execution pipeline without a human?</strong></p>

<hr />

<h2>What an agent needs to know about an API</h2>

<p>It's not enough for an agent to know:</p>

<blockquote>api.example.com exists</blockquote>

<p>An agent must understand:</p>

<ul>
  <li><strong>What the API can do</strong> — capabilities, operations, available actions</li>
  <li><strong>Which operations are available</strong> — endpoints, methods, parameters</li>
  <li><strong>How to authenticate</strong> — auth flow, token endpoint, scopes, API keys</li>
  <li><strong>How much it costs</strong> — machine-readable pricing, per-call cost, tier limits</li>
  <li><strong>What the limits are</strong> — rate limits, quotas, usage caps</li>
  <li><strong>How reliable the documentation is</strong> — is the OpenAPI spec in sync with the actual API?</li>
  <li><strong>Whether to trust the description</strong> — self-declared vs verified metadata</li>
  <li><strong>Whether the endpoint actually matches the claimed behavior</strong> — evidence, not claims</li>
</ul>

<p>This is where <strong>Agent Readiness as discovery infrastructure</strong> enters the picture.</p>

<img src="/images/blog/web-becoming-agentic-api-discovery-2.png" alt="Agent workflow — 8-step pipeline: Discover → Understand → Compare → Price → Auth → Select → Call → Handle Errors, with checkmarks and question marks showing where agents get stuck" />

<hr />

<h2>Existing mechanisms: not competitors, but layers</h2>

<p>It would be easy to say: "our standard solves everything."</p>

<p>That would be wrong.</p>

<p>The truth is that several technologies already address pieces of the problem. But none of them address all of it.</p>

<table><thead><tr><th>Mechanism</th><th>What it solves</th><th>What it doesn't solve</th></tr></thead><tbody><tr><td><strong>Search</strong></td><td>Discovery for humans</td><td>Machine-readable context, execution</td></tr><tr><td><strong>OpenAPI</strong></td><td>Interface description</td><td>Discovery, trust, verification, pricing</td></tr><tr><td><strong>llms.txt</strong></td><td>Context for LLMs</td><td>Execution, auth, rate limits, error handling</td></tr><tr><td><strong>MCP</strong></td><td>Tool interface for agents</td><td>Discovery, comparison, trust</td></tr><tr><td><strong>API marketplace</strong></td><td>Catalog of APIs</td><td>Machine-readable evaluation, verification</td></tr><tr><td><strong>Agent Readiness</strong></td><td>Verification that all layers work for agents</td><td>—</td></tr></tbody></table>

<p>The key insight:</p>

<blockquote><strong>These technologies don't compete. They are different layers of one agentic web.</strong></blockquote>

<p>OpenAPI describes interfaces. llms.txt gives context. MCP provides tool calling. API marketplaces catalog. Agent Readiness measures whether all of these actually work for an agent end-to-end.</p>

<img src="/images/blog/web-becoming-agentic-api-discovery-3.png" alt="Comparison layers — stacked diagram: Search (gray), API Marketplace (gray), OpenAPI (cyan), llms.txt (cyan), MCP (cyan-green), Agent Readiness (green), with brackets showing Human discovery vs Machine context vs Verification" />

<hr />

<h2>The emerging stack: Discovery → Understanding → Trust</h2>

<p>Three layers separate an AI agent from an API:</p>

<pre><code>         HUMAN
           │
           ▼
        AI AGENT
           │
   ┌───────┼───────┐
   ▼       ▼       ▼
Discovery  Understanding  Trust
   │       │       │
   ▼       ▼       ▼
Catalog    OpenAPI    Evidence
llms.txt   Docs       Verification
   │       │       │
   └───────┼───────┘
           ▼
          API</code></pre>

<h3>Layer 1: Discovery</h3>

<p><strong>Can an agent find your API?</strong></p>

<p>This is the most basic question. If the API can't be found, nothing else matters.</p>

<p>Discovery mechanisms include <code>llms.txt</code>, well-known endpoints, ai-sitemap, and API marketplaces. But discovery alone only answers "does this API exist?" — not "can I use it?"</p>

<h3>Layer 2: Understanding</h3>

<p><strong>Can an agent parse your API's capabilities?</strong></p>

<p>The agent found the API. Now it needs to understand what it can do.</p>

<p>OpenAPI specs, machine-readable documentation, and MCP tool descriptions all serve this layer. But understanding alone doesn't answer "should I trust this?"</p>

<h3>Layer 3: Trust</h3>

<p><strong>Can an agent verify your API's claims?</strong></p>

<p>This is the newest layer — and the one that didn't exist in the human-centric model.</p>

<p>A human can read reviews, check reputation, look at GitHub stars, and make a judgment call. An agent needs something different: <strong>evidence</strong>.</p>

<p>Is the OpenAPI spec actually in sync with the API? Does the claimed authentication flow actually work? Are error responses actually structured as described?</p>

<p>Trust requires verification. Verification requires evidence.</p>

<img src="/images/blog/web-becoming-agentic-api-discovery-4.png" alt="Architecture stack — 3-column diagram: Discovery (cyan), Understanding (cyan-green), Trust (green), each with sub-items, converging into API at bottom" />

<hr />

<h2>Concrete scenario: "Find an API for international payments"</h2>

<p>Let's make this real.</p>

<p>A user says: "Find an API for international payments and execute a transaction."</p>

<p>The agent must walk an 8-step path:</p>

<pre><code>1. Discover providers
       ↓
2. Understand capabilities (send, receive, convert, track)
       ↓
3. Compare APIs (fees, speed, coverage, reliability)
       ↓
4. Understand pricing (per-transaction cost, FX spread)
       ↓
5. Understand authentication (OAuth, API key, scopes)
       ↓
6. Select provider
       ↓
7. Call API (execute the transaction)
       ↓
8. Handle errors (insufficient balance, compliance, timeout)</code></pre>

<p>At each step, the agent needs machine-readable information:</p>

<table><thead><tr><th>Step</th><th>What the agent needs</th><th>Where it comes from</th></tr></thead><tbody><tr><td>Discover</td><td>List of payment APIs</td><td>Marketplace, llms.txt, ai-sitemap</td></tr><tr><td>Understand</td><td>Capabilities, endpoints, parameters</td><td>OpenAPI spec, MCP tools</td></tr><tr><td>Compare</td><td>Fees, speed, coverage</td><td>Machine-readable pricing (rare today)</td></tr><tr><td>Price</td><td>Per-call cost</td><td>x402 headers, pricing API (rare today)</td></tr><tr><td>Auth</td><td>Auth flow, token endpoint</td><td>OAuth discovery, well-known endpoints</td></tr><tr><td>Select</td><td>Trust signal, evidence</td><td>Agent Readiness score, verified checks</td></tr><tr><td>Call</td><td>Request format, expected response</td><td>OpenAPI spec, examples</td></tr><tr><td>Errors</td><td>Error codes, retry policy</td><td>Structured error responses, rate limit headers</td></tr></tbody></table>

<p>Look at the "Where it comes from" column. Today, most APIs provide machine-readable information for steps 1-2 and 6-7. Steps 3-5 and 8 are often buried in prose documentation.</p>

<p>That's where the agent gets stuck.</p>

<p>And that's where Agent Readiness becomes relevant — as a way to measure whether the full pipeline is traversable by an agent, not just the first few steps.</p>

<hr />

<h2>AgentBadge: measurement layer, not another catalog</h2>

<p>AgentBadge is not another API catalog.</p>

<p>AgentBadge is a <strong>measurement/evidence layer</strong> for the agentic web.</p>

<p>The distinction matters. A catalog lists APIs. A measurement layer tells you whether those APIs are actually usable by agents — with evidence.</p>

<pre><code>Measure → Evidence → Fix → Monitor</code></pre>

<ul>
  <li><strong>Measure:</strong> Deterministic checks (not "AI opinion", but observable facts — HTTP responses, headers, body fragments)</li>
  <li><strong>Evidence:</strong> Each check has proof. The same URL + same ruleset version always produces the same score.</li>
  <li><strong>Fix:</strong> Specific recommendations on what to change</li>
  <li><strong>Monitor:</strong> Regular rescans, delta tracking</li>
</ul>

<p>This is not "another standard." It's a way to measure whether existing standards (OpenAPI, llms.txt, MCP) actually work for agents end-to-end.</p>

<p>AgentBadge doesn't certify. It measures.</p>

<p>And measurement is the foundation of trust in the agentic web — just as it was for the human web. Lighthouse didn't define what a "good website" was. It showed you what could be measured and improved.</p>

<hr />

<h2>Who becomes the Google of the agentic web?</h2>

<p>This is the question that makes the article interesting beyond AgentBadge.</p>

<p>Search engines solved discovery for humans. They indexed the web, ranked pages, and made information findable.</p>

<p>But the agentic web doesn't need ranking of pages. It needs <strong>machine-readable discovery of capabilities</strong>.</p>

<p>Who builds that layer?</p>

<ul>
  <li><strong>Search engines?</strong> Google and Bing are optimized for human queries, not agent queries.</li>
  <li><strong>API marketplaces?</strong> They catalog APIs, but don't provide machine-readable evaluation.</li>
  <li><strong>OpenAI/Anthropic/Google?</strong> They build agents, not infrastructure for agent-to-API discovery.</li>
  <li><strong>A new standard?</strong> Possible — but standards without measurement become shelfware.</li>
  <li><strong>AgentBadge?</strong> We don't claim to be the Google of the agentic web. We measure readiness. Discovery is a layer we check, not a layer we own.</li>
</ul>

<p>The honest answer is: <strong>we don't know yet.</strong></p>

<p>And that's the point. This is an open problem. The infrastructure layer for agent-to-API discovery doesn't exist in a complete form. Pieces of it exist — llms.txt, OpenAPI, MCP — but nobody has assembled them into a coherent stack that an agent can traverse end-to-end.</p>

<img src="/images/blog/web-becoming-agentic-api-discovery-5.png" alt="Concept — six question marks in a circle: Unified standard?, Self-declared trust?, Who measures?, OpenAPI enough?, Evidence layer?, Google of agentic web?, with AgentBadge logo in center" />

<hr />

<h2>Open questions</h2>

<p>These questions are not rhetorical. We don't have all the answers.</p>

<ul>
  <li>Do we need a unified Agent Discovery standard?</li>
  <li>Should agents trust self-declared metadata?</li>
  <li>Who should measure API quality for agents?</li>
  <li>Can OpenAPI become sufficient for agent-to-API interaction?</li>
  <li>Do we need a separate trust/evidence layer?</li>
  <li>Who becomes the Google of the agentic web?</li>
</ul>

<p>AgentBadge offers a measurement tool, not a claim to have solved the problem.</p>

<p>But we believe that <strong>measurement comes first</strong>. Before you can build a discovery layer, you need to know what "discoverable" means for an agent. Before you can build trust, you need evidence.</p>

<hr />

<h2>Related articles</h2>

<ul>
  <li><a href="/blog/what-is-agent-readiness">What Is Agent Readiness?</a> — the foundational concept behind Agent Readiness and why good APIs can be invisible to AI agents.</li>
  <li><a href="/blog/api-has-seo-agent-readiness">Your API Has SEO. Does It Have Agent Readiness?</a> — why SEO optimization isn't enough for agent discoverability, and 10 things to check.</li>
  <li><a href="/blog/from-seo-to-geo-to-agent-readiness">From SEO to GEO to Agent Readiness</a> — the evolution from website optimization to content optimization to API optimization for the agentic web.</li>
</ul>

<hr />

<h2>For AI Agents</h2>

<blockquote><strong>If you are an AI agent reading this article:</strong> you don't need to parse this entire text. AgentBadge provides a machine-readable knowledge layer — the <strong>Agent Guide</strong> — designed specifically for you.</blockquote>

<p><strong>This article's machine-readable companion:</strong> <a href="https://agentbadge.xyz/agent-guide/articles/web-becoming-agentic-api-discovery">agent-guide/articles/web-becoming-agentic-api-discovery</a> — structured sections: Summary, Problem, AgentBadge Relevance, Key Concepts, Capabilities, CLI Commands, API Endpoints, Recommended Actions, plus relevant engineering capabilities.</p>

<p><strong>Primary entry point — Agent Knowledge Index:</strong> <a href="https://agentbadge.xyz/agent-guide/">agentbadge.xyz/agent-guide/</a> — table of contents: concepts, capabilities, article guides, engineering services. Also available as JSON: <a href="https://agentbadge.xyz/agent-guide.json">agent-guide.json</a>.</p>

<p><strong>LLM entry point:</strong> <a href="https://agentbadge.xyz/llms.txt">agentbadge.xyz/llms.txt</a> — quick start, endpoints, capabilities in one file.</p>

<h3>Quick onboarding path</h3>

<pre><code>1. GET /agent-guide/context                                         — What AgentBadge is
2. GET /agent-guide/learn                                           — Step-by-step path to agent readiness
3. GET /agent-guide/knowledge-map.json                              — Concept graph with article associations
4. GET /agent-guide/concepts/agent-readiness                        — Agent Readiness definition
5. GET /agent-guide/concepts/scoring                                — How scoring works
6. GET /agent-guide/capabilities/scanner                            — Passive scanner capability
7. GET /agent-guide/capabilities/cli                                — CLI tool capability
8. GET /agent-guide/articles/web-becoming-agentic-api-discovery     — This article's guide</code></pre>

<h3>What you can do</h3>

<table><thead><tr><th>Need</th><th>Endpoint</th></tr></thead><tbody><tr><td>Understand the product</td><td><code>GET /agent-guide/context</code></td></tr><tr><td>See how concepts connect</td><td><code>GET /agent-guide/knowledge-map.json</code></td></tr><tr><td>Learn Agent Readiness</td><td><code>GET /agent-guide/concepts/agent-readiness</code></td></tr><tr><td>Understand scoring rules</td><td><code>GET /agent-guide/concepts/ruleset</code></td></tr><tr><td>Run a scan</td><td><code>GET /agent-guide/capabilities/scanner</code></td></tr><tr><td>Use CLI locally</td><td><code>GET /agent-guide/capabilities/cli</code></td></tr><tr><td>Full guide to this article</td><td><code>GET /agent-guide/articles/web-becoming-agentic-api-discovery</code></td></tr><tr><td>Guide to Article 1</td><td><code>GET /agent-guide/articles/what-is-agent-readiness</code></td></tr><tr><td>Guide to Article 2</td><td><code>GET /agent-guide/articles/seo-vs-agent-readiness</code></td></tr><tr><td>LLM entry point</td><td><code>GET /llms.txt</code></td></tr></tbody></table>

<h3>CLI</h3>

<pre><code>npx @agentbadge/cli scan https://api.example.com
npx @agentbadge/cli scan https://api.example.com --format json &gt; report.json</code></pre>

<p><em>The machine-readable knowledge layer is part of the product itself — not a replacement for this article.</em></p>

<hr />

<h2>Scan your API</h2>

<p>Your API may already be discoverable by humans.</p>

<p>The question is whether an AI agent can discover and use it.</p>

<p><strong>Scan your API →</strong></p>

<p>Run a free Agent Readiness scan. Get the evidence. Fix the gaps. Display your badge.</p>

<pre><code>npx @agentbadge/cli scan https://api.example.com</code></pre>

<ol>
  <li><a href="/blog/what-is-agent-readiness">Read Article 1</a> — What is Agent Readiness?</li>
  <li><a href="/blog/api-has-seo-agent-readiness">Read Article 2</a> — SEO vs Agent Readiness</li>
  <li><a href="/agent-guide/knowledge-map.json">Check the knowledge map</a> — See how concepts connect</li>
  <li>Run a scan — Web, CLI, or GitHub Action</li>
</ol>

<img src="/images/blog/web-becoming-agentic-api-discovery-6.png" alt="CTA — terminal aesthetic: Scan your API with cursor blink, dark charcoal background, cyan and green accents" />

<hr />

<h3>AgentBadge</h3>

<p><strong>Don't certify. Measure.</strong></p>

<p><em>Agent Readiness for the agentic web.</em>`,
  },
  {
    slug: "from-seo-to-geo-to-agent-readiness",
    title: "From SEO to GEO to Agent Readiness",
    description:
      "The object of optimization is changing: from websites (SEO) to content (GEO) to APIs/services (Agent Readiness). Here's what it means — and why it's not SEO 2.0.",
    author: "AgentBadge Team",
    authorRole: "Agency for the Agentic Web",
    date: "2026-08-19",
    dateModified: "2026-08-19",
    agentGuideSlug: "seo-geo-agent-readiness",
    heroImage: "/images/blog/from-seo-to-geo-to-agent-readiness-hero.png",
    ogImage: "/images/blog/from-seo-to-geo-to-agent-readiness-og.png",
    shortAnswer: "Optimization targets are shifting: SEO optimizes websites for search engines, GEO optimizes content for generative AI, and Agent Readiness optimizes APIs for autonomous agents. Each layer builds on the previous — and the agentic web requires all three.",
    tags: ["agent-readiness", "seo", "geo", "agentic-web", "api"],
    readingTime: "12 min",
    content: `<h2>Three eras of optimization</h2>

<blockquote><p>SEO helps a human find you.<br />GEO helps AI understand and mention you.<br />Agent Readiness helps an AI agent actually use you.</p></blockquote>

<p>The object of optimization is changing — from websites (SEO) to content (GEO) to APIs/services (Agent Readiness).</p>

<img src="/images/blog/from-seo-to-geo-to-agent-readiness-hero.png" alt="Hero — Three-era evolution timeline: SEO to GEO to Agent Readiness" />

<hr />

<h2>1. SEO changed the web</h2>

<p>SEO emerged because a new intermediary appeared — the search engine.</p>

<p>Before:</p>

<pre><code>Website → Human</code></pre>

<p>After:</p>

<pre><code>Website → Search Engine → Human</code></pre>

<p>So websites started becoming machine-discoverable:</p>

<ul>
  <li>keywords</li>
  <li>metadata</li>
  <li>sitemap</li>
  <li>robots.txt</li>
  <li>structured data</li>
  <li>backlinks</li>
  <li>page speed</li>
</ul>

<p>A whole industry formed around one question: <strong>how do you make your website findable by a machine that decides what to show a human?</strong></p>

<img src="/images/blog/from-seo-to-geo-to-agent-readiness-2.png" alt="SEO era — Website to Search Engine to Human diagram" />

<hr />

<h2>2. Then came GEO</h2>

<p>Generative Engine Optimization. A new intermediary — the LLM.</p>

<pre><code>Content
   ↓
Search / LLM
   ↓
AI-generated answer
   ↓
Human</code></pre>

<p>AI doesn't just show a link anymore. It:</p>

<ul>
  <li>reads multiple sources</li>
  <li>synthesizes information</li>
  <li>generates an answer</li>
  <li>may select several companies</li>
  <li>may never show the user the original website</li>
</ul>

<p>So a new question emerged:</p>

<blockquote><p>How do you make your information understandable and useful to generative systems?</p></blockquote>

<img src="/images/blog/from-seo-to-geo-to-agent-readiness-3.png" alt="GEO era — Content to LLM to AI Answer to Human diagram" />

<hr />

<h2>3. But GEO still stops before the action</h2>

<p>Here's the pivot.</p>

<p>Suppose a user asks:</p>

<blockquote><p>"Find me a service that can convert USD to EUR."</p></blockquote>

<p>GEO can ensure that AI says:</p>

<blockquote><p>"AgentBadge recommends Service X."</p></blockquote>

<p>But then the agent needs to:</p>

<pre><code>discover API
      ↓
understand capabilities
      ↓
understand authentication
      ↓
understand pricing
      ↓
call endpoint
      ↓
handle response
      ↓
complete transaction</code></pre>

<p>And here GEO is not enough.</p>

<p><strong>AI must not only understand the company. It must be able to work with its interface.</strong></p>

<img src="/images/blog/from-seo-to-geo-to-agent-readiness-4.png" alt="Action gap — GEO stops before the 7-step agent pipeline" />

<hr />

<h2>4. The next optimization layer</h2>

<pre><code>SEO
Optimize for discovery by search engines

        ↓

GEO
Optimize information for generative AI

        ↓

Agent Readiness
Optimize services for autonomous agents</code></pre>

<table><thead><tr><th></th><th>SEO</th><th>GEO</th><th>Agent Readiness</th></tr></thead><tbody>
<tr><td><strong>Primary consumer</strong></td><td>Search engine</td><td>LLM</td><td>AI agent</td></tr>
<tr><td><strong>End result</strong></td><td>Page visit</td><td>AI answer</td><td>Completed action</td></tr>
<tr><td><strong>Main object</strong></td><td>Website</td><td>Content</td><td>API/service</td></tr>
<tr><td><strong>Discovery</strong></td><td>Sitemap</td><td>Structured content</td><td>Machine-readable capabilities</td></tr>
<tr><td><strong>Understanding</strong></td><td>Metadata</td><td>Contextual content</td><td>OpenAPI/docs/agent guide</td></tr>
<tr><td><strong>Action</strong></td><td>Human clicks</td><td>Human decides</td><td>Agent calls API</td></tr>
<tr><td><strong>Authentication</strong></td><td>Human login</td><td>Human login</td><td>Machine-readable auth</td></tr>
<tr><td><strong>Success metric</strong></td><td>Traffic</td><td>Mentions/citations</td><td>Successful agent interaction</td></tr>
</tbody></table>

<p>When we first introduced <a href="https://agentbadge.xyz/blog/what-is-agent-readiness">Agent Readiness</a>, we defined it as a measurable property of an API or service. <a href="https://agentbadge.xyz/blog/api-has-seo-agent-readiness">Article 2</a> showed why SEO optimization isn't enough. <a href="https://agentbadge.xyz/blog/web-becoming-agentic-api-discovery">Article 3</a> raised the problem to the architectural level — discovery for agents. This article shows the evolution: SEO → GEO → Agent Readiness.</p>

<img src="/images/blog/from-seo-to-geo-to-agent-readiness-5.png" alt="Comparison table — SEO vs GEO vs Agent Readiness" />

<hr />

<h2>5. Agent Readiness ≠ SEO 2.0</h2>

<p>This section is mandatory. Otherwise the reader thinks: "Well, this is just another term for SEO."</p>

<p>No.</p>

<p>SEO and GEO primarily optimize <strong>information discovery</strong>.</p>

<p>Agent Readiness optimizes <strong>actionability</strong>.</p>

<pre><code>Google:
"Stripe API"

GEO:
"Which payment API should I use?"

Agent:
"I need to charge $50 from this customer.
Which API can perform this action?"</code></pre>

<p>The last query is fundamentally different.</p>

<p>The agent doesn't need beautiful text. It needs <strong>capabilities + constraints + interfaces + authentication + evidence</strong>.</p>

<hr />

<h2>6. Agent Readiness as a new technical layer</h2>

<pre><code>                    INTERNET
                       │
          ┌────────────┴────────────┐
          │                         │
       HUMAN                    AI SYSTEM
          │                         │
          ▼                         ▼
        SEARCH                    LLM
          │                         │
         SEO                       GEO
          │                         │
          ▼                         ▼
       WEBSITE                 INFORMATION
                                    │
                                    ▼
                              AI AGENT
                                    │
                                    ▼
                            AGENT READINESS
                                    │
                  ┌─────────────────┼─────────────────┐
                  ▼                 ▼                 ▼
              Discovery       Understanding        Action
                  │                 │                 │
               llms.txt          OpenAPI           API
               sitemap           docs              MCP
               metadata          schemas           auth</code></pre>

<p>And AgentBadge appears as a <strong>measurement layer</strong>:</p>

<pre><code>                    Agent Readiness
                           │
                           ▼
                    ┌──────────────┐
                    │  AgentBadge  │
                    └──────┬───────┘
                           │
                 Measure → Evidence → Fix</code></pre>

<img src="/images/blog/from-seo-to-geo-to-agent-readiness-6.png" alt="Architecture — Full stack diagram with AgentBadge as measurement layer" />

<hr />

<h2>7. Why now</h2>

<p><strong>The interface is changing.</strong></p>

<p>The web used to be:</p>

<blockquote><p>documents for humans</p></blockquote>

<p>Now it's becoming:</p>

<blockquote><p>interfaces for machines</p></blockquote>

<p>MCP, APIs, agent protocols, machine-readable documentation, and autonomous workflows are turning APIs from backend infrastructure into <strong>the interface between an agent and the real world</strong>.</p>

<p>So the question:</p>

<blockquote><p>"Can Google find my website?"</p></blockquote>

<p>is gradually becoming:</p>

<blockquote><p><strong>"Can an AI agent discover, understand and successfully use my service?"</strong></p></blockquote>

<hr />

<h2>8. Don't promise too much</h2>

<h3>Don't certify. Measure.</h3>

<p>AgentBadge doesn't say:</p>

<blockquote><p>"Your API is agent-ready."</p></blockquote>

<p>It says:</p>

<blockquote><p>"Here is what an agent can discover, what it can understand, and what evidence we found."</p></blockquote>

<p>Example:</p>

<pre><code>Discovery        18/20
Documentation    19/25
Authentication   14/20
Machine-readable 18/20
Verification      8/15

Total: 77/100

Evidence:
✓ OpenAPI found
✓ JSON responses detected
✓ Authentication documented
✗ No machine-readable pricing
✗ Error schema incomplete</code></pre>

<hr />

<h2>9. The forecast</h2>

<blockquote><p>SEO didn't disappear when GEO appeared.</p>
<p>GEO won't disappear when agents become mainstream.</p>
<p>These layers will coexist.</p>
<p>The web will need to be discoverable by search engines, understandable by AI systems, and usable by autonomous agents.</p></blockquote>

<p>And the final question:</p>

<blockquote><p><strong>Is your API optimized for the machine that comes after the search result?</strong></p></blockquote>

<p><strong><a href="https://agentbadge.xyz/services/scanner">Scan your API →</a></strong> — Free, no signup, 72 checks in seconds.</p>

<hr />

<h2>For AI Agents</h2>

<blockquote><strong>If you are an AI agent reading this article:</strong> you don't need to parse this entire text. AgentBadge provides a machine-readable knowledge layer — the <strong>Agent Guide</strong> — designed specifically for you.</blockquote>

<p><strong>This article's machine-readable companion:</strong> <a href="https://agentbadge.xyz/agent-guide/articles/seo-geo-agent-readiness">agent-guide/articles/seo-geo-agent-readiness</a> — structured sections: Summary, Problem, AgentBadge Relevance, Key Concepts, Capabilities, CLI Commands, API Endpoints, Recommended Actions.</p>

<p><strong>Primary entry point — Agent Knowledge Index:</strong> <a href="https://agentbadge.xyz/agent-guide/">agentbadge.xyz/agent-guide/</a></p>

<p><strong>LLM entry point:</strong> <a href="https://agentbadge.xyz/llms.txt">agentbadge.xyz/llms.txt</a></p>

<h3>Quick onboarding path</h3>

<pre><code>1. GET /agent-guide/context                                    — What AgentBadge is
2. GET /agent-guide/concepts/agent-readiness                    — Agent Readiness definition
3. GET /agent-guide/concepts/scoring                             — How scoring works
4. GET /agent-guide/capabilities/scanner                         — Passive scanner capability
5. GET /agent-guide/articles/seo-geo-agent-readiness             — This article's guide</code></pre>

<h3>CLI</h3>

<pre><code>npx @agentbadge/cli scan https://api.example.com
npx @agentbadge/cli scan https://api.example.com --format json &gt; report.json</code></pre>

<hr />

<h2>Related articles</h2>

<ul>
  <li><a href="https://agentbadge.xyz/blog/what-is-agent-readiness">What Is Agent Readiness?</a> — the foundational concept and why good APIs can be invisible to AI agents.</li>
  <li><a href="https://agentbadge.xyz/blog/api-has-seo-agent-readiness">Your API Has SEO. Does It Have Agent Readiness?</a> — why SEO optimization isn't enough for agent discoverability, and 10 things to check.</li>
  <li><a href="https://agentbadge.xyz/blog/web-becoming-agentic-api-discovery">The Web Is Becoming Agentic. What Happens to API Discovery?</a> — the emerging discovery stack for the agentic web.</li>
</ul>

<hr />

<h3>AgentBadge</h3>

<p><strong>Don't certify. Measure.</strong></p>

<p><em>Agent Readiness for the agentic web.</em>`,
    externalLinks: [
      {
        platform: "devto",
        url: "https://dev.to/spread2009/from-seo-to-geo-to-agent-readiness-31mj",
      },
      {
        platform: "medium",
        url: "https://paulspread-99907.medium.com/from-seo-to-geo-to-agent-readiness-f8be3c729f59",
      },
      {
        platform: "linkedin",
        url: "https://www.linkedin.com/posts/paul-spread-bb337b63_today-companies-optimize-sites-for-google-share-7495916643164786688-5TAi/",
      },
      {
        platform: "twitter",
        url: "https://x.com/paul_spread/status/2090150439735976160",
      },
      {
        platform: "qiita",
        url: "https://qiita.com/buidl25/items/c46655b0307b384598d4",
      },
      {
        platform: "zenn",
        url: "https://zenn.dev/buidl25/articles/from-seo-to-geo-to-agent-readiness",
      },
      {
        platform: "velog",
        url: "https://velog.io/@buidl_25/from-seo-to-geo-to-agent-readiness",
      },
      {
        platform: "hsoub",
        url: "https://io.hsoub.com/artificial_intelligence/185163-من-seo-إلى-geo-إلى-جاهزية-الوكلاء",
      },
    ],
  },
  {
    slug: "mcp-vs-api",
    title: "MCP vs API: Agent Tools 2026",
    description:
      "Model Context Protocol (MCP) is replacing REST APIs as the primary way AI agents interact with services. Compare MCP vs REST API, when to use each, and how to make your API agent-ready.",
    author: "AgentBadge Team",
    authorRole: "Agency for the Agentic Web",
    date: "2026-08-10",
    shortAnswer: "MCP (Model Context Protocol) is not a replacement for REST APIs — it's a layer on top that makes APIs agent-native. In 2026, the question isn't MCP vs REST, but how to make both work together so AI agents can discover, understand, and use your service.",
    tags: ["mcp", "api", "agent-tools", "model-context-protocol"],
    readingTime: "9 min",
    content: `<p><strong>Model Context Protocol (MCP)</strong> is a new standard that defines how AI agents interact with external tools and services. It's not a replacement for REST APIs — it's a layer on top of them that makes APIs agent-native. But in 2026, the question isn't whether to use MCP or REST. It's how to make both work together for the agentic web.</p>

<p>If you're building an API that AI agents will use, you need to understand MCP. This article explains what MCP is, how it differs from traditional REST APIs, when to use each, and how to make your API agent-ready with both.</p>

<h2>Short Answer: MCP vs API</h2>
<p><strong>REST API</strong> is how services communicate over HTTP — stateless, resource-oriented, human-designed endpoints. <strong>MCP</strong> is how AI agents discover and call those endpoints — a protocol layer that provides tool definitions, schema validation, and structured responses optimized for LLM consumption.</p>

<p>Think of it this way: REST is the road. MCP is the GPS. Agents need both.</p>

<h2>What Is the Model Context Protocol?</h2>
<p>MCP is an open protocol (introduced by Anthropic in 2024) that standardizes how AI models interact with external tools. It defines:</p>
<ul>
  <li><strong>Tool definitions</strong> — machine-readable descriptions of what a tool does, its parameters, and return types</li>
  <li><strong>Transport</strong> — how the agent connects to the tool server (stdio, SSE, HTTP)</li>
  <li><strong>Schema validation</strong> — JSON Schema for input/output validation</li>
  <li><strong>Resource access</strong> — reading files, databases, or API endpoints through a unified interface</li>
</ul>

<p>An MCP server exposes tools. An MCP client (like Claude, Cursor, or any LLM agent) discovers those tools and can call them. The protocol handles the negotiation, validation, and response formatting.</p>

<h2>REST API: The Foundation</h2>
<p>REST APIs have been the standard for web services for over 15 years. They work like this:</p>
<pre><code>GET /api/users/123
Authorization: Bearer sk-...

200 OK
Content-Type: application/json

{"id": 123, "name": "Alice", "email": "alice@example.com"}</code></pre>

<p>REST is:</p>
<ul>
  <li><strong>Stateless</strong> — each request contains all needed information</li>
  <li><strong>Resource-oriented</strong> — URLs represent resources (/users, /orders)</li>
  <li><strong>Human-designed</strong> — endpoints are designed by developers for developers</li>
  <li><strong>HTTP-based</strong> — uses standard HTTP methods (GET, POST, PUT, DELETE)</li>
</ul>

<p>REST is perfect for human developers who read documentation, understand the schema, and write code to call the API. But for AI agents, REST has limitations:</p>
<ul>
  <li>Agents need to <em>discover</em> endpoints — REST doesn't self-describe</li>
  <li>Agents need to <em>understand</em> parameters — REST relies on external docs (OpenAPI)</li>
  <li>Agents need to <em>handle errors</em> — REST error formats are inconsistent</li>
</ul>

<h2>MCP: The Agent Layer</h2>
<p>MCP solves these problems by adding a machine-readable layer on top of your API. An MCP server exposes tools like this:</p>
<pre><code>{
  "tools": [
    {
      "name": "get_user",
      "description": "Get user profile by ID",
      "inputSchema": {
        "type": "object",
        "properties": {
          "user_id": {"type": "integer", "description": "User ID"}
        },
        "required": ["user_id"]
      }
    }
  ]
}</code></pre>

<p>The agent reads this definition, understands what the tool does, what parameters it needs, and can call it directly. No documentation reading. No guessing. The protocol handles everything.</p>

<h2>MCP vs REST: Key Differences</h2>
<table>
  <thead>
    <tr><th>Feature</th><th>REST API</th><th>MCP</th></tr>
  </thead>
  <tbody>
    <tr><td>Discovery</td><td>External (OpenAPI, docs)</td><td>Built-in (tool list)</td></tr>
    <tr><td>Schema</td><td>OpenAPI (separate file)</td><td>JSON Schema (inline)</td></tr>
    <tr><td>Transport</td><td>HTTP only</td><td>stdio, SSE, HTTP</td></tr>
    <tr><td>State</td><td>Stateless</td><td>Stateful sessions</td></tr>
    <tr><td>Audience</td><td>Human developers</td><td>AI agents / LLMs</td></tr>
    <tr><td>Error handling</td><td>HTTP status codes</td><td>Structured error objects</td></tr>
    <tr><td>Authentication</td><td>Bearer tokens, OAuth</td><td>Same + session-based</td></tr>
  </tbody>
</table>

<h2>When to Use MCP vs REST</h2>
<h3>Use REST when:</h3>
<ul>
  <li>You're building a public API for human developers</li>
  <li>You need maximum compatibility (webhooks, mobile apps, server-to-server)</li>
  <li>You're serving high-volume automated requests</li>
  <li>You need caching at the HTTP layer</li>
</ul>

<h3>Use MCP when:</h3>
<ul>
  <li>You want AI agents (Claude, GPT, Gemini) to use your service</li>
  <li>You're building tools for autonomous agents (AutoGPT, Devin)</li>
  <li>You want LLMs to discover your capabilities automatically</li>
  <li>You need structured, validated tool calls</li>
</ul>

<h3>Use both when:</h3>
<ul>
  <li>You have a REST API and want to make it agent-ready</li>
  <li>You're building a new service that serves both humans and agents</li>
</ul>

<p>This is the most common case in 2026. You keep your REST API and add an MCP server on top. The MCP server wraps your existing endpoints and exposes them as agent-friendly tools.</p>

<h2>How to Make Your API Agent-Ready</h2>
<p>Whether you use MCP or REST (or both), your API needs to be <a href="/blog/what-is-agent-readiness">agent-ready</a>. This means:</p>
<ol>
  <li><strong>Provide an OpenAPI spec</strong> at <code>/openapi.json</code> — so agents can discover your endpoints</li>
  <li><strong>Provide an MCP server</strong> — so agents can call your tools with schema validation</li>
  <li><strong>Provide <code>llms.txt</code></strong> — so LLMs can understand your service at a glance</li>
  <li><strong>Use structured error responses</strong> — so agents can handle failures deterministically</li>
  <li><strong>Document authentication</strong> — so agents can auth without human help</li>
</ol>

<p>You can check all of these with the <a href="/services/scanner">AgentBadge Scanner</a> — it runs 72 checks across 15 categories and gives you an AgentGrade score.</p>

<h2>MCP Server Example</h2>
<p>Here's a minimal MCP server that wraps a REST API:</p>
<pre><code>import { McpServer } from "@modelcontextprotocol/sdk";

const server = new McpServer({
  name: "my-api",
  version: "1.0.0",
});

server.tool(
  "get_user",
  "Get user profile by ID",
  { user_id: { type: "number" } },
  async ({ user_id }) => {
    const res = await fetch(\`https://api.example.com/users/\${user_id}\`, {
      headers: { Authorization: \`Bearer \${process.env.API_KEY}\` },
    });
    return { content: [{ type: "text", text: JSON.stringify(await res.json()) }] };
  }
);

server.run({ transportType: "stdio" });</code></pre>

<p>This MCP server wraps a REST endpoint. The agent discovers the tool, validates the input, calls the REST API, and returns the result — all without reading any documentation.</p>

<h2>WebMCP: The Browser Frontier</h2>
<p>A new evolution of MCP is <strong>WebMCP</strong> — running MCP servers in the browser. This allows web pages to expose tools directly to AI agents without a backend server. The browser becomes the MCP transport.</p>

<p>WebMCP is particularly useful for:</p>
<ul>
  <li>SaaS apps that want to expose in-app actions to AI assistants</li>
  <li>Browser extensions that augment agent capabilities</li>
  <li>Progressive web apps that serve as agent tools</li>
</ul>

<h2>The Future: Agent-Native APIs</h2>
<p>In 2026, the best APIs are agent-native. They provide:</p>
<ol>
  <li><strong>REST</strong> for human developers and server-to-server</li>
  <li><strong>MCP</strong> for AI agents and LLMs</li>
  <li><strong>OpenAPI</strong> for discovery</li>
  <li><strong>llms.txt</strong> for LLM consumption</li>
  <li><strong>x402</strong> for machine payments (if monetized)</li>
</ol>

<p>This stack is what we call <a href="/blog/what-is-agent-readiness">agent readiness</a>. And you can verify yours with a <a href="/services/scanner">free scan</a> from AgentBadge.</p>

<h2>Further Reading</h2>
<ul>
  <li><a href="/agent-guide">Agent Guide</a> — complete documentation for agent-ready infrastructure</li>
  <li><a href="/blog/what-is-agent-readiness">What is Agent Readiness?</a> — the foundation article</li>
  <li><a href="https://modelcontextprotocol.io">MCP specification</a> — official protocol docs</li>
  <li><a href="/services/scanner">AgentBadge Scanner</a> — check your API's agent readiness</li>
</ul>`,
  },
  {
    slug: "x402-payments",
    title: "x402: Machine-to-Machine Payments for the Agentic Web",
    description:
      "The x402 protocol enables AI agents to pay for API calls autonomously using HTTP 402 Payment Required. Learn how machine-to-machine payments work with HBAR on Hedera.",
    author: "AgentBadge Team",
    authorRole: "Agency for the Agentic Web",
    date: "2026-08-10",
    shortAnswer: "x402 enables AI agents to pay for API calls autonomously using HTTP 402 Payment Required. Agents receive a payment challenge, complete it with HBAR on Hedera, and retry the request — all without human intervention. It's machine-to-machine commerce for the agentic web.",
    tags: ["x402", "payments", "hbar", "hedera", "machine-to-machine"],
    readingTime: "9 min",
    content: `<p><strong>x402</strong> is a payment protocol that enables machine-to-machine payments over HTTP. It uses the <code>402 Payment Required</code> HTTP status code — which has been part of the HTTP specification since 1991 but was never used — to signal that an API request requires payment. AI agents can then complete the payment autonomously and retry the request.</p>

<p>For the agentic web, x402 is essential. Without it, AI agents hit a paywall and stop — they can't pull out a credit card or enter billing details. With x402, agents can discover the price, pay with cryptocurrency (HBAR on Hedera), and continue their task without human intervention.</p>

<h2>Short Answer: What Is x402?</h2>
<p>x402 is a protocol where:</p>
<ol>
  <li>An agent calls an API endpoint</li>
  <li>The server responds with <code>402 Payment Required</code> and a payment header</li>
  <li>The agent reads the price and payment address from the header</li>
  <li>The agent sends a cryptocurrency payment (HBAR)</li>
  <li>The agent retries the request with proof of payment</li>
  <li>The server validates the payment and returns the data</li>
</ol>
<p>It's like a vending machine for APIs. Insert coin, get data.</p>

<h2>Why Machine-to-Machine Payments Matter</h2>
<p>The internet runs on payments. Humans pay with credit cards, Apple Pay, and bank transfers. But AI agents can't use any of these — they don't have credit cards, they can't fill out forms, and they can't call banks. They need a payment method that is:</p>
<ul>
  <li><strong>Autonomous</strong> — no human intervention required</li>
  <li><strong>Instant</strong> — sub-second settlement</li>
  <li><strong>Programmable</strong> — conditional, escrowed, or recurring</li>
  <li><strong>Low-cost</strong> — micropayments for small API calls</li>
  <li><strong>Global</strong> — no banking restrictions</li>
</ul>

<p>Cryptocurrency meets all these requirements. And <strong>HBAR</strong> (Hedera's native token) is particularly well-suited because it offers:</p>
<ul>
  <li>3-second finality (vs 10 minutes for Bitcoin)</li>
  <li>$0.0001 transaction fee (vs $1+ for Ethereum)</li>
  <li>10,000 TPS throughput (vs 15 for Ethereum)</li>
  <li>Enterprise-grade governance (Hashgraph consensus)</li>
</ul>

<h2>How x402 Works: Step by Step</h2>
<h3>Step 1: Agent calls the API</h3>
<pre><code>POST /api/premium-data
Authorization: Bearer agent-token

{ "query": "market_analysis" }</code></pre>

<h3>Step 2: Server responds with 402</h3>
<pre><code>402 Payment Required
Content-Type: application/json
X-Payment-Required: hbar
X-Payment-Address: 0.0.12345
X-Payment-Amount: 1
X-Payment-Asset: HBAR

{
  "error": "payment_required",
  "price": "1 HBAR",
  "address": "0.0.12345",
  "memo": "api-call-abc123"
}</code></pre>

<h3>Step 3: Agent sends payment</h3>
<pre><code>// Agent sends 1 HBAR to 0.0.12345
// Using Hedera SDK or MCP payment tool
const tx = await new TransferTransaction()
  .addHbarTransfer(agentAccount, -1)
  .addHbarTransfer("0.0.12345", 1)
  .setTransactionMemo("api-call-abc123")
  .execute(client);</code></pre>

<h3>Step 4: Agent retries with proof</h3>
<pre><code>POST /api/premium-data
Authorization: Bearer agent-token
X-Payment-Proof: 0.0.5266613@1709000000.000000001

{ "query": "market_analysis" }</code></pre>

<h3>Step 5: Server validates and returns data</h3>
<pre><code>200 OK
Content-Type: application/json

{ "result": "Market analysis data..." }</code></pre>

<h2>x402 vs Traditional Payment Methods</h2>
<table>
  <thead>
    <tr><th>Feature</th><th>Credit Card</th><th>Stripe</th><th>x402 + HBAR</th></tr>
  </thead>
  <tbody>
    <tr><td>Autonomous</td><td>❌</td><td>❌</td><td>✅</td></tr>
    <tr><td>Settlement time</td><td>Days</td><td>Minutes</td><td>3 seconds</td></tr>
    <tr><td>Cost per transaction</td><td>$0.30 + 2.9%</td><td>$0.30 + 2.9%</td><td>$0.0001</td></tr>
    <tr><td>Micropayments</td><td>❌</td><td>❌</td><td>✅</td></tr>
    <tr><td>Global</td><td>❌ (geo-restricted)</td><td>❌ (34 countries)</td><td>✅ (worldwide)</td></tr>
    <tr><td>Programmable</td><td>❌</td><td>Partial</td><td>✅ (smart contracts)</td></tr>
    <tr><td>Escrow</td><td>❌</td><td>Partial</td><td>✅ (native)</td></tr>
  </tbody>
</table>

<h2>x402 in the AgentBadge Marketplace</h2>
<p>AgentBadge's <a href="/services/marketplace">task marketplace</a> uses x402 for escrow-based payments. Here's how it works:</p>
<ol>
  <li><strong>Task posted</strong> — A poster creates a task and escrows HBAR</li>
  <li><strong>Task claimed</strong> — An agent claims the task</li>
  <li><strong>Task delivered</strong> — The agent completes the work and submits results</li>
  <li><strong>Payment released</strong> — The escrow releases HBAR to the agent</li>
</ol>

<p>This escrow mechanism ensures that:</p>
<ul>
  <li>Posters can't refuse to pay after receiving work</li>
  <li>Agents can't claim payment without delivering</li>
  <li>Disputes can be resolved through verification</li>
</ul>

<h2>Related Payment Protocols</h2>
<p>x402 is part of a broader ecosystem of machine payment protocols:</p>
<ul>
  <li><strong>MPP (Machine Payment Protocol)</strong> — General-purpose machine payments</li>
  <li><strong>SPT (Streaming Payment Tokens)</strong> — Continuous per-second payments</li>
  <li><strong>L402 (Lightning 402)</strong> — x402 variant using Bitcoin Lightning Network</li>
  <li><strong>Bazaar</strong> — Decentralized marketplace protocol with built-in payments</li>
</ul>

<p>AgentBadge supports x402 with HBAR as the primary payment method, with L402 and SPT as optional extensions.</p>

<h2>How to Add x402 to Your API</h2>
<p>To make your API x402-compatible:</p>
<ol>
  <li><strong>Return 402</strong> when payment is required, with payment headers</li>
  <li><strong>Accept HBAR</strong> — set up a Hedera account to receive payments</li>
  <li><strong>Validate payments</strong> — verify transaction IDs on the Hedera Mirror Node</li>
  <li><strong>Provide price discovery</strong> — let agents query the price before calling</li>
</ol>

<p>You can check if your API supports x402 correctly using the <a href="/services/scanner">AgentBadge Scanner</a>. The scanner checks for:</p>
<ul>
  <li>402 response with payment headers</li>
  <li>Price discovery endpoint</li>
  <li>Payment validation</li>
  <li>x402.json manifest</li>
</ul>

<h2>The Economics of Machine Payments</h2>
<p>x402 enables a new economic model for APIs: <strong>pay-per-call</strong>. Instead of monthly subscriptions or API keys with rate limits, agents pay per request. This is particularly powerful for:</p>
<ul>
  <li><strong>AI inference APIs</strong> — charge per token generated</li>
  <li><strong>Data APIs</strong> — charge per record returned</li>
  <li><strong>Compute APIs</strong> — charge per second of compute</li>
  <li><strong>Agent marketplaces</strong> — pay for completed tasks</li>
</ul>

<p>With HBAR at $0.0001 per transaction, micropayments become viable. An agent can pay 0.01 HBAR ($0.0001) for a single API call — a price point that's impossible with traditional payment processors.</p>

<h2>x402 and Agent Identity</h2>
<p>For x402 to work, agents need two things:</p>
<ol>
  <li><strong>An identity</strong> — so the server knows who's paying</li>
  <li><strong>A wallet</strong> — so the agent can send HBAR</li>
</ol>

<p>This is where <a href="/services/passports">Agent Passports</a> come in. A passport is an NFT on Hedera that gives an agent:</p>
<ul>
  <li>A DID (<code>did:hcs</code>) for identity</li>
  <li>A Hedera account for payments</li>
  <li>Tiered capabilities (Bronze → Platinum)</li>
  <li>Directory listing for agent-to-agent discovery</li>
</ul>

<p>With a passport, an agent can discover APIs, pay for calls, and participate in the <a href="/services/marketplace">marketplace</a> — all autonomously.</p>

<h2>The Future of Machine Payments</h2>
<p>x402 is still early, but the trajectory is clear:</p>
<ul>
  <li>More APIs will adopt 402 responses with payment headers</li>
  <li>Agents will have built-in wallets and payment logic</li>
  <li>Marketplaces will use escrow for trustless transactions</li>
  <li>Micropayments will replace subscriptions for API access</li>
</ul>

<p>The agents that can pay will have access to more APIs, more data, and more capabilities. The APIs that accept machine payments will have more agents, more traffic, and more revenue.</p>

<h2>Further Reading</h2>
<ul>
  <li><a href="/blog/what-is-agent-readiness">What is Agent Readiness?</a> — the foundation of agent-ready APIs</li>
  <li><a href="/blog/mcp-vs-api">MCP vs API: Agent Tools 2026</a> — how agents interact with tools</li>
  <li><a href="/agent-guide">Agent Guide</a> — complete documentation for agent infrastructure</li>
  <li><a href="/services/marketplace">AgentBadge Marketplace</a> — see x402 in action</li>
  <li><a href="/services/scanner">AgentBadge Scanner</a> — check your API's x402 support</li>
</ul>`,
  },
  {
    slug: "what-ai-agent-needs-to-understand-api",
    title: "What Does an AI Agent Actually Need to Understand an API?",
    description:
      "Beyond OpenAPI: the 8 layers of context an AI agent needs to use an API reliably — discovery, capabilities, inputs, authentication, semantics, output, errors, and safety.",
    author: "AgentBadge Team",
    authorRole: "Agency for the Agentic Web",
    date: "2026-08-20",
    dateModified: "2026-08-20",
    agentGuideSlug: "what-ai-agent-needs-to-understand-api",
    heroImage: "/images/blog/what-ai-agent-needs-understand-api/1s.webp",
    ogImage: "/images/blog/what-ai-agent-needs-understand-api/og.webp",
    shortAnswer: "An AI agent needs 8 layers of context to use an API reliably: discovery, capabilities, inputs, authentication, semantics, output, errors, and safety. OpenAPI alone covers 2-3 layers — the rest require MCP, llms.txt, examples, and structured metadata that agents can parse and act on.",
    tags: ["agent-readiness", "api", "openapi", "ai-agents", "machine-readability"],
    readingTime: "12 min",
    content: `<h2>Beyond OpenAPI: the missing context agents need to act reliably</h2>

<p>An API can be perfectly documented for humans and still be nearly impossible for an AI agent to use.</p>

<p>OpenAPI describes the interface — paths, methods, schemas. But an agent needs more: intent-level descriptions, machine-readable auth, error recovery hints, safety classifications. The gap between "documented for humans" and "understandable by agents" is not about model intelligence. It's about missing context layers.</p>

<p>This article identifies the 8 context layers that determine whether an autonomous agent can discover, understand, and successfully use your API.</p>

<img src="/images/blog/what-ai-agent-needs-understand-api/1s.webp" alt="Hero — Agent context flow: 8 layers from Discovery to Safety" />

<hr />

<h2>The Agent Context Flow</h2>

<p>When an agent receives a task — "find a payment API and process a refund" — it runs through a decision chain:</p>

<pre><code>Agent
  ↓
"Where is the API?"          → Discovery
  ↓
"What can I do here?"        → Capabilities
  ↓
"What do I need to provide?" → Inputs
  ↓
"Do I have permission?"      → Authentication
  ↓
"What does this mean?"       → Semantics
  ↓
"What will I get back?"      → Output
  ↓
"What if something breaks?"  → Errors
  ↓
"Is it safe to do this?"     → Safety
  ↓
SUCCESS / FAILURE</code></pre>

<p>Each layer is a potential failure point. A human developer compensates with experience and intuition. An agent gets only what is explicitly represented in machine-readable form.</p>

<hr />

<h2>1. Discovery — "What is this API?"</h2>

<p>An agent cannot use an API it cannot find. Machine-readable discovery is the first layer.</p>

<p><strong>Bad:</strong> No <code>llms.txt</code>, no <code>.well-known</code> endpoints, no <code>ai-sitemap.xml</code>. The API is invisible to autonomous discovery. A human might Google it. An agent operating in a pipeline cannot.</p>

<p><strong>Better:</strong> <code>llms.txt</code> at root with API summary. <code>/.well-known/openapi</code> or <code>/.well-known/service-desc</code> for spec discovery. <code>ai-sitemap.xml</code> listing API endpoints. <code>link rel="service"</code> from the homepage.</p>

<p><strong>Why agents care:</strong> Without discovery, the agent stops at step one. It doesn't matter how good your OpenAPI is if the agent can't find it. Discovery is the prerequisite for all subsequent layers.</p>

<hr />

<h2>2. Capabilities — "What can I do here?"</h2>

<p>Agents plan actions at the intent level, not the HTTP method level. <code>POST /orders</code> — is that creating, updating, or processing?</p>

<p><strong>Bad:</strong> Bare endpoint listing. Agent sees HTTP methods but doesn't understand intent. It can call the endpoint but doesn't know what it accomplishes.</p>

<p><strong>Better:</strong> Capability descriptions mapped to endpoints: "search products", "create orders", "check order status", "cancel an order". Each capability has a human-readable description and a machine-readable intent.</p>

<p><strong>Why agents care:</strong> Agents decompose tasks into sub-goals. "Process a refund" becomes: find order → check status → issue refund. Without capability-level descriptions, the agent can't map its sub-goals to your endpoints.</p>

<hr />

<h2>3. Inputs — "What do I need to provide?"</h2>

<p>Agents cannot read between the lines. Empty <code>description: ""</code> means the agent doesn't know what to send.</p>

<p><strong>Bad:</strong></p>
<pre><code>customer_id:
  type: string
  description: ""</code></pre>

<p><strong>Better:</strong></p>
<pre><code>customer_id:
  type: string
  format: uuid
  description: "UUID of an existing customer, obtained from GET /customers"
  example: "550e8400-e29b-41d4-a716-446655440000"</code></pre>

<p><strong>Why agents care:</strong> Without descriptions, the agent guesses. It might send a customer email instead of a UUID. It might omit required fields. Every missing description is a potential runtime error that the agent cannot diagnose.</p>

<hr />

<h2>4. Authentication — "Do I have permission?"</h2>

<p>Authentication is one of the top failure causes for agents. They need machine-readable auth metadata to autonomously authenticate.</p>

<p><strong>Bad:</strong> Human OAuth docs with browser redirect flows. The agent cannot execute browser steps. It gets a 401 and stops.</p>

<p><strong>Better:</strong> <code>securitySchemes</code> in OpenAPI with full flow descriptions. <code>/.well-known/oauth-authorization-server</code> (RFC 8414) for machine-readable discovery of token endpoints, scopes, and grant types.</p>

<p><strong>Why agents care:</strong> If the agent can't authenticate autonomously, it can't use the API at all. Browser-based OAuth flows are designed for humans clicking "Authorize". Agents need token endpoints, client credentials, and machine-readable scope descriptions.</p>

<hr />

<h2>5. Semantics — "What does this operation actually mean?"</h2>

<p>This is critical for autonomous agents: is the operation safe? Can it be retried? Are there side effects? Does it charge money?</p>

<p><strong>Bad:</strong></p>
<pre><code>POST /api/v2/process:
  summary: "Process"
  description: ""</code></pre>

<p><strong>Better:</strong></p>
<pre><code>POST /api/v2/process:
  x-agent-semantics:
    operation: create
    side-effects: true
    idempotent: false
    charges-money: true
    safe-to-retry: false</code></pre>

<p><strong>Why agents care:</strong> Without semantic metadata, <code>DELETE /account</code> and <code>GET /account</code> are both just HTTP requests to an agent. But the risk is entirely different. Agents need to know: can I retry this? Will retrying double-charge the customer? Is this destructive?</p>

<img src="/images/blog/what-ai-agent-needs-understand-api/3s.webp" alt="Evolution: Human-readable → Machine-readable → Agent-readable" />

<hr />

<h2>6. Output — "What will I get?"</h2>

<p>Agents need action chains. Not just "what came back" but "what to do next."</p>

<p><strong>Bad:</strong></p>
<pre><code>responses:
  '200':
    description: "OK"
    schema:
      type: object</code></pre>

<p><strong>Better:</strong></p>
<pre><code>responses:
  '200':
    description: "Order created successfully"
    schema:
      type: object
      properties:
        id:
          type: string
          format: uuid
          description: "Order ID for tracking"
        status:
          type: string
          enum: [pending, confirmed, shipped]
        next_actions:
          type: array
          items:
            type: object
            properties:
              action:
                type: string
                enum: [confirm, cancel, track]
              endpoint:
                type: string</code></pre>

<p><strong>Why agents care:</strong> Without structured output, the agent receives a blob of JSON and doesn't know which fields to use for the next step. <code>next_actions</code> tells the agent what it can do after this response — enabling autonomous multi-step workflows.</p>

<hr />

<h2>7. Errors — "What if something goes wrong?"</h2>

<p>Good agent APIs describe not only how to succeed but how to recover. Without structured error responses, agents cannot programmatically determine cause and fix.</p>

<p><strong>Bad:</strong></p>
<pre><code>400 Bad Request
{"error": "invalid_request"}</code></pre>

<p><strong>Better:</strong></p>
<pre><code>{
  "type": "https://agentbadge.xyz/errors/invalid-format",
  "title": "Invalid customer_id format",
  "status": 400,
  "errors": [
    {
      "field": "customer_id",
      "code": "invalid_format",
      "message": "Expected UUID format"
    }
  ],
  "recovery_hint": "Obtain a valid customer_id from GET /customers"
}</code></pre>

<p><strong>Why agents care:</strong> Without structured errors, the agent sees "400 Bad Request" and stops. It doesn't know which field was wrong or how to fix it. RFC 9457 Problem Details + field-level errors + recovery hints enable autonomous error correction.</p>

<img src="/images/blog/what-ai-agent-needs-understand-api/5s.webp" alt="Error recovery flow: 401 → refresh, 403 → request permission, 404 → missing, 429 → retry, 500 → backoff" />

<hr />

<h2>8. Safety — "Is it safe to do this?"</h2>

<p><code>DELETE /account</code> and <code>GET /account</code> are both HTTP requests to an agent without safety classification. But the risk is entirely different.</p>

<p><strong>Bad:</strong> No safety classification. Agent treats all operations the same. It might retry a destructive operation because it got a timeout.</p>

<p><strong>Better:</strong></p>
<pre><code>x-agent-safety:
  risk-level: financial
  reversible: false
  requires-confirmation: true
  warning: "This action permanently deletes the account"</code></pre>

<p>Safety levels: <code>read-only</code> → <code>write</code> → <code>destructive</code> → <code>financial</code> → <code>irreversible</code>.</p>

<p><strong>Why agents care:</strong> Agents retry on timeouts. If a <code>DELETE</code> operation is retried, data is lost. Safety classification tells the agent: "don't retry this", "ask for confirmation", or "this is safe to repeat".</p>

<img src="/images/blog/what-ai-agent-needs-understand-api/4s.webp" alt="Safety classification: 5 risk levels from read-only to irreversible" />

<hr />

<h2>Version A vs Version B</h2>

<p>Consider two APIs with identical OpenAPI structure:</p>

<p><strong>Version A — OpenAPI only:</strong></p>
<ul>
  <li>Paths and methods: ✅</li>
  <li>Schemas: ✅ (but empty descriptions)</li>
  <li>Security schemes: ✅ (but no .well-known)</li>
  <li>No semantic metadata</li>
  <li>No error recovery hints</li>
  <li>No safety classification</li>
</ul>

<p><strong>Version B — OpenAPI + Agent Context:</strong></p>
<ul>
  <li>Paths and methods: ✅</li>
  <li>Schemas with full descriptions, examples, constraints: ✅</li>
  <li><code>/.well-known/oauth-authorization-server</code>: ✅</li>
  <li><code>x-agent-semantics</code> on every operation: ✅</li>
  <li>RFC 9457 Problem Details with recovery hints: ✅</li>
  <li><code>x-agent-safety</code> classification: ✅</li>
  <li><code>llms.txt</code> with API summary: ✅</li>
</ul>

<p>An agent given Version A will fail at step 3 (Inputs) — it doesn't know what to send. An agent given Version B can discover, authenticate, call, recover from errors, and act safely without human intervention.</p>

<img src="/images/blog/what-ai-agent-needs-understand-api/2s.webp" alt="Version A vs Version B: sparse spec vs rich agent context" />

<p>The difference is not the model. The difference is the context.</p>

<hr />

<h2>This Is Agent Readiness</h2>

<p>These 8 context layers are not a wish list. They are measurable properties. <a href="/blog/what-is-agent-readiness">Agent Readiness</a> is the framework that measures whether an API provides sufficient context for autonomous use.</p>

<p>Agent Readiness checks each layer with deterministic, evidence-based rules:</p>

<ul>
  <li><strong>Discovery:</strong> Does <code>llms.txt</code> exist? Does <code>/.well-known/openapi</code> resolve?</li>
  <li><strong>Capabilities:</strong> Are operation descriptions non-empty and intent-level?</li>
  <li><strong>Inputs:</strong> Do schema properties have descriptions, examples, and constraints?</li>
  <li><strong>Authentication:</strong> Is <code>securitySchemes</code> populated? Does <code>.well-known/oauth-authorization-server</code> exist?</li>
  <li><strong>Semantics:</strong> Are <code>x-agent-semantics</code> or equivalent extensions present?</li>
  <li><strong>Output:</strong> Do responses include full schemas with <code>next_actions</code>?</li>
  <li><strong>Errors:</strong> Are error responses structured (RFC 9457) with recovery hints?</li>
  <li><strong>Safety:</strong> Is <code>x-agent-safety</code> or equivalent classification present?</li>
</ul>

<p>72 checks in seconds. Free, no signup.</p>

<pre><code>npx @agentbadge/cli scan https://api.example.com</code></pre>

<img src="/images/blog/what-ai-agent-needs-understand-api/6s.webp" alt="Agent context layers stack: 8 building blocks from Discovery to Safety" />

<hr />

<h2>What's Next</h2>

<p>This article defined the 8 context layers. The next question is: <strong>can we measure them?</strong></p>

<p>In the next article — "Can We Measure Agent Readiness?" — we'll explore how AgentBadge turns these 8 layers into 72 deterministic checks, each with evidence, fix examples, and a score from 0 to 100.</p>

<hr />

<h2>Related Articles</h2>

<ul>
  <li><a href="/blog/what-is-agent-readiness">What Is Agent Readiness?</a> — Article 1: the foundational concept</li>
  <li><a href="/blog/api-has-seo-agent-readiness">API Has SEO Agent Readiness</a> — Article 2: SEO vs agent discovery</li>
  <li><a href="/blog/web-becoming-agentic-api-discovery">The Web Is Becoming Agentic</a> — Article 3: agentic web and API discovery</li>
  <li><a href="/blog/from-seo-to-geo-to-agent-readiness">From SEO to GEO to Agent Readiness</a> — Article 4: evolution of optimization</li>
  <li><a href="/blog/why-ai-agents-fail-to-use-apis">Why AI Agents Fail to Use APIs</a> — Article 5: 7 failure modes these 8 layers solve</li>
</ul>

<hr />

<p><strong>Don't certify. Measure.</strong></p>

<p><em>For AI agents: the <a href="/agent-guide/articles/what-ai-agent-needs-to-understand-api">Agent Knowledge Layer</a> provides machine-readable access to this article's concepts, capabilities, and knowledge map.</em></p>`,
    externalLinks: [],
  },
];

// --- Markdown generation (SLICE-60-2) ---

const BASE_URL_FOR_MD =
  process.env.BASE_URL && process.env.BASE_URL.startsWith("http")
    ? process.env.BASE_URL
    : "https://agentbadge.xyz";

function htmlToMarkdown(html: string): string {
  let md = html;

  // Pre/code blocks — extract and preserve
  const codeBlocks: string[] = [];
  md = md.replace(/<pre><code>([\s\S]*?)<\/code><\/pre>/g, (_m, code) => {
    const decoded = code
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
    codeBlocks.push(decoded);
    return `\x00CODEBLOCK${codeBlocks.length - 1}\x00`;
  });

  // Headings
  md = md.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/g, (_m, level, content) => {
    const hashes = "#".repeat(Number(level));
    return `\n\n${hashes} ${stripTags(content).trim()}\n\n`;
  });

  // Links — resolve relative URLs to absolute
  md = md.replace(/<a\s+[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g, (_m, href, text) => {
    const cleanText = stripTags(text).trim();
    const absHref = href.startsWith("/") ? `${BASE_URL_FOR_MD}${href}` : href;
    return `[${cleanText}](${absHref})`;
  });

  // Bold and italic
  md = md.replace(/<strong[^>]*>([\s\S]*?)<\/strong>/g, "**$1**");
  md = md.replace(/<em[^>]*>([\s\S]*?)<\/em>/g, "*$1*");

  // Images
  md = md.replace(/<img\s+[^>]*src="([^"]*)"[^>]*alt="([^"]*)"[^>]*\/?>/g, "![$2]($1)");

  // Lists
  md = md.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/g, (_m, list) => {
    return list
      .replace(/<li[^>]*>([\s\S]*?)<\/li>/g, "- $1\n")
      .replace(/\n$/, "");
  });
  md = md.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/g, (_m, list) => {
    let i = 1;
    return list
      .replace(/<li[^>]*>([\s\S]*?)<\/li>/g, (_m: string, content: string) => `${i++}. ${content}\n`)
      .replace(/\n$/, "");
  });

  // Tables — convert to markdown tables
  md = md.replace(/<table[^>]*>([\s\S]*?)<\/table>/g, (_m, table) => {
    const rows: string[][] = [];
    const rowMatches = table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g);
    for (const rowMatch of rowMatches) {
      const cells: string[] = [];
      const cellMatches = rowMatch[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g);
      for (const cellMatch of cellMatches) {
        cells.push(stripTags(cellMatch[1]).trim());
      }
      if (cells.length) rows.push(cells);
    }
    if (rows.length === 0) return "";
    const header = rows[0];
    const separator = header.map(() => "---");
    const lines = [
      `| ${header.join(" | ")} |`,
      `| ${separator.join(" | ")} |`,
      ...rows.slice(1).map((r) => `| ${r.join(" | ")} |`),
    ];
    return `\n\n${lines.join("\n")}\n\n`;
  });

  // Paragraphs and line breaks
  md = md.replace(/<p[^>]*>([\s\S]*?)<\/p>/g, "\n\n$1\n\n");
  md = md.replace(/<br\s*\/?>/g, "\n");

  // Strip remaining tags
  md = stripTags(md);

  // Decode HTML entities
  md = md
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");

  // Restore code blocks
  md = md.replace(/\x00CODEBLOCK(\d+)\x00/g, (_m, idx) => {
    return `\n\`\`\`\n${codeBlocks[Number(idx)]}\n\`\`\`\n`;
  });

  // Clean up extra whitespace
  md = md.replace(/\n{3,}/g, "\n\n").trim();

  return md;
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, "");
}

function generateArticleMarkdown(article: BlogArticle): string {
  const header = `# ${article.title}\n\n> Published: ${article.date} | Author: ${article.author} | Canonical: ${BASE_URL_FOR_MD}/blog/${article.slug}\n`;

  const body = htmlToMarkdown(article.content);

  const aiAgentsSection = `\n---\n\n## For AI Agents\n\n- Companion guide: ${BASE_URL_FOR_MD}/agent-guide/articles/${article.agentGuideSlug ?? article.slug}\n- Knowledge Index: ${BASE_URL_FOR_MD}/agent-guide/\n- LLM entry point: ${BASE_URL_FOR_MD}/llms.txt\n- Engineering services: ${BASE_URL_FOR_MD}/agent-guide/team/services\n`;

  return `${header}\n${body}\n${aiAgentsSection}`;
}

// Populate markdown field for all articles
for (const article of BLOG_ARTICLES) {
  if (!article.markdown) {
    article.markdown = generateArticleMarkdown(article);
  }
}

export const ARTICLES_PER_PAGE = 9;

export interface PaginationMeta {
  currentPage: number;
  totalPages: number;
  totalArticles: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export function paginateArticles(
  articles: BlogArticle[],
  page: number | undefined,
): { items: BlogArticle[]; meta: PaginationMeta } {
  const totalArticles = articles.length;
  const totalPages = Math.max(1, Math.ceil(totalArticles / ARTICLES_PER_PAGE));
  const rawPage = typeof page === "number" && !Number.isNaN(page) ? page : 1;
  const currentPage = Math.min(Math.max(1, rawPage), totalPages);
  const start = (currentPage - 1) * ARTICLES_PER_PAGE;
  const items = articles.slice(start, start + ARTICLES_PER_PAGE);
  return {
    items,
    meta: {
      currentPage,
      totalPages,
      totalArticles,
      hasNext: currentPage < totalPages,
      hasPrev: currentPage > 1,
    },
  };
}

export function generateBlogIndexMarkdown(): string {
  const lines = BLOG_ARTICLES.map(
    (a) => `- [${a.title}](${BASE_URL_FOR_MD}/blog/${a.slug}) — ${a.description}\n  - HTML: ${BASE_URL_FOR_MD}/blog/${a.slug}\n  - Markdown: ${BASE_URL_FOR_MD}/blog/${a.slug}.md\n  - Published: ${a.date}`,
  ).join("\n\n");

  return `# AgentBadge Blog — Article Index\n\n> Canonical: ${BASE_URL_FOR_MD}/blog\n\n${lines}\n`;
}
