/* eslint-disable max-lines -- article HTML content (prose data, not code) */
// EPIC-259 (SLICE-259-30): article content split under the 20KB staged-file cap.
export const whatIsAgentReadinessContentA = `
<h2>Why a good API can be invisible to AI agents</h2>

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

<img src="/images/blog/what-is-agent-readiness-hero.webp" alt="Hero — a human developer walks into API Docs while an AI agent faces a featureless wall" />

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

<img src="/images/blog/what-is-agent-readiness-2.webp" alt="Web vs Agentic Web — two parallel flows: robots.txt/sitemap/search vs machine-readable docs/capabilities/action" />

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

<img src="/images/blog/what-is-agent-readiness-3.webp" alt="Four layers of Agent Readiness — Discovery, Understanding, Authentication, Machine-readable responses" />

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

<img src="/images/blog/what-is-agent-readiness-4.webp" alt="Evidence card — rule AB-004 VERIFIED, HTTP 200, confidence 1.0" />

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

`;
