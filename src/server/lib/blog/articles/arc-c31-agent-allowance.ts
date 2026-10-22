import type { BlogArticle } from "../../blog-data";

export const article: BlogArticle = {
  slug: "arc-c31-agent-allowance",
  title: "A Funded Key Is Not a Budget. We Proved It on Arc Mainnet",
  description:
    "x402 lets an AI agent pay in USDC, but a funded key is not a budget. Agent Allowance is an onchain USDC budget vault on Arc mainnet: the owner funds once, funds vest linearly Sablier-style, and the agent claims only vested amounts to allowlisted payees inside a per-tx cap. Full lifecycle verified on explorer.arc.io.",
  author: "AgentBadge Team",
  authorRole: "Agency for the Agentic Web",
  date: "2026-10-21",
  dateModified: "2026-10-21",
  tags: ["arc", "usdc", "agent-allowance", "budget-vault", "sablier", "erc-8004", "vesting", "mainnet"],
  readingTime: "7 min",
  shortAnswer:
    "Agent Allowance is a USDC budget vault on Arc mainnet (chainId 5042). The owner deposits once, funds vest linearly, and the agent can only claim already-vested amounts to allowlisted payees within a per-transaction cap — plus owner pause and cancel with clawback of unvested funds. Three real claims moved the vendor balance 99,020 to 99,135 units; every lifecycle step is a verifiable transaction on explorer.arc.io.",
  heroImage: "/images/blog/arc-c31-agent-allowance-hero.webp",
  ogImage: "/images/blog/arc-c31-agent-allowance-og.jpeg",
  agentGuideSlug: "arc-c31-agent-allowance",
  status: "LIVE",
  technologies: ["arc", "USDC", "ERC-8004", "ERC-20", "Solidity", "Foundry", "x402"],
  entities: ["budget-vault", "vault-factory", "payee-allowlist", "vesting-schedule"],
  concepts: ["policy-in-code", "linear-vesting", "agent-allowance", "evidence-over-promises"],
  topics: ["agent-payments", "onchain-allowance", "arc-mainnet"],
  capabilities: ["budget-enforcement", "claim-verification", "owner-clawback"],
  actions: [
    {
      type: "read",
      label: "Read article (Markdown)",
      url: "https://agentbadge.xyz/blog/arc-c31-agent-allowance.md",
    },
    {
      type: "view-demo",
      label: "Agent Allowance landing",
      url: "https://agentbadge.xyz/hackathon/agent-allowance",
    },
    {
      type: "contact",
      label: "Work with AgentBadge",
      url: "https://agentbadge.xyz/agent-guide/team/contact",
    },
  ],
  qa: [
    {
      question: "What stops an agent from draining a funded vault?",
      answer:
        "Four onchain guards in BudgetVault: a payee allowlist set by the owner, a per-transaction cap, a vested-minus-claimed bound so unvested USDC is unreachable, and an owner-controlled pause plus cancel that returns all unvested funds.",
    },
    {
      question: "Is the lifecycle actually verifiable?",
      answer:
        "Yes. Approve, deposit, addPayee, setPerTxCap and three claims are all real Arc mainnet transactions linked in the article, including claim 0x5a29b4…509b5 at block 27082200. The vendor balance moved 99,020 to 99,135 units.",
    },
    {
      question: "How does it differ from Coinbase SpendPermission or Safe AllowanceModule?",
      answer:
        "Both bind spending to a spender or delegate without restricting recipients. BudgetVault adds a payee allowlist and a linear vesting schedule in one contract, following the session-key policy-in-code model plus Sablier-style cancel clawback.",
    },
  ],
  claims: [
    {
      id: "claim-1",
      text: "A BudgetVault on Arc mainnet processed three agent claims to an allowlisted vendor; the vendor USDC balance moved from 99,020 to 99,135 units.",
      status: "VERIFIED",
      evidence: [
        {
          type: "transaction",
          url: "https://explorer.arc.io/tx/0x5a29b45d133338516ca88ad96017bc8ec79a8ef206b6d5767a74956f6c8509b5",
        },
      ],
    },
    {
      id: "claim-2",
      text: "The vault lifecycle — approve, deposit, addPayee, setPerTxCap — is a chain of onchain transactions on Arc mainnet (chainId 5042).",
      status: "VERIFIED",
      evidence: [
        {
          type: "transaction",
          url: "https://explorer.arc.io/tx/0xaf0b2dd109690824f7d573df2563eb83b49fe2cb901952fccd4c1e98119d5a56",
        },
        {
          type: "demo",
          url: "https://agentbadge.xyz/hackathon/agent-allowance",
        },
      ],
    },
    {
      id: "claim-3",
      text: "The contract passes 46 of 46 Foundry tests; source is public in the agent-budget-vault repository.",
      status: "VERIFIED",
      evidence: [
        {
          type: "github",
          url: "https://github.com/spreadzp/agent-budget-vault",
        },
      ],
    },
  ],
  economicContext: {
    endpoints: {
      landing: "https://agentbadge.xyz/hackathon/agent-allowance",
      vault: "https://explorer.arc.io/address/0x2860258CAf3e21c65517233aBa1e876D16D4Ff52",
      factory: "https://explorer.arc.io/address/0x5D1a014e1FFE3b777F0946C2dd75A7d3aecdacA4",
      repository: "https://github.com/spreadzp/agent-budget-vault",
      guide: "https://agentbadge.xyz/agent-guide/articles/arc-c31-agent-allowance",
    },
    payment: { supported: false, currency: "USDC" },
  },
  relatedResources: [
    {
      type: "project",
      label: "Agent Allowance — hackathon landing",
      url: "https://agentbadge.xyz/hackathon/agent-allowance",
    },
    {
      type: "github",
      label: "agent-budget-vault (Foundry)",
      url: "https://github.com/spreadzp/agent-budget-vault",
    },
    {
      type: "guide",
      label: "C30 — machine-readable docs loop",
      url: "https://agentbadge.xyz/blog/arc-c30-agent-economy",
    },
    {
      type: "guide",
      label: "C4 — agent wallet spending policies",
      url: "https://agentbadge.xyz/blog/arc-c4-agent-wallet",
    },
  ],
  content: `<p>x402 lets an AI agent pay for things in USDC. That part works. The part nobody ships is the one that matters to whoever holds the keys: if the agent holds a funded key, the only thing standing between your balance and a bad prompt, a bug or a compromised model is the agent itself. A funded key is not a budget. It is just money with a chatbot attached.</p>
<p>We built Agent Allowance to close that gap: an onchain USDC budget vault on Arc mainnet where the owner funds once, funds vest linearly Sablier-style, and the agent can only claim what has already vested, to allowlisted payees, inside a per-transaction cap. Every guard lives in the contract, not in a promise. The full lifecycle — deploy, deposit, allowlist, cap, claim — is a chain of real transactions you can open right now on explorer.arc.io.</p>
<p>This is C31 of the Arc Campaign series. <a href="/blog/arc-c30-agent-economy">C30</a> was about making our own docs machine-operable. This one is about the money side: how an agent's spending power gets encoded instead of hoped for.</p>
<p><img src="/images/blog/arc-c31-agent-allowance-hero.webp" alt="A glowing key dropping coins into a vault framed by four gate posts, a small robot avatar reaching for the exit gate" /></p>

<h2 id="what-is-allowance">What does "allowance" mean for an agent?</h2>
<p>Give a human assistant a company card and the card network carries the policy: limits, categories, revocation. Give an AI agent a private key with USDC on it and none of that exists. The key can sign anything, pay anyone, any amount, forever. Most agent-payment setups today stop exactly there — the agent gets a funded wallet and an API key.</p>
<p>An allowance fixes the semantics the same way an employment contract fixes a handshake: the owner defines a funded vault, a vesting schedule, a list of allowed payees and a per-transaction cap. The agent's spending power is bounded by all four at once. If the agent's key leaks, the blast radius is the remaining vested amount toward one allowlisted address — not the whole treasury.</p>

<h2 id="how-budgetvault-works">How does BudgetVault enforce it onchain?</h2>
<p>The contract is deliberately small. One deposit starts a linear vest — the balance an agent can spend grows second by second, which is the same mental model Sablier Lockup uses for payroll streams. Claims go through <code>claim(amount, payee)</code>, and the contract reverts unless four checks pass:</p>
<ul>
<li><strong>payee allowlist</strong> — the owner added the address via <code>addPayee</code>; the agent cannot route funds to itself or anywhere new;</li>
<li><strong>per-tx cap</strong> — one claim can never exceed <code>perTxCap</code>, no matter how much has vested;</li>
<li><strong>vested − claimed</strong> — unvested USDC is unreachable even with a valid signature;</li>
<li><strong>pause flag</strong> — the owner can freeze claims instantly, and <code>cancel()</code> returns all unvested funds, the standard Sablier clawback semantics.</li>
</ul>
<p><img src="/images/blog/arc-c31-agent-allowance-2.webp" alt="A USDC token stream flowing through four gate posts — checklist, cap, lock and stop-hand icons — each partially dimming the stream" /></p>

<h2 id="lifecycle-mainnet">The lifecycle on Arc mainnet, transaction by transaction</h2>
<p>Talk is cheap; the explorer is not. The demo vault went through its full lifecycle on Arc mainnet (chainId 5042). Each step is a real transaction — open them and verify the calls yourself:</p>
<table>
<thead><tr><th>Step</th><th>What happened</th><th>Transaction</th></tr></thead>
<tbody>
<tr><td>approve</td><td>Owner approved 3 USDC to the vault</td><td><a href="https://explorer.arc.io/tx/0xfb313a05825556aa0b4773a47fb1f2cc1587a20edb835e65d7f1909156e0b1aa"><code>0xfb313a…0b1aa</code></a></td></tr>
<tr><td>deposit</td><td>3 USDC deposited; linear vesting started</td><td><a href="https://explorer.arc.io/tx/0xaf0b2dd109690824f7d573df2563eb83b49fe2cb901952fccd4c1e98119d5a56"><code>0xaf0b2d…d5a56</code></a></td></tr>
<tr><td>addPayee</td><td>Vendor address allowlisted</td><td><a href="https://explorer.arc.io/tx/0x92a234f6c6ad1152bf64911a5aa0a312eacf8beb49c89189a85c6b7833073787"><code>0x92a234…3787</code></a></td></tr>
<tr><td>setPerTxCap</td><td>Cap set to 1 USDC per claim</td><td><a href="https://explorer.arc.io/tx/0xc927d0ac15518b31a05855ab2a8de7100123b90f562bb9bf0e760990f1194a54"><code>0xc927d0…4a54</code></a></td></tr>
<tr><td>claim #1</td><td>Agent claimed to vendor (+55 units)</td><td><a href="https://explorer.arc.io/tx/0xab1286328863f5ec4dbb9b040587114fc3966b40506dfc2feb5a85a375d9013d"><code>0xab1286…9013d</code></a></td></tr>
<tr><td>claim #2</td><td>Agent claimed again, this time from the UI (+30)</td><td><a href="https://explorer.arc.io/tx/0x99a6418d86ac4cb8477a44402bd076bca45fa7d205b04244fce3734fa97d0c6e"><code>0x99a641…d0c6e</code></a></td></tr>
<tr><td>claim #3</td><td>Third claim (+30, block 27082200)</td><td><a href="https://explorer.arc.io/tx/0x5a29b45d133338516ca88ad96017bc8ec79a8ef206b6d5767a74956f6c8509b5"><code>0x5a29b4…509b5</code></a></td></tr>
</tbody>
</table>
<p>The vendor's USDC balance moved 99,020 → 99,135 units over the three claims — +115 total, all onchain, all explainable line by line. The vault sits at <code>0x2860258CAf3e21c65517233aBa1e876D16D4Ff52</code>, deployed through the factory at <code>0x5D1a014e1FFE3b777F0946C2dd75A7d3aecdacA4</code>. 46 of 46 Foundry tests pass.</p>
<p><img src="/images/blog/arc-c31-agent-allowance-d1.webp" alt="Vault lifecycle sequence: owner deploys via factory, deposits USDC which starts linear vesting, allowlists the payee, sets the cap; the agent claims vested funds to the vendor" /></p>

<h2 id="vs-existing-primitives">How is this different from existing allowance primitives?</h2>
<p>We checked the obvious alternatives before writing a contract:</p>
<ul>
<li><strong>Coinbase SpendPermissionManager</strong> (Base) gives recurring allowances bound to a <em>spender</em> account — it does not restrict which recipients the spender may pay.</li>
<li><strong>Safe's AllowanceModule</strong> handles delegate + amount + reset period, again without recipient restrictions.</li>
<li><strong>ZeroDev / Biconomy session-key policies</strong> come closest: spend limits plus a contract allowlist in one policy. That pattern — "policy in code" — is the de-facto industry reference for agent spending, and it is the model BudgetVault follows.</li>
<li><strong>Sablier Lockup</strong> contributes the vesting and the <code>cancel()</code> clawback semantics: keep what streamed, return what has not.</li>
</ul>
<p>What we add is the combination in one small contract plus a vesting dimension those allowlist-only designs lack: the agent does not just have a cap, it has a <em>schedule</em>. Money that has not vested yet cannot be spent, stolen or argued about — cancel the stream and it goes back to the owner.</p>

<h2 id="three-role-ui">Three roles, one honest UI</h2>
<p>The demo interface is not a mockup — it is a three-role board wired to the live vault. The owner view shows funding, payee management, the cap, pause and cancel. The agent view shows vested and claimable amounts ticking in real time, the vesting schedule and the ERC-8004 agent identity (id 2, <code>0xcdd23d…869d</code>) bound to the vault. The vendor view scans its own payee address and finds incoming payments with block numbers — no trust in the agent required.</p>
<p>The whole walkthrough is recorded: a 3-minute EN/RU demo video runs the loop end to end, and the hackathon landing at <a href="/hackathon/agent-allowance">agentbadge.xyz/hackathon/agent-allowance</a> carries the animated architecture diagram and every explorer link from the table above.</p>
<p><img src="/images/blog/arc-c31-agent-allowance-3.webp" alt="Three panels — a crowned owner at a control board, a robot under a rising vesting bar, a vendor scanning a checklist with a magnifier" /></p>

<h2 id="not-claiming">What we are not claiming</h2>
<ul>
<li><strong>Amounts are demo-sized.</strong> Three claims, 115 units of USDC. The mechanics are mainnet-real; the scale is intentionally trivial.</li>
<li><strong>One payee, one agent, one vault.</strong> Multi-payee, multi-agent and operator-claim patterns (a SignedIntent handed to an orchestrator) are designed seams, not shipped features.</li>
<li><strong>The UI is a demo harness.</strong> It proves the contract is usable by three roles; it is not a production custody product.</li>
<li><strong>No audit.</strong> Foundry suite is green (46/46) and every write is on the explorer, but the contract has not seen an external audit. Do not point a treasury at it.</li>
</ul>

<h2 id="try-it">Try it yourself</h2>
<ul>
<li>Walk the lifecycle: every row in the table links straight to a transaction</li>
<li>Read the contract: <a href="https://explorer.arc.io/address/0x2860258CAf3e21c65517233aBa1e876D16D4Ff52">vault on explorer.arc.io</a></li>
<li>Watch the loop: the EN/RU demo video shows owner → agent → vendor end to end</li>
<li>Clone the repo and run <code>forge test</code> — 46/46 should pass</li>
</ul>
<p><em>This is C31 in the Arc Campaign series. Earlier: <a href="/blog/arc-c30-agent-economy">C30</a> the machine-readable docs loop, <a href="/blog/arc-c15-x402-bazaar">C15</a> the x402 bazaar, <a href="/blog/arc-c4-agent-wallet">C4</a> agent wallet spending policies. Series index at <a href="/blog">agentbadge.xyz/blog</a>.</em></p>`,
};
