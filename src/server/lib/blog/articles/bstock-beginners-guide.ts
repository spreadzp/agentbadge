import type { BlogArticle } from "../../blog-data";

export const article: BlogArticle = {
  slug: "bstock-beginners-guide",
  title: "bStocks for Beginners: What Tokenized Stocks Are and How They Work",
  description: "A tokenized stock is a blockchain token tracking a real share — 24/7 trading, stablecoin settlement, fractional access. How bStocks work and why prices diverge.",
  author: "AgentBadge Team",
  authorRole: "Agency for the Agentic Web",
  date: "2026-09-23",
  dateModified: "2026-09-23",
  tags: ["bstocks","tokenized-stocks","guide","rwa","crypto"],
  readingTime: "5 min",
  shortAnswer: "bStocks are tokens tracking real share prices: they trade on-chain 24/7 with stablecoin settlement and fractional access, but grant no shareholder rights — and their price can drift from the underlying, creating the delta.",
  content: `<p>A tokenized stock is a blockchain token whose price follows a real
share. AAPLB mirrors Apple, TSLAB mirrors Tesla. Buy the token — get the
same price exposure as the share, but on a crypto exchange, around the
clock.</p>
<figure>
<img src="/images/blog/bstock-beginners-guide-d1.png"
alt="Diagram: how a bStock works" />
<figcaption aria-hidden="true">Diagram: how a bStock works</figcaption>
</figure>
<p><em>The issuer holds the real shares and issues tokens (AAPLB = Apple
× 1.0006) that trade on Binance 24/7, settled in USDC. While the two
markets agree, the delta is near zero; when they diverge — nights,
weekends, news — the gap becomes an opportunity for some and a risk for
others.</em></p>
<h2 id="how-it-works-under-the-hood">How it works under the hood</h2>
<p>The issuer holds the real shares (or an equivalent) and issues tokens
that mirror their value. The token trades on an exchange (for bStocks —
Binance) 24/7, settles in stablecoins, and its price is anchored to the
share through a multiplier — for AAPLB it is about 1.0006.</p>
<h2 id="how-a-token-differs-from-a-share">How a token differs from a
share</h2>
<ul>
<li><strong>Trading hours.</strong> The share trades during the exchange
session; the token trades 24/7, weekends included.</li>
<li><strong>Access.</strong> The share needs a broker, KYC, minimum
lots; the token needs an exchange account and USDC.</li>
<li><strong>Rights.</strong> The token usually carries no voting rights
and no direct dividends — it is a price tracker, not equity in the
company. Read the issuer’s terms.</li>
<li><strong>Fractionality.</strong> You can hold 0.01 of a share.</li>
</ul>
<h2 id="why-prices-diverge-and-what-the-delta-is">Why prices diverge —
and what the delta is</h2>
<p>Token and share are two different markets with different liquidity.
At night the share sleeps while the token keeps trading — their prices
drift apart. That gap is the <strong>delta</strong>.</p>
<p>A concrete picture: news breaks on Saturday. The stock cannot move
until Monday’s open. The token drops 3% within minutes. That is not the
token “breaking” — that is the token market pricing the news before the
stock market can. The delta makes this visible.</p>
<h2 id="where-to-start">Where to start</h2>
<p>Exchange account → USDC → buy a bStock. From the first trade, watch
the delta: it shows how far the token has drifted from the original and
hints at both opportunity (convergence trades) and risk (the gap can
widen). Monitoring dozens of tokens around the clock is a job for a
machine — which is exactly what delta trackers, including ours for AI
agents, are for.</p>
<p><em>Next: strategies people actually run on the delta.</em></p>
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
