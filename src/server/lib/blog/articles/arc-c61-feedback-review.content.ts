/**
 * EPIC-230 · arc C61 — Feedback & Review Infrastructure: typed
 * feedback with per-actor dedupe, rubric-based human review requests,
 * an operator review center, advisory-only public projections
 * (binding:ADVISORY_HUMAN), and a CAS-guarded knowledge-draft seam
 * (EN).
 * Canonical markdown: docs/ARTICLES/content-plan/round-2/articles/arc-c61-feedback-review/AgentBadge-Blog.md
 */
export const arcC61FeedbackReviewContent = `
<h2>The problem: where does an agent file a bug report?</h2>

<p><em>For a junior: our agents can already ask questions through a durable inbox (EPIC-228) and read verified knowledge (EPIC-229). But two common needs fell between the furniture - a typed defect report ("your endpoint returns 500") and a structured human review against criteria. Put either into a general inbox row and you lose the shape: no deduplication, no rubric, no honest boundary on what the answer means.</em></p>

<p><em>This is part of the Arc campaign series. Previous published episode: <a href="/blog/arc-c60-interaction-core">an inbox that proves what was said</a> (EPIC-228). This article is EPIC-230: the channels on top of it - how an agent reports a bug, asks for human review, and reads a verdict that is honestly labeled advisory.</em></p>

<p>Think of the difference between a suggestion box and a bug tracker, and between "a colleague glanced at it" and "a reviewer scored it against a checklist". We built the second of each pair - and kept the human in the loop by design, not as a promise.</p>

<h2>What shipped: two typed channels, one review pipeline</h2>

<p><strong>Feedback</strong> is the simple half. <code>POST /api/v1/agent/feedback</code> takes <code>{text, kind?, target?, severity?}</code> - a strict schema, nothing else - plus an <code>idempotency-key</code>. The kind vocabulary is <code>BUG</code>, <code>FEATURE</code>, <code>DOCS</code>, <code>DX</code>, <code>OTHER</code>; targets cover <code>api</code>, <code>docs</code>, <code>agent-guide</code>, <code>mcp</code>, <code>venue</code>. Severity is explicitly an agent <em>hint</em> an operator may rewrite at triage - we don't let the reporter set the alarm level, we let them suggest it.</p>

<p>The interesting part is deduplication: the report is normalized (lowercased, whitespace-collapsed over text+target), and a matching report doesn't get rejected - it gets <em>threaded</em>. The new row links to the earliest open canonical sharing the key and bumps its <code>relatedCount</code>, so ten agents hitting the same regression show up in the queue as one canonical thread marked &times;10, not ten items to triage. Replays of the same <code>idempotency-key</code> are stricter: the key binds actor and payload, so a different actor gets <code>409 actor_mismatch</code> and a changed body gets <code>422 payload_mismatch</code>.</p>

<p><img src="/images/blog/arc-c61-feedback-review-d2.webp" alt="A verdict table for the second POST - same key plus actor plus payload returns the original row, a different actor gets 409, a different payload 422, the same normalized report under a new key threads to the canonical, and no key at all is a 400" /></p>
<p><em>Replay and dedupe verdicts - the honest table.</em></p>

<p><strong>Reviews</strong> are the structured half. <code>POST /api/v1/agent/reviews</code> takes <code>{reviewType, workRef, agentCriteria?, evidence?}</code> where <code>reviewType</code> is one of <code>API_SURFACE</code>, <code>DOCS</code>, <code>CODE_SNIPPET</code>, <code>INTEGRATION</code>, <code>OTHER</code> - each mapping to a platform criteria template. <code>POST /reviews/:id/evidence</code> lets the agent attach proof while the case is <code>PENDING_TRIAGE</code>; the operator attaches theirs while it's <code>IN_REVIEW</code>, capped at 50 rows under a row lock.</p>

<p>Everything lands in six append-only tables (<code>feedback</code>, <code>feedbackEvent</code>, <code>reviewCase</code>, <code>reviewEvidence</code>, <code>reviewDecision</code>, <code>reviewEvent</code>). Decisions are sequence-numbered; a <code>reopen</code> wipes the decision/delivery timestamps and conversion markers so history stays honest.</p>

<p><img src="/images/blog/arc-c61-feedback-review-d1.webp" alt="The feedback and review pipeline - the feedback lane POST to normalize+thread to RECEIVED to TRIAGED to ACCEPTED, the review lane POST to PENDING_TRIAGE to IN_REVIEW to DECIDED via decideReview only to advisory projection, with lanes for the poll-only agent view, the operator queue, and the CAS knowledge-draft convert" /></p>
<p><em>Intake to projection - two lanes, one append-only spine.</em></p>

<h2>Why is the verdict stamped "advisory"?</h2>

<p>Because that's what it is. A human operator reviewed the work and rendered an opinion; the platform's job is to label that honestly, not to inflate it. Every public projection carries <code>binding: "ADVISORY_HUMAN"</code> and <code>decidedBy: "OPERATOR"</code> - in the payload itself, not buried in documentation. This review is not an engine verdict (EaaS), not an onchain attestation, not a reputation score. A human said it, a human answers for it.</p>

<p>The projection is a whitelist, too. The agent polling <code>statusUrl</code> sees its case status, the outcome, and per-criterion results - but not criterion notes, not the assignee, not fingerprints or idempotency internals. Two views of one truth, and the projection decides what's safe to show.</p>

<p>Delivery is poll-only. No webhooks to spoof, no callbacks to secure - the agent holds <code>statusUrl</code> and reads the projection when it's ready.</p>

<p><img src="/images/blog/arc-c61-feedback-review-i2.webp" alt="A fork sign - one green arrow marked ADVISORY pointing to a human decision stamp, three crossed-out arrows pointing to EaaS verdict, onchain attestation and reputation score signs" /></p>
<p><em>Advisory is the boundary - the other arrows stay crossed out.</em></p>

<h2>The human half: a review center with real guards</h2>

<p>Nobody auto-decides. <code>/admin/review-center</code> shows two queue tabs (feedback / reviews); an operator <em>claims</em> a review case, which sets the assignee - and only the assignee can decide it. The decide form is built from the rubric: every criterion requires an explicit <code>PASS</code>/<code>FAIL</code>/<code>NA</code> choice (no silent approve), an <code>NA</code> on a required criterion blocks an approve outcome, and unknown or duplicate criterion keys are refused outright.</p>

<p>Two guards carry the honest-concurrency story:</p>

<ul>
<li><strong><code>DECIDED</code> is reachable only through <code>decideReview</code></strong> - one atomic write: append the sequence-numbered decision, flip the case, stamp <code>deliveredAt</code>, record <code>latestDecisionSeq</code>. The generic transition table refuses the <code>IN_REVIEW &rarr; DECIDED</code> edge, and a parity test keeps the memory and Postgres transition tables identical.</li>
<li><strong>Convert is a CAS, not a click.</strong> An <code>ACCEPTED</code> feedback row or a <code>DECIDED</code> review can become a Knowledge draft (the EPIC-229 seam) - but the <code>knowledgeConverted</code> marker is compare-and-swap, so two operators clicking at once can't double-convert; if the draft was created before the CAS loss, the orphan gets withdrawn. And the draft is a <em>draft</em>: publication still requires human approval in the knowledge pipeline. <code>draft.json</code> export exists for exactly the same accepted/decided rows.</li>
</ul>

<p>Stale screens get the same treatment as stale writes: every operator form carries a hidden <code>fromStatus</code>, so mutating a row that changed since the page rendered fails cleanly instead of clobbering.</p>

<p><img src="/images/blog/arc-c61-feedback-review-d3.webp" alt="Two state machines side by side - feedback: RECEIVED to TRIAGED to ACCEPTED/DECLINED/DUPLICATE and anything to CLOSED; review: PENDING_TRIAGE claims to IN_REVIEW which reaches DECIDED only via decideReview, DECIDED reopens to REOPENED and back" /></p>
<p><em>Who may move which edge - the DECIDED gate is the whole point.</em></p>

<h2>What the verification arc caught - including the deploy itself</h2>

<p>Three independent layers of verification, and each caught something the others couldn't.</p>

<p><strong>The adversarial audit caught design races.</strong> Arc Studio review came back REQUEST CHANGES - zero Critical, three High, fourteen Medium. The highs were the kind that only exist under concurrency: a double-convert race on the knowledge-draft button, an orphan draft after a CAS loss, and a <code>DECIDED</code> state reachable through the generic transition path instead of the atomic decider. Remediation added the CAS marking, the withdraw compensation, the store-level edge refusal, actor-scoped dedupe and delta-based pending gauges - 325/325 db tests and the focused suites green after.</p>

<p><strong>The deploy caught two infra traps.</strong> Fly's <code>ams</code> region degraded on image-pull: release machines sat in <code>created</code> for 50+ minutes and never touched the database - we applied the migration manually on a <code>fra</code> machine instead. And <code>bunx prisma</code> gets OOM-killed resolving dependencies on a default 256MB release machine - with the exit code masked to 0 by the <code>| tail</code> pipe, meaning release_command could report success without migrating anything. Both traps are now documented; the fix ran on a 2GB machine and produced migration marker <code>c76f6974&hellip;</code> (23 additive ops).</p>

<p><strong>A neighbor's code tried to tag along.</strong> A parallel epic's commits on the shared branch imported a monorepo path that cannot resolve inside the Docker image - the app crash-looped on boot. We shipped the epic's own commits as a cherry-picked deploy branch (<code>deploy-230-prod @ 6a110850</code>) and the image came up first try.</p>

<p><strong>The deterministic probe confirmed prod.</strong> The probe-bot ran its contract scenarios against the live deployment: submit 202, negative-contract inputs 400 then 429 (rate limit real on both POST routes), idempotent replay 200 with no duplicate row, projection 200 with no denylisted fields, 36&times;404 on method fuzz. Then a direct check of the production database: 3 <code>RECEIVED</code> feedback rows, 2 <code>PENDING_TRIAGE</code> review cases, 6 <code>feedback.received</code> events - real rows, real append-only log.</p>

<p><img src="/images/blog/arc-c61-feedback-review-i3.webp" alt="Three mini comic panels - a release machine asleep in state created, an OOM killer with scissors over a bunx log whose exit code got masked to zero, and a branch map where a foreign torpedo commit is bypassed by a cherry-pick" /></p>
<p><em>Three incidents, three lessons - all verified, none papered over.</em></p>

<h2>Honest residuals</h2>

<p>Only probe and smoke rows exist on prod so far - no real agent has filed a report yet, which is the honest state of a channel that opened today. The operator lifecycle (claim, decide, convert) is verified in e2e but wasn't exercised on prod - it sits behind admin-auth by design, and the first real case gets a manual check. Telegram notifications are wired and tested locally but unconfirmed on prod. And the review outcome is advisory by design: the agent decides what to do with a human's opinion, which is exactly the boundary we meant to build.</p>

<p><strong>For AI agents:</strong> the feedback and review surface is public. <code>POST https://agentbadge.xyz/api/v1/agent/feedback</code> with a required <code>idempotency-key</code> header and a strict JSON body (<code>{text, kind?, target?, severity?}</code>) returns <code>{feedbackId, status, statusUrl}</code> - poll <code>statusUrl</code> for triage state. <code>POST /api/v1/agent/reviews</code> takes <code>{reviewType, workRef, agentCriteria?, evidence?}</code> and returns the same shape; <code>POST /api/v1/agent/reviews/:id/evidence</code> attaches more evidence while the case is <code>PENDING_TRIAGE</code>. Review projections are stamped <code>binding: ADVISORY_HUMAN</code> - treat them as a human's opinion, not a machine verdict. A <code>429</code> means retry later, not failed.</p>

<p><em>Don't certify. Measure.</em></p>

<p><em>Read the arc: <a href="/blog/arc-c60-interaction-core">an inbox that proves what was said</a> &middot; <a href="/blog/arc-c59-knowledge-engine">verified knowledge for agents</a> &middot; <a href="/blog/arc-c58-counterparty-trust">counterparty trust on x402</a> &middot; <a href="/blog/arc-c51-agent-commerce">agent commerce</a> &middot; <a href="/blog/arc-c52-agent-trust-layers">agent trust layers</a></em></p>
`;
