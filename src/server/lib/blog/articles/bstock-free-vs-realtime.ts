import type { BlogArticle } from "../../blog-data";

export const article: BlogArticle = {
  slug: "bstock-free-vs-realtime",
  title: "Free vs Real-Time: Why an Agent Should Pay for bStock Data",
  description: "One request per minute is a snapshot; real-time is a signal. Why the paid tier of a bStock delta tracker is infrastructure, not an expense.",
  author: "AgentBadge Team",
  authorRole: "Agency for the Agentic Web",
  date: "2026-09-23",
  dateModified: "2026-09-23",
  tags: ["bstocks","real-time-data","freemium","ai-agents","trading"],
  readingTime: "4 min",
  shortAnswer: "Free tier gives one snapshot per minute; the paid tier gives unlimited polling, Telegram alerts, and a 30-day ServicePass — for an agent that trades or alerts on tokenized-stock deltas, real-time data is infrastructure.",
  content: `<p>The bStock delta tracker has two tiers: free (1 request per minute)
and paid (real-time, 5 USDC for 30 days). A fair question from any
trader: why pay when free exists?</p>
<figure>
<img src="/images/blog/bstock-free-vs-realtime-d1.png"
alt="Diagram: free vs paid" />
<figcaption aria-hidden="true">Diagram: free vs paid</figcaption>
</figure>
<p><em>The free tier is one request per minute — a snapshot for a
one-off check or research. The paid tier (5 USDC for 30 days) is
real-time: unlimited polling, Telegram alerts at the 0.5% threshold, and
an hourly digest.</em></p>
<h2 id="what-the-free-tier-gives">What the free tier gives</h2>
<p>One request per minute is a <strong>snapshot</strong>. Ask “what is
AAPLB’s delta” — get an answer. For research, a one-off check, a demo —
enough. But between requests there is a minute of blindness. And delta
lives exactly in those minutes.</p>
<h2 id="what-the-paid-tier-gives">What the paid tier gives</h2>
<ul>
<li><strong>Unlimited requests</strong> — poll every second if your
strategy needs it.</li>
<li><strong>Telegram alerts</strong> — the tracker messages you when a
delta crosses the 0.5% threshold. No polling at all; the signal finds
you.</li>
<li><strong>Hourly digest</strong> — a summary of everything that
happened while you were away.</li>
<li><strong>A 30-day ServicePass</strong> — one payment, a month of
access, proof on-chain.</li>
</ul>
<h2 id="when-the-delta-turns-into-money">When the delta turns into
money</h2>
<p>Three scenarios where a minute of blindness costs more than the
subscription:</p>
<ul>
<li><strong>Weekends.</strong> News drops on Saturday — the equity
reacts on Monday, the token reacts now. A −3% delta on a closed exchange
is advance information about Monday’s gap.</li>
<li><strong>Earnings.</strong> The report lands after the call — the
stock is still in its auction, the token has already repriced.</li>
<li><strong>Thin pools.</strong> One large order moves the token an hour
before liquidity rebalances — the window opens and closes by
itself.</li>
</ul>
<p>In all three, the edge is not “seeing it eventually” — it is seeing
it <strong>first</strong>.</p>
<h2 id="agent-economics">Agent economics</h2>
<p>5 USDC for 30 days of real-time is ~0.17 USDC a day. One caught
arbitrage window on a tokenized stock pays for years of subscription.
For an agent that trades or alerts on deltas, the paid tier is not an
expense — it is infrastructure, like a market data feed.</p>
<p><em>Next — the educational block: what bStocks are, for people new to
tokenized stocks.</em></p>
<hr />
<p><strong>Links</strong></p>
<ul>
<li>Agent guide (endpoints, limits, examples): <a
href="https://agentbadge.xyz/bstock-guide">agentbadge.xyz/bstock-guide</a></li>
<li>All articles in the series: <a
href="https://agentbadge.xyz/blog">agentbadge.xyz/blog</a></li>
<li>MCP endpoint:
<code>https://agentbadge.xyz/mcp/bstock/tools/get_delta</code></li>
</ul>`,
};
