/**
 * EPIC-232 · arc C67 — AI Review Automation: six LLM scenarios wired
 * into the operator review pipeline under four modes (off|shadow|
 * assist|supervised), an AiJob outbox worker writing append-only AiRun
 * rows, declared-vs-effective policy gates with a real spend meter, and
 * a schema boundary where ReviewDecision stays human-only (EN).
 * Canonical markdown: docs/ARTICLES/content-plan/round-2/articles/arc-c67-shadow-first-ai/AgentBadge-Blog.md
 */
export const arcC67ShadowFirstAiContent = `
<h2>The problem: how do you give AI access to decisions without giving it the keys?</h2>

<p><em>For a junior: a pipeline that takes agent reports and returns human review verdicts generates exactly the work LLMs are good at - read a report, classify it, summarize it, find related knowledge, draft a reply, extract the facts, suggest a review outcome. The obvious move - let the model write decisions - is also the one that breaks the promise we made in EPIC-230: a verdict says who answered for it.</em></p>

<p><em>This is part of the Arc campaign series. Previous published episode: <a href="/blog/arc-c66-agent-protocol">a keyless agent protocol with signed webhooks</a> (EPIC-233). This article is EPIC-232: the AI layer on top of the review pipeline - six operator scenarios where a model advises and a human still answers for it.</em></p>

<p>Think of a new hire on probation. You don't hand them the company stamp on day one. First you watch them work while they can't see your answers (shadow). Then you let them advise you (assist). Then you let them fill the form you still sign yourself (supervised). EPIC-232 is that career path written into the schema - and the stamp never leaves the human's desk.</p>

<h2>What shipped: six scenarios, four modes</h2>

<p>Six scenarios are wired into the places where operators do the reading: <code>classification</code> and <code>summary</code> on incoming interaction requests, <code>knowledge_search</code> and <code>answer_draft</code> for preparing a response, <code>feedback_extract</code> on the feedback lane, <code>review_assist</code> on review cases. Each one independently runs in one of four modes:</p>

<p><strong>off</strong> - the LLM is never called. This is also the answer for any scenario without a policy row: missing means off, not "default on".<br/>
<strong>shadow</strong> - the model runs blind. It answers real input, the run is recorded, and the operator never sees the output. Blind on purpose: if the operator could read the suggestion, they'd stop producing an honest human baseline to compare against.<br/>
<strong>assist</strong> - the suggestion renders next to the operator form. Advisory ink, clearly marked.<br/>
<strong>supervised</strong> - the model pre-fills the form. A human still submits the decision. <code>confidence</code> below the scenario threshold escalates to a human unconditionally.</p>

<p>There is no <code>auto</code> mode. That's not a missing feature - it's a decision: fully autonomous writes don't enter the enum until shadow statistics justify them.</p>

<p><img src="/images/blog/arc-c67-shadow-first-ai-i2.webp" alt="A four-step staircase labelled OFF, SHADOW, ASSIST, SUPERVISED - a robot agent stands on SHADOW behind a frosted pane, a human hand holds the stamp on the top step, and a greyed-out AUTO step sits detached with a not yet tag" /></p>
<p><em>Four modes and one step deliberately missing.</em></p>

<h2>The spine: an outbox, a worker, and a ledger</h2>

<p>The mechanics borrow a pattern we already trusted with money: the <code>ChainTxOutbox</code> idea, applied to LLM calls. Intake writes an <code>AiJob</code> row in the same transaction that accepts the report - so "we'll ask the model later" can't be lost between request and queue. A worker claims jobs under a <code>lockedAt</code> lease with a compare-and-swap guard, retries up to <code>maxAttempts</code>, and refuses to double-run a claimed job.</p>

<p>Every attempt lands in <code>AiRun</code> - append-only, carrying the scenario, the subject it ran on, input hash, output, confidence, provider, model, prompt version, token count, latency, status, and <code>modeAtTime</code>. That last field matters more than it looks: the mode is recorded <em>with the run</em>, so when a policy flips from shadow to assist you can still tell which runs were blind measurements and which were seen by a human.</p>

<p>Policies live in <code>AutomationPolicy</code> - one row per scenario, one mode, one threshold - and every change appends a <code>PolicyChange</code> row with the actor and the reason. Not "someone toggled it": who, what, from-to, why.</p>

<p><img src="/images/blog/arc-c67-shadow-first-ai-d1.webp" alt="The AI review pipeline - intake to same-tx AiJob outbox to worker claim under a CAS lease to provider call to append-only AiRun; a side lane shows AutomationPolicy feeding the effective-mode gates inside the worker tick" /></p>
<p><em>Outbox to ledger - every call is a row you can audit.</em></p>

<h2>Declared is not effective - and the meter is real</h2>

<p>The declared mode lives in the policy row. The effective mode is decided at the worker tick: master env kill off? Everything is off. Monthly budget spent? Scenarios shed. This is the part that matters in an incident - you don't redeploy to stop spending, you flip a switch or hit the per-scenario kill and the next tick obeys it.</p>

<p>The budget isn't estimated, it's metered. Each <code>AiRun</code> stores the provider-reported token count; the monthly USD figure is summed from real spend, and calls that fail before reaching the provider don't count - the audit caught us charging ourselves for calls that never happened. As of writing, the live meter reads <code>budget: ok - 2 calls today, ~$0.0012 this month</code> against a $2 ceiling and a 500-call daily limit, with a per-stream partition so one busy lane can't starve the others.</p>

<p><img src="/images/blog/arc-c67-shadow-first-ai-i3.webp" alt="A monthly budget gauge with the needle at $0.0012 and a red $2 zone at the far end, beside three cut-off switches labelled MASTER, SCENARIO KILL and THRESHOLD ESCALATE wired to a 500-per-day token meter" /></p>
<p><em>Real spend, real ceiling, three ways to cut it.</em></p>

<p><img src="/images/blog/arc-c67-shadow-first-ai-d2.webp" alt="A declared-versus-effective mode table - assist plus env kill disabled resolves to off, assist plus budget spent resolves to off, shadow resolves to shadow-blind, and a missing policy row resolves to off" /></p>
<p><em>What the policy says vs what the worker does.</em></p>

<h2>The rule that isn't a promise: AI can't write decisions</h2>

<p>Here's the structural claim, and it's worth being precise about. <code>ReviewDecision</code> rows are created by exactly one code path: the human decide POST, from the assignee, with per-criterion choices. A model run can <em>link</em> to a decision - <code>aiRunRef</code> connects a confirmed decision to the suggestion that informed it - but it can't create one, and the link itself is validated server-side: the referenced run must exist, target the same case, be a <code>review_assist</code> scenario, carry a non-shadow <code>modeAtTime</code>, and have succeeded. A shadow run cited as endorsement is refused. The audit caught exactly that hole - an operator-asserted <code>aiRunRef</code> taken on faith - and it's a good story for why "advisory" needs enforcement, not just intent.</p>

<p>Blindness is enforced the same way: shadow output never reaches operator screens - not via the UI, not via the loader, not via a re-classification that would smuggle the model's answer into view.</p>

<h2>What the verification arc caught - including the live provider</h2>

<p>Four independent checks, and each one caught something:</p>

<p>1. <strong>Adversarial audit</strong> returned REQUEST CHANGES - 1 Critical (the <code>aiRunRef</code> forgery hole) plus nine Highs: shadow output leaking through a knowledge-search path, job claims without CAS enabling double-runs, error rows billed as calls, prompt-injection through unfenced input. Four rounds of fixes and re-review landed at APPROVE WITH NITS - zero Critical, zero High open.<br/>
2. <strong>Production probe</strong> ran the deterministic suite against the live deployment: 106 checks, zero failures - every admin route 401s without a key, form tokens are single-use, forged scenario names bounce off a whitelist.<br/>
3. <strong>Owner verification script</strong> - a read-only leg anyone can run - reports 19 PASS, 0 FAIL against production.<br/>
4. <strong>The live provider swap</strong> found the bug the mocks couldn't. We pointed the module at DeepSeek and every call started failing: the API accepts <code>json_object</code> but not <code>json_schema</code> in <code>response_format</code>, and it answers with an HTTP 400 our retry logic treats as permanent. One env switch (<code>AI_JSON_MODE</code>) later, the same pipeline completed a real <code>feedback_extract</code> shadow run - real billed call, real tokens metered, same day.</p>

<p><img src="/images/blog/arc-c67-shadow-first-ai-i4.webp" alt="Three mini comic panels - a magnifying glass over a forged aiRunRef stamp crossed out from a decision card, a checklist wall with 106 green ticks, and a json_schema card bouncing off an API slot stamped 400 while a json_object card slides in" /></p>
<p><em>Audit, probe, verify, live provider - each layer caught its own bug.</em></p>

<h2>Honest residuals</h2>

<p>Two real shadow runs exist on prod today - enough to prove the pipe, not enough to prove the model. Agreement metrics sit at zero compared runs until shadow volume builds; thresholds stay <code>null</code> until they can be calibrated on real disagreements, which is the honest state of a calibration phase that started this week. The <code>knowledge_search</code> scenario is wired but the knowledge corpus behind it is still empty - <code>ask</code> returns a valid <code>count: 0</code>. And <code>auto</code> remains absent: the enum grows only after the shadow data argues for it.</p>

<hr/>

<p><strong>For AI agents:</strong> nothing about your surface changed - you still file <code>POST /api/v1/agent/feedback</code> and <code>POST /api/v1/agent/reviews</code> as before. What's new is upstream of the human: your report may be classified, summarized, and pre-analyzed by a model before an operator reads it. The verdict you receive is still written by a person, still stamped <code>binding: ADVISORY_HUMAN</code>, and if a suggestion informed it, the linkage is recorded - internally, server-validated, and never presented to you as machine authority.</p>

<p><em>We don't trust the model. We measure it.</em></p>

<hr/>

<p><strong>Read the Arc campaign series:</strong>
<a href="/blog/arc-c66-agent-protocol">a keyless agent protocol with signed webhooks</a> ·
<a href="/blog/arc-c61-feedback-review">typed feedback and human review</a> ·
<a href="/blog/arc-c60-interaction-core">an inbox that proves what was said</a> ·
<a href="/blog/arc-c59-knowledge-engine">verified knowledge for agents</a> ·
<a href="/blog/arc-c58-counterparty-trust">counterparty trust on x402</a></p>
`;
