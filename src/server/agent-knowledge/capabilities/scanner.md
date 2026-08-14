# Passive Scanner

## What Is the Scanner?

The AgentBadge scanner is a **passive, non-intrusive** tool that evaluates your API's Agent Readiness by sending HTTP requests — exactly like an AI agent would.

## How It Works

1. **Fetches** your endpoints (GET requests)
2. **Checks** for `llms.txt`, `robots.txt`, `sitemap.xml`, `/.well-known/agent-card.json`
3. **Validates** OpenAPI spec if present
4. **Tests** authentication clarity
5. **Analyzes** response structure (JSON, error codes, HATEOAS links)
6. **Scores** each dimension with evidence

## Non-Intrusive by Design

The scanner:

- **Does NOT** modify your API or data
- **Does NOT** require code changes or SDK installation
- **Does NOT** deploy any agent to your infrastructure
- **Does NOT** access private endpoints or internal APIs

It simply sends HTTP GET requests to your public endpoints — the same requests any AI agent would make when trying to use your API.

## What the Scanner Checks

| Check | What It Looks For |
|-------|-------------------|
| `llms.txt` | Does `/llms.txt` exist and contain valid content? |
| `robots.txt` | Does `/robots.txt` exist? |
| `sitemap.xml` | Does `/sitemap.xml` or `/ai-sitemap.xml` exist? |
| Agent card | Does `/.well-known/agent-card.json` exist and validate? |
| OpenAPI | Does `/api/specs` or `/openapi.json` return a valid spec? |
| Auth clarity | Is the authentication flow documented and clear? |
| Error format | Do errors return structured JSON with error codes? |
| Response format | Are responses machine-readable (JSON, not HTML)? |

## Scanner Output

Each scan produces:

- **Overall score** (0-100)
- **Dimension scores** (Discovery, Documentation, Authentication, Machine-readability)
- **Findings** — each with rule, status, evidence, and confidence
- **Recommendations** — what to fix and how

## Related

- [Scoring Engine](/agent-guide/concepts/scoring) — How scan results are scored
- [CLI Tool](/agent-guide/capabilities/cli) — How to run the scanner locally
- [Agent Readiness](/agent-guide/concepts/agent-readiness) — What the scanner measures
- [Engineering Services](/agent-guide/team/services) — We can help implement agent-readiness fixes
- [Contact Us](/agent-guide/team/contact) — Start a conversation
