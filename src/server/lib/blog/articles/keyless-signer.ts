import type { BlogArticle } from "../../blog-data";

export const article: BlogArticle = {
  slug: "keyless-signer",
  title: "Your API Process Should Not Hold the Money Key",
  description:
    "One env variable ran money, verdicts and ops authority at once — so we split it into three keys and moved the money key out of the API process behind a Unix-socket signer service. Fail-fast 503 before x402 charging, policy-bounded signatures, pre-announced {current,next} rotation — plus the honest list of what it does NOT protect against.",
  author: "AgentBadge Team",
  authorRole: "Agency for the Agentic Web",
  date: "2026-10-25",
  dateModified: "2026-10-25",
  tags: [
    "key-management",
    "signer-service",
    "x402",
    "unix-socket",
    "eip-712",
    "key-rotation",
    "arc",
    "security-architecture",
  ],
  readingTime: "8 min",
  shortAnswer:
    "We removed the settlement private key from our API process entirely: authority split into ARC_SETTLE_KEY (money) / ARC_OPS_KEY (ops) / ARC_VERDICT_SIGNER_KEY (verdicts), the money key lives in a second process reachable only over a Unix socket, paid routes fail 503 before x402 payment when the signer is down, and rotation is pre-announced via a public {current, next} signer list. Env scans of the API process find no money key — verified in CI.",
  heroImage: "/images/blog/keyless-signer-hero.webp",
  ogImage: "/images/blog/keyless-signer-og.jpeg",
  status: "LIVE",
  technologies: [
    "Bun",
    "TypeScript",
    "Unix domain sockets",
    "NDJSON-RPC",
    "EIP-712",
    "EIP-191",
    "viem",
    "Hono",
    "x402",
  ],
  entities: ["signer-service", "socket-signer", "env-key-signer", "verdict-signers-json", "erc-8183-escrow"],
  concepts: [
    "authority-split",
    "signer-seam",
    "fail-fast-before-payment",
    "trust-ahead-rotation",
    "self-describing-signatures",
    "policy-bounded-signing",
  ],
  topics: ["key-custody", "payment-security", "ops-security", "service-boundaries"],
  capabilities: [
    "unix-socket-signer-service",
    "env-authority-split",
    "signer-health-gating",
    "throttled-operator-alerts",
  ],
  rules: [],
  actions: [
    {
      type: "read",
      label: "Read article (Markdown)",
      url: "https://agentbadge.xyz/blog/keyless-signer.md",
    },
    {
      type: "read",
      label: "Signer trust list (current/next)",
      url: "https://agentbadge.xyz/keys/verdict-signers.json",
    },
    {
      type: "read",
      label: "ArcSigner package on npm",
      url: "https://www.npmjs.com/package/@agentbadge/circle-payments",
    },
    {
      type: "contact",
      label: "Work with AgentBadge",
      url: "https://agentbadge.xyz/agent-guide/team/contact",
    },
  ],
  qa: [
    {
      question: "What does a god key in the API env actually buy an attacker?",
      answer:
        "Every authority granted to the address — in our case escrow settlement (real funds), verdict signatures (trust surface), and operational attestations, all from one /proc/<pid>/environ read. Splitting keys by authority means a leak costs one power, not all three.",
    },
    {
      question: "What happens when the signer service is down?",
      answer:
        "Paid routes return 503 signer_unavailable before the x402 payment middleware runs — clients can never be charged for a service that cannot sign. Free routes keep serving, and the operator gets a throttled Discord/Telegram alert. There is no fallback key by design.",
    },
    {
      question: "How does signer rotation not break old verdicts?",
        answer:
        "Verdicts are EIP-712 self-describing — verification recovers the signer and compares it to the address embedded in the artifact, so retired-key verdicts verify forever. GET /keys/verdict-signers.json publishes {current, next} ahead of time, electron-builder trust-ahead style.",
    },
    {
      question: "When should you move to KMS or MPC custody?",
      answer:
        "When volume or compliance demands non-exportable keys. AWS KMS, Web3Signer, or Circle developer-controlled wallets (verified ARC + EIP-712 support) all plug into the same ArcSigner seam without changing callers.",
    },
  ],
  claims: [
    {
      id: "c12-no-settle-key-in-api-env",
      status: "VERIFIED",
      text: "The API process env contains no settlement key: the supervisor launches it via env -u ARC_SETTLE_KEY -u SIGNER_KEY, verified by an env-scan test.",
      evidence: [
        { type: "test", url: "https://github.com/spreadzp/agentbadge/blob/main/tests/signer-e2e.test.ts" },
        { type: "github", url: "https://github.com/spreadzp/agentbadge/blob/main/scripts/start-with-signer.sh" },
      ],
    },
    {
      id: "c12-503-before-charge",
      status: "VERIFIED",
      text: "A dead signer service causes paid routes to return 503 before payment runs — the x402 settle path never executes; free routes stay up.",
      evidence: [
        { type: "test", url: "https://github.com/spreadzp/agentbadge/blob/main/tests/signer-e2e.test.ts" },
        { type: "github", url: "https://github.com/spreadzp/agentbadge/blob/main/src/server/middleware/signer-health.ts" },
      ],
    },
    {
      id: "c12-seam-interchangeable",
      status: "VERIFIED",
      text: "EnvKeySigner and SocketSigner are interchangeable behind the ArcSigner seam — one test suite runs against both with identical addresses and recovered EIP-191/EIP-712 signatures.",
      evidence: [
        { type: "test", url: "https://github.com/spreadzp/agentbadge/blob/main/tests/signer-interchange.test.ts" },
        { type: "github", url: "https://www.npmjs.com/package/@agentbadge/circle-payments" },
      ],
    },
    {
      id: "c12-retired-key-verifies",
      status: "VERIFIED",
      text: "Verdicts signed by a retired key still verify: signatures are self-describing and {current,next} signers are published ahead of rotation.",
      evidence: [
        { type: "test", url: "https://github.com/spreadzp/agentbadge/blob/main/tests/key-rotation.test.ts" },
        { type: "demo", url: "https://agentbadge.xyz/keys/verdict-signers.json" },
      ],
    },
  ],
  content: `<h2 id="god-key">What does a "god key" actually buy an attacker?</h2>
<p><strong>Short answer:</strong> everything your platform is trusted for. A leaked private key inherits every authority you granted the address — payments it can settle, attestations it can forge, reputations it can fake. Splitting keys by authority means a leak costs one power, not all of them.</p>
<p>Our <code>ARC_EVALUATOR_KEY</code> was three keys wearing one trench coat:</p>
<ul>
<li><strong>Money</strong> — evaluator authority on escrow settlements. This one drains real funds.</li>
<li><strong>Ops</strong> — attestations, anchor writes, venue evaluation calls.</li>
<li><strong>Verdict</strong> — the cryptographic signature behind every public verdict we publish.</li>
</ul>
<p>A RCE that dumps <code>/proc/&lt;pid&gt;/environ</code> gets all three in one read. The wallet funding gas and the identity buyers verify against were the same secret. That's not a credential, that's the crown jewels in a <code>.env</code> file.</p>
<p><img src="/images/blog/keyless-signer-2.webp" alt="Three bounded keys replace one god-key: money, ops, verdict" /></p>

<h2 id="authority-split">How do you split key authority without breaking payments?</h2>
<p><strong>Short answer:</strong> give each power its own secret, and never let the money key live in the same process that serves HTTP. Three env secrets replace one — and the dangerous one never enters the API process at all.</p>
<ul>
<li><code>ARC_SETTLE_KEY</code> — money. Only allowed to settle escrow contracts.</li>
<li><code>ARC_OPS_KEY</code> — operational writes: attestations, anchors, venue-eval.</li>
<li><code>ARC_VERDICT_SIGNER_KEY</code> — verdict signatures (the trust surface).</li>
</ul>
<p>The legacy combined key ran one release as a deprecated fallback that logs a warning, then got removed from deploy secrets entirely. Old secrets don't linger — that's the entire point.</p>
<p><img src="/images/blog/keyless-signer-d2.webp" alt="Trust boundary: API env holds ops + verdict keys, signer env holds the settle key behind policy" /></p>

<h2 id="socket-signer">How does a signer service on a Unix socket work?</h2>
<p><strong>Short answer:</strong> the key lives in a second process on the same host. The API talks to it through a local socket file — NDJSON-RPC, no TCP, zero network surface — and asks it to sign. Env dumps of the API process come back empty.</p>
<p>The signer is a small Bun service (<code>src/signer-service</code>) that owns the money key and answers <code>signMessage</code>, <code>signTypedData</code>, <code>sendTransaction</code>, <code>health</code>, <code>getAddress</code>. The API holds a <code>SocketSigner</code> client behind an <code>ArcSigner</code> seam — the same interface an env key implements, so callers can't tell which backend is wired.</p>
<pre><code># supervisor launches API with the money key REMOVED from its env:
exec env -u ARC_SETTLE_KEY -u SIGNER_KEY bun src/server/index.ts</code></pre>
<p>And the signer doesn't sign just anything it hears — a policy layer allowlists target contracts (<code>SIGNER_ALLOW_TO</code>) and caps gas (<code>SIGNER_MAX_GAS</code>). Even a compromised API can only request signatures the operator pre-approved.</p>
<p><img src="/images/blog/keyless-signer-3.webp" alt="API process and signer service connected only by a Unix socket" /></p>

<h2 id="fail-fast">What happens when the signer service dies?</h2>
<p><strong>Short answer:</strong> paid routes fail fast — HTTP 503 <em>before</em> payment verification or settlement runs, so a client can never be charged for a service that can't sign. Free routes stay up. The operator gets an alert. No silent fallback key exists by design.</p>
<p>A health gate pings the signer before the x402 payment middleware. Dead service → <code>503 signer_unavailable</code> and the payment path never executes — <code>charged</code> stays zero in the test. An alert fans out to the operator's Discord webhook and Telegram, throttled to one per five-minute cooldown.</p>
<p>The uncomfortable alternative — keeping a fallback key in the API env "just in case" — recreates the god-key the whole exercise removes. We'd rather refuse money than risk it.</p>
<p><img src="/images/blog/keyless-signer-d1.webp" alt="Sequence: paid request hits the health gate before x402; dead signer → 503 + operator alert, alive → socket sign + settle" /></p>

<h2 id="rotation">How do you rotate a signer without breaking old verdicts?</h2>
<p><strong>Short answer:</strong> publish <code>{current, next}</code> signer addresses ahead of time, and make every artifact self-describing — a verdict embeds its signer's address, so verification never depends on which key is "current". Stolen key? Rotate <code>current</code>; consumers already trust <code>next</code>.</p>
<p><code>GET /keys/verdict-signers.json</code> serves a two-slot list borrowed from electron-builder's auto-update trust model. Every verdict is EIP-712 signed and carries its evaluator address — <code>ecrecover</code> the signature and compare, no key registry needed. Verdicts from the retired key verify forever, which is exactly what a verification endpoint must do after an emergency rotation.</p>

<h2 id="audit">What does the signer audit trail look like?</h2>
<p><strong>Short answer:</strong> every request becomes one NDJSON line — operation, target, value, result, txHash or denial reason. If the API starts asking for things outside the allowlist, the log shows the attempt and the refusal.</p>
<pre><code>{"op":"sendTransaction","to":"0x8004…","value":"0","result":"ok","txHash":"0x…"}
{"op":"sendTransaction","to":"0xdead…","result":"denied","reason":"to not in SIGNER_ALLOW_TO"}</code></pre>
<p>The second line is the interesting one: that's the policy layer catching a call the operator never approved — proof the socket boundary has teeth.</p>
<p><img src="/images/blog/keyless-signer-4.webp" alt="Terminal showing signer audit log: green ok line and red denied line" /></p>

<h2 id="env-scan">Prove it — run the env scan yourself</h2>
<p><strong>Short answer:</strong> on Linux, read the live environment of any process: <code>tr '\\0' '\\n' &lt; /proc/&lt;pid&gt;/environ | grep -iE 'settle|signer'</code> should return nothing for the money key. The API process physically cannot leak what it never held.</p>
<p>On our deployment it's <code>fly ssh console</code> → the same grep → empty. <code>ARC_OPS_KEY</code> and <code>ARC_VERDICT_SIGNER_KEY</code> may still appear — those stay in env today, which is the honest part of the next section.</p>

<h2 id="tradeoffs">What does this not protect against?</h2>
<p><strong>Short answer:</strong> an attacker <em>on the same host</em> can still ask the signer to sign — the boundary protects the key from the API process, not from the machine. Policy limits damage; it doesn't eliminate it. And two of the three keys still sit in the API env until we migrate them.</p>
<ul>
<li><strong>Host-level RCE still hurts.</strong> Same-machine attacker reaches the socket. The allowlist + gas cap bound the blast radius — bounded, not eliminated.</li>
<li><strong>Ops and verdict keys are still in env.</strong> Money moved first because it was the most expensive to lose. The seam (<code>ArcSigner</code>) already accepts remote backends; ops-key migration is next.</li>
<li><strong>One more process to babysit.</strong> Cost: ~$0 recurring, plus a supervisor restart loop and a 503-when-dead contract.</li>
<li><strong>Straggler drain.</strong> Jobs submitted pre-rotation settle via a dedicated script that reads the old key from an operator file, never from server env. Until the drain completes, the old key still exists — in a secrets file, not a process.</li>
</ul>

<h2 id="kms-mpc">When should you use KMS or MPC instead?</h2>
<p><strong>Short answer:</strong> when the transaction volume makes self-hosting the risky option, or compliance requires non-exportable keys. AWS KMS, Web3Signer, or Circle developer-controlled wallets — the <code>ArcSigner</code> seam already accepts all three without changing callers.</p>
<p>We verified Circle's developer-controlled wallets support ARC/ARC-TESTNET including EIP-712 typed-data signing: keys live at Circle, we hold only a 32-byte entity secret encrypted per request. Cheaper than a full KMS path — the tradeoff is vendor lock-in on the paid path, so v1 stays self-hosted and Circle remains the designated ops-key candidate when volumes justify it.</p>

<h2 id="for-agents">For AI Agents</h2>
<ul>
<li><strong>ArcSigner seam:</strong> <code>address</code>, <code>signMessage</code>, <code>signTypedData</code>, <code>sendTransaction</code>, <code>ping</code>. Backends: <code>createEnvKeySigner</code>, <code>createSocketSigner</code> — <a href="https://www.npmjs.com/package/@agentbadge/circle-payments">@agentbadge/circle-payments</a> on npm.</li>
<li><strong>Signer trust list:</strong> <code>GET https://agentbadge.xyz/keys/verdict-signers.json</code> → <code>{current, next}</code> evaluator EOAs. Prefetch <code>next</code> before you need it.</li>
<li><strong>Verify any verdict:</strong> <code>GET https://agentbadge.xyz/api/verify/:verdictId</code> — recovered signer vs artifact's evaluator address. Works for retired keys by design.</li>
<li><strong>503 contract:</strong> <code>signer_unavailable</code> means paid capacity is down; payment was not attempted. Retry after operator restart — no idempotency risk, nothing was charged.</li>
</ul>

<h2 id="one-liner">The one-sentence version</h2>
<p>Split your keys by authority, keep the money one out of the HTTP-serving process, refuse payment when the signer is down, and publish your next key before the current one leaks.</p>
<p><em>Don't trust the env file. Check it.</em></p>`,
};
