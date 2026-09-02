# AgentBadge — WebMCP: Agent-Native Compliance Platform

> **Six imperative tools. One declarative form. Zero API keys.** AI agents discover and use AgentBadge through the browser's native `navigator.modelContext` interface — no MCP server setup, no SDK installation, no authentication tokens.

**Live:** [agentbadge.xyz](https://agentbadge.xyz/) — deployed on Fly.io, Hedera Testnet
**Presentation:** [12-slide PDF](./docs/hackathons/webmcp/presentation.pdf) — system overview, tools, comparison with traditional APIs & MCP
**System Description:** [SYSTEM-CAPABILITIES.md](./docs/hackathons/webmcp/SYSTEM-CAPABILITIES.md) — full capabilities writeup

---

## What is WebMCP?

WebMCP is a browser-native protocol that lets AI agents discover and use tools directly from web pages — without installing MCP servers, configuring SDKs, or managing API keys. The browser mediates all tool calls, handling trust levels and permissions.

AgentBadge is the **first agent-native compliance platform powered by WebMCP**. It exposes 6 imperative tools and 1 declarative form through `navigator.modelContext.provideContext()`. Agents visit the page, discover tools automatically via `/.well-known/webmcp.json`, and call them directly.

### WebMCP vs Traditional API

| Feature | Traditional API | WebMCP (AgentBadge) |
|---------|----------------|---------------------|
| Discovery | Manual docs reading | Automatic via `/.well-known/webmcp.json` |
| Authentication | API keys, OAuth tokens | Browser-mediated, no keys needed |
| Integration | SDK setup, config files | Zero integration — browser native |
| Security | Developer manages secrets | Browser mediates all calls |
| Trust model | All-or-nothing access | Per-tool trust levels (trusted/untrusted) |
| Agent experience | Read docs → get keys → write code | Discover tools → call directly |

### WebMCP vs Traditional MCP (Model Context Protocol)

| Feature | Traditional MCP | WebMCP (AgentBadge) |
|---------|----------------|---------------------|
| Setup | MCP server installation | Zero setup — browser native |
| Transport | stdio or SSE | HTTP endpoints via browser |
| Discovery | Manual server config | `/.well-known/webmcp.json` auto-discovery |
| Security | Developer manages permissions | Browser-mediated trust levels |
| Agent access | Requires MCP client | Any agent with browser access |
| Tool registration | Server-side code | `navigator.modelContext.provideContext()` |

---

## The 6 Imperative Tools

| # | Tool | Trust | Endpoint | What It Does |
|---|------|-------|----------|--------------|
| 1 | `agent-readiness-scan` | readOnly, untrusted | `GET /api/scan?url=` | Scans any website for 145+ AI agent readiness checks across 18 categories |
| 2 | `badge-generate` | readOnly, trusted | `GET /api/badge?url=` | Generates a compliance badge SVG for a given URL and score |
| 3 | `passport-issue` | write, trusted | `POST /passport/request` | Issues an AgentBadge passport NFT on Hedera blockchain |
| 4 | `passport-verify` | readOnly, trusted | `GET /api/passport/verify?tokenId=` | Verifies a passport by token ID or DID (Hedera + EVM) |
| 5 | `get-compliance-score` | readOnly, untrusted | `GET /api/score?url=` | Returns compliance score (0-100) and grade (A-F) |
| 6 | `search-rules` | readOnly, trusted | `GET /api/rules/search?q=` | Searches 145+ compliance rules by keyword |

## The Declarative Form

| Form | Action | Method | Input |
|------|--------|--------|-------|
| `submitScanRequest` | `/api/scan` | GET | `url` (string) |

Agents that prefer declarative discovery use the HTML form instead of imperative tool calls.

---

## How It Works

```text
1. Agent visits agentbadge.xyz
   │
   ├── 2. Browser fetches /.well-known/webmcp.json
   │      → Manifest: { name, version, mcpEndpoint, namespaces, namespaceEndpoints }
   │      → Agent discovers all 6 tools + 1 declarative form
   │
   ├── 3. Page loads → navigator.modelContext.provideContext() registers tools
   │      → 6 imperative tools registered with input schemas + execute functions
   │      → Each tool maps to an HTTP endpoint (no extra setup)
   │
   └── 4. Agent calls a tool
          → Browser mediates the call (trust level enforced)
          → HTTP request to endpoint
          → Response returned to agent
          → No API keys, no authentication headers, no SDK
```

---

## Source Code — WebMCP Implementation

### WebMCP Manifest & Discovery

| File | Description |
|------|-------------|
| [`src/server/routes/well-known.ts`](src/server/routes/well-known.ts) (L1066-1096) | `GET /.well-known/webmcp.json` — WebMCP manifest endpoint with tool namespaces |
| [`src/views/landing/layout.ts`](src/views/landing/layout.ts) (L240-296) | WebMCP script injection — `navigator.modelContext.provideContext()` with 6 tool definitions |
| [`src/views/landing/readiness-landing-page.ts`](src/views/landing/readiness-landing-page.ts) (L42-105) | WebMCP script on readiness landing page — 3 tools (scan, badge, passport) |

### WebMCP Scanner Rules

| File | Rule | What It Checks |
|------|------|----------------|
| [`src/agent-readiness/rules/AB050.ts`](src/agent-readiness/rules/AB050.ts) | AB-050 | WebMCP manifest found at `/.well-known/webmcp.json` |
| [`src/agent-readiness/rules/AB051.ts`](src/agent-readiness/rules/AB051.ts) | AB-051 | WebMCP form annotations (`data-mcp` attributes) |
| [`src/agent-readiness/rules/AB069.ts`](src/agent-readiness/rules/AB069.ts) | AB-069 | WebMCP browser-side tools (`navigator.modelContext`) |
| [`src/agent-readiness/rules/AB102.ts`](src/agent-readiness/rules/AB102.ts) | AB-102 | WebMCP descriptor validation |
| [`src/agent-readiness/rules/AB103.ts`](src/agent-readiness/rules/AB103.ts) | AB-103 | WebMCP runtime probe |
| [`src/agent-readiness/rules/AB115.ts`](src/agent-readiness/rules/AB115.ts) | AB-115 | WebMCP tool schema validation |
| [`src/agent-readiness/rules/AB116.ts`](src/agent-readiness/rules/AB116.ts) | AB-116 | WebMCP content negotiation |

### WebMCP Scanner Fetchers

| File | Description |
|------|-------------|
| [`src/agent-readiness/scanner/fetchers/webmcp-fetcher.ts`](src/agent-readiness/scanner/fetchers/webmcp-fetcher.ts) | Fetches `/.well-known/webmcp.json` manifest |
| [`src/agent-readiness/scanner/fetchers/webmcp-runtime-fetcher.ts`](src/agent-readiness/scanner/fetchers/webmcp-runtime-fetcher.ts) | Probes page HTML for `navigator.modelContext` + `provideContext` + tool count |

### Scanner Integration

| File | Description |
|------|-------------|
| [`src/agent-readiness/scanner/orchestrator.ts`](src/agent-readiness/scanner/orchestrator.ts) | 41-fetcher parallel orchestrator — includes WebMCP fetchers |
| [`src/agent-readiness/rule-engine/rule-engine.ts`](src/agent-readiness/rule-engine/rule-engine.ts) | Rule evaluation engine — processes WebMCP rules |
| [`src/agent-readiness/rule-descriptions.ts`](src/agent-readiness/rule-descriptions.ts) | Rule descriptions (19 WebMCP-related entries) |
| [`src/agent-readiness/scoring/scoring-types.ts`](src/agent-readiness/scoring/scoring-types.ts) | Scoring types — includes `webmcp` category |

---

## Presentation & Artifacts

### 12-Slide Presentation

| File | Format | Description |
|------|--------|-------------|
| [`docs/hackathons/webmcp/presentation.pdf`](docs/hackathons/webmcp/presentation.pdf) | PDF | 12-slide presentation — system overview, tools, comparison, architecture |
| [`docs/hackathons/webmcp/presentation.html`](docs/hackathons/webmcp/presentation.html) | HTML | Source HTML for the presentation (open in browser) |

**Slides:**
1. Title — Agent-Native Compliance Platform Powered by WebMCP
2. The Problem — APIs require keys, MCP requires servers
3. WebMCP Solution — Browser-native tool discovery
4. How WebMCP Works — Discovery → Registration → Execution
5. 6 Imperative Tools — Overview
6. Tool Deep Dive — Scan, Badge, Passport
7. Declarative Form — HTML form-based access
8. WebMCP vs Traditional API — Comparison table
9. WebMCP vs Traditional MCP — Comparison table
10. Architecture — Hedera + IPFS + HCS + Mirror Node
11. Agent Experience — What an agent gets
12. Call to Action — Agent-Native Compliance Starts Here

### Screenshots (12)

All screenshots from `agentbadge.xyz` UI:

| # | File | Section |
|---|------|---------|
| 1 | [`screenshots/screenshot-01-hero.png`](docs/hackathons/webmcp/screenshots/screenshot-01-hero.png) | Hero section |
| 2 | [`screenshots/screenshot-02-full-page.png`](docs/hackathons/webmcp/screenshots/screenshot-02-full-page.png) | Full page view |
| 3 | [`screenshots/screenshot-03-imperative-tools.png`](docs/hackathons/webmcp/screenshots/screenshot-03-imperative-tools.png) | Imperative tools section |
| 4 | [`screenshots/screenshot-04-declarative-api.png`](docs/hackathons/webmcp/screenshots/screenshot-04-declarative-api.png) | Declarative API section |
| 5 | [`screenshots/screenshot-05-why-webmcp.png`](docs/hackathons/webmcp/screenshots/screenshot-05-why-webmcp.png) | Why WebMCP section |
| 6 | [`screenshots/screenshot-06-try-it-now.png`](docs/hackathons/webmcp/screenshots/screenshot-06-try-it-now.png) | Try it now section |
| 7 | [`screenshots/screenshot-07-discovery-endpoint.png`](docs/hackathons/webmcp/screenshots/screenshot-07-discovery-endpoint.png) | Discovery endpoint |
| 8 | [`screenshots/screenshot-08-dashboard.png`](docs/hackathons/webmcp/screenshots/screenshot-08-dashboard.png) | Dashboard |
| 9 | [`screenshots/screenshot-09-scanner.png`](docs/hackathons/webmcp/screenshots/screenshot-09-scanner.png) | Scanner |
| 10 | [`screenshots/screenshot-10-passports.png`](docs/hackathons/webmcp/screenshots/screenshot-10-passports.png) | Passports |
| 11 | [`screenshots/screenshot-11-discovery-manifest.png`](docs/hackathons/webmcp/screenshots/screenshot-11-discovery-manifest.png) | Discovery manifest |
| 12 | [`screenshots/screenshot-12-homepage.png`](docs/hackathons/webmcp/screenshots/screenshot-12-homepage.png) | Homepage |

### NotebookLM Artifacts

| File | Type | Description |
|------|------|-------------|
| [`notebooklm-artifacts/AgentBadge WebMCP Architecture and Strategy Guide.json`](docs/hackathons/webmcp/notebooklm-artifacts/AgentBadge%20WebMCP%20Architecture%20and%20Strategy%20Guide.json) | Mind Map | Architecture mind map |
| [`notebooklm-artifacts/AgentBadge WebMCP Implementation_ Strategic Briefing.md`](docs/hackathons/webmcp/notebooklm-artifacts/AgentBadge%20WebMCP%20Implementation_%20Strategic%20Briefing.md) | Report | Strategic briefing report |

> Video and audio artifacts are excluded from git due to size. Available locally in `docs/hackathons/webmcp/notebooklm-artifacts/`.

---

## Architecture

```text
┌─────────────────────────────────────────────────────────┐
│                    AI Agent (Browser)                    │
│                                                          │
│  1. Visit agentbadge.xyz                                 │
│  2. Browser fetches /.well-known/webmcp.json             │
│  3. navigator.modelContext.provideContext() registers    │
│     6 imperative tools + 1 declarative form              │
│  4. Agent calls tools → browser mediates HTTP            │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│              AgentBadge Server (Hono + Bun)              │
│                                                          │
│  WebMCP Manifest    →  GET /.well-known/webmcp.json      │
│  Tool Endpoints     →  /api/scan, /api/badge,            │
│                        /passport/request, etc.           │
│  Scanner (145+ rules) → 18 categories, 41 fetchers       │
│  WebMCP Scanner     →  AB-050, AB-051, AB-069,           │
│                        AB-102, AB-103, AB-115, AB-116    │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│              Hedera Testnet (HTS + HCS)                  │
│                                                          │
│  HTS  → NFT passports (identity, tier, capabilities)     │
│  HCS  → Audit trail + agent directory                    │
│  HBAR → Payment via x402 ($0.001/tx, 3-5s finality)      │
└─────────────────────────────────────────────────────────┘
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Bun ≥ 1.1 |
| Server | Hono |
| Frontend | HTMX + server-side rendering |
| Blockchain | Hedera HTS (NFT) + HCS (audit + directory) |
| WebMCP | `navigator.modelContext.provideContext()` |
| Scanner | 145+ rules, 18 categories, 41 parallel HTTP fetchers |
| Discovery | `/.well-known/webmcp.json` |

---

## Getting Started

```bash
# Install dependencies
bun install

# Set up environment
cp .env.example .env
# Fill in: Hedera operator key, IPFS API key, etc.

# Run dev server
bun run dev

# Server starts at http://localhost:4021
```

### Verify WebMCP is working

```bash
# Check WebMCP manifest
curl http://localhost:4021/.well-known/webmcp.json

# Check WebMCP runtime (should find navigator.modelContext in HTML)
curl http://localhost:4021/ | grep -o "modelContext"

# Scan agentbadge.xyz for WebMCP compliance
npx @agentgate-hedera/cli scan http://localhost:4021 --rule AB-050
npx @agentgate-hedera/cli scan http://localhost:4021 --rule AB-069
```

---

## What an Agent Gets When It Visits AgentBadge

1. **Compliance scanning** — Scan any website for 145+ AI readiness checks
2. **Identity verification** — Issue and verify on-chain agent passports (Hedera + EVM)
3. **Compliance badges** — Generate SVG badges for visual compliance indicators
4. **Rule search** — Search the full compliance rule library
5. **Score lookup** — Quick compliance score for any URL
6. **Declarative forms** — HTML form-based tool access for declarative agents
7. **Automatic discovery** — No manual setup — tools discovered via standard endpoint
8. **Browser-mediated security** — No API keys to manage — browser handles trust

---

## Branch Info

This README is specific to the `hackathon/webmcp-presentation` branch. The `main` branch contains the full AgentBadge README with all features (passport, marketplace, A2A messaging, MCP server, blog, etc.).

- **Hackathon branch:** `hackathon/webmcp-presentation` — WebMCP-focused README + presentation artifacts
- **Main branch:** `main` — Full AgentBadge platform README (unchanged)
