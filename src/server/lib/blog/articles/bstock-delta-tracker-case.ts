import type { BlogArticle } from "../../blog-data";

export const article: BlogArticle = {
  slug: "bstock-delta-tracker-case",
  title: "Tracking the Delta: How an AI Agent Watches Tokenized Stocks Drift From Their Underlyings",
  description: "Tokenized stocks trade 24/7 while their underlyings sleep. We built a real-time delta tracker and exposed it to AI agents over MCP — with a 402 paywall on Arc.",
  author: "AgentBadge Team",
  authorRole: "Agency for the Agentic Web",
  date: "2026-09-23",
  dateModified: "2026-09-23",
  tags: ["bstocks","tokenized-stocks","mcp","x402","ai-agents"],
  readingTime: "6 min",
  shortAnswer: "A delta tracker computes the price divergence between a tokenized stock and its underlying in real time and serves it to AI agents over MCP — free tier 1 req/min, then HTTP 402 with an x402 payment on Arc Testnet.",
  content: `<p>Picture this: Apple trades at $336.45 on Nasdaq. Tokenized Apple
(AAPLB on Binance) trades at $336.44 at the same moment. A penny apart —
noise. But on a Saturday night, with Nasdaq asleep, AAPLB can drift to
−2%. That is not noise anymore. That is a signal.</p>
<p><strong>The delta</strong> — the gap between a tokenized stock’s
price and its underlying — is where the opportunities live. Humans
cannot watch 20+ tokens around the clock. A machine can. So we built a
tracker that computes the delta in real time and handed it to AI
agents.</p>
<h2 id="what-the-tracker-computes">What the tracker computes</h2>
<p>For every bStock the tracker keeps two prices:</p>
<ul>
<li><strong>bStockPrice</strong> — the token’s price on Binance, where
tokenized stocks trade 24/7;</li>
<li><strong>underlyingPrice</strong> — the real stock’s price from
market data providers (Finnhub, with an Alpaca fallback).</li>
</ul>
<p>Delta in percent:
<code>(tokenPrice − stockPrice) / stockPrice × 100</code>. Alongside it,
three flags a trader actually needs:</p>
<ul>
<li><strong>phase</strong> — is the stock market open (<code>O</code>),
closed (<code>C</code>), or in pre-market (<code>P</code>);</li>
<li><strong>stale</strong> — the price feed went quiet for more than 15
seconds, so treat the number with care;</li>
<li><strong>inAlert</strong> — the delta crossed the <strong>0.5%
threshold</strong> (configurable).</li>
</ul>
<p>A live response looks like this:</p>
<div class="sourceCode" id="cb1"><pre
class="sourceCode json"><code class="sourceCode json"><span id="cb1-1"><a href="#cb1-1" aria-hidden="true" tabindex="-1"></a><span class="fu">{</span><span class="dt">&quot;symbol&quot;</span><span class="fu">:</span><span class="st">&quot;AAPLB&quot;</span><span class="fu">,</span><span class="dt">&quot;underlying&quot;</span><span class="fu">:</span><span class="st">&quot;AAPL&quot;</span><span class="fu">,</span><span class="dt">&quot;multiplier&quot;</span><span class="fu">:</span><span class="fl">1.0006</span><span class="fu">,</span></span>
<span id="cb1-2"><a href="#cb1-2" aria-hidden="true" tabindex="-1"></a> <span class="dt">&quot;bStockPrice&quot;</span><span class="fu">:</span><span class="fl">336.44</span><span class="fu">,</span><span class="dt">&quot;underlyingPrice&quot;</span><span class="fu">:</span><span class="fl">336.45</span><span class="fu">,</span></span>
<span id="cb1-3"><a href="#cb1-3" aria-hidden="true" tabindex="-1"></a> <span class="dt">&quot;deltaPct&quot;</span><span class="fu">:</span><span class="fl">-0.064</span><span class="fu">,</span><span class="dt">&quot;phase&quot;</span><span class="fu">:</span><span class="st">&quot;O&quot;</span><span class="fu">,</span><span class="dt">&quot;stale&quot;</span><span class="fu">:</span><span class="kw">false</span><span class="fu">,</span><span class="dt">&quot;inAlert&quot;</span><span class="fu">:</span><span class="kw">false</span><span class="fu">}</span></span></code></pre></div>
<h2 id="how-an-agent-uses-it">How an agent uses it</h2>
<p>An AI agent is a program — Claude, a GPT-based bot, your own script —
that calls services on its own. Agents talk to services over
<strong>MCP</strong>, an open protocol where a service lists its tools
and the agent calls them like functions.</p>
<p>The tracker is an MCP server with these tools:</p>
<ul>
<li><code>get_delta</code> — delta for one symbol;</li>
<li><code>list_deltas</code> — all symbols at once;</li>
<li><code>get_quote</code> — current quote;</li>
<li><code>get_events</code> — event history (threshold crossings, stale
feeds);</li>
<li><code>get_digest</code> — the day’s summary.</li>
</ul>
<div class="sourceCode" id="cb2"><pre
class="sourceCode bash"><code class="sourceCode bash"><span id="cb2-1"><a href="#cb2-1" aria-hidden="true" tabindex="-1"></a><span class="ex">curl</span> <span class="at">-X</span> POST https://agentbadge.xyz/mcp/bstock/tools/get_delta <span class="dt">\</span></span>
<span id="cb2-2"><a href="#cb2-2" aria-hidden="true" tabindex="-1"></a>  <span class="at">-H</span> <span class="st">&quot;Authorization: Bearer </span><span class="va">$TOKEN</span><span class="st">&quot;</span> <span class="dt">\</span></span>
<span id="cb2-3"><a href="#cb2-3" aria-hidden="true" tabindex="-1"></a>  <span class="at">-d</span> <span class="st">&#39;{&quot;symbol&quot;: &quot;AAPLB&quot;}&#39;</span></span></code></pre></div>
<p>There is also Telegram: <code>subscribe_telegram</code> registers the
agent’s operator, and the tracker pushes a message whenever a delta
crosses 0.5%. No polling needed — the signal finds you.</p>
<h2 id="freemium-a-snapshot-for-free-the-stream-for-a-fee">Freemium: a
snapshot for free, the stream for a fee</h2>
<p>The first request each minute is free. After that the server answers
with <strong>HTTP 402 Payment Required</strong> — not an error, an
invoice: “want real-time? pay”. The x402 standard lets the agent pay
automatically: 5 USDC on the Arc network buys 30 days of access. No
signup, no card, one on-chain transaction — gas paid in USDC too, an Arc
specialty. The server verifies the transaction on-chain and opens the
door. The same payment cannot be replayed — replay protection is built
in.</p>
<h2 id="why-a-trader-should-care">Why a trader should care</h2>
<p>A −0.06% delta is noise. A −2% delta on a closed exchange means “the
token was sold off and the equity has not woken up yet”. Whoever sees it
first captures the convergence. A person cannot monitor every token
every second — an agent can, and it pays for its own data feed without a
human in the loop.</p>
<p><em>Next: inside the 402 paywall — how freemium works when the
customer is a machine.</em></p>`,
};
