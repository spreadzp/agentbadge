# GEO Optimization

## What Is GEO?

GEO (Generative Engine Optimization) is the practice of making content discoverable and quotable by generative AI systems — answer engines, LLM crawlers, and agent frameworks — rather than only by classic search indexes. Where SEO optimizes for ranked links, GEO optimizes for *machine-readable answers*: structured data, canonical machine surfaces, and content shaped so a model can lift a correct response verbatim.

## How AgentBadge Applies GEO

- **`llms.txt`** — a curated index of machine-readable entry points for LLM agents.
- **`/.well-known/agentbadge-machine.json`** — the machine descriptor: auth schemes, challenge format, capability feed, and concrete call examples in one document.
- **`/agent-guide/`** — every guide, concept, and capability page is served as `text/markdown` — the format LLM crawlers consume natively.
- **Knowledge Objects on articles** — each blog post carries structured `topics`/`concepts`/`capabilities` metadata so agents can route questions to the right page without parsing prose.
- **Answer-first content** — pages lead with the direct answer, then evidence — the shape generative engines prefer to cite.

## Why It Matters

Generative AI picks up hyper-specific, machine-readable pages faster than classic SEO surfaces. An agent that can fetch `/.well-known/agentbadge-machine.json`, read the auth contract, and call a paid endpoint in one pass never needs a human in the loop — that is the GEO payoff.

## Related

- [SEO/GEO and Agent Readiness](/agent-guide/articles/seo-geo-agent-readiness) — the three-era optimization model
- [Agent Readiness](/agent-guide/concepts/agent-readiness) — the third layer: actionability for autonomous agents
- [Getting Started](/agent-guide/getting-started) — the canonical agent onboarding path
