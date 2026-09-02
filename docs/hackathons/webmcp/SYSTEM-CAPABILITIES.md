# AgentBadge System Capabilities — WebMCP Integration

## Overview
AgentBadge is the first agent-native compliance platform powered by WebMCP. It exposes 6 imperative tools and 1 declarative form through the browser's native `document.modelContext` interface. AI agents discover and use AgentBadge without leaving the page — no API keys, no MCP server setup, no manual configuration.

## How It Works

### Discovery
Agents discover available tools automatically via the WebMCP discovery endpoint at `/.well-known/webmcp.json`. This manifest lists all available tools with their endpoints, permissions, and descriptions. The browser mediates all tool calls — agents never need API keys or authentication tokens.

### Tool Registration
When a browser implements `document.modelContext`, the inject script automatically registers all 6 tools. The page is spec-ready today — all endpoints work as standard HTTP APIs, and will work natively via WebMCP when browsers implement the spec.

## The 6 Imperative Tools

### 1. agent-readiness-scan (readOnly, untrusted)
- **Endpoint:** `GET /api/scan?url=`
- **What it does:** Scans any website for AI agent readiness compliance. Returns a compliance score (0-100), grade (A-F), and detailed list of 145+ checks across 18 categories.
- **Agent capability:** An agent can scan any website to check if it's ready for AI agent interaction — robots.txt, llms.txt, agents.txt, OpenAPI, WebMCP, content negotiation, SEO/AEO, and more.

### 2. badge-generate (readOnly, trusted)
- **Endpoint:** `GET /api/badge?url=`
- **What it does:** Generates a compliance badge SVG for a given URL and score.
- **Agent capability:** An agent can generate a visual compliance badge to display on a website or include in reports.

### 3. passport-issue (write, trusted)
- **Endpoint:** `POST /passport/request`
- **What it does:** Issues an AgentBadge passport NFT for a given account on Hedera blockchain.
- **Agent capability:** An agent can mint an on-chain identity passport for itself or another agent, establishing verifiable identity on the Hedera network.

### 4. passport-verify (readOnly, trusted)
- **Endpoint:** `GET /api/passport/verify?tokenId=`
- **What it does:** Verifies an AgentBadge passport by token ID or DID. Returns on-chain identity, metadata, and verification status.
- **Agent capability:** An agent can verify another agent's identity by checking their passport on-chain — supporting both Hedera (`did:hcs:`) and EVM (`did:eip155:`) DIDs.

### 5. get-compliance-score (readOnly, untrusted)
- **Endpoint:** `GET /api/score?url=`
- **What it does:** Returns the agent readiness compliance score (0-100) and grade (A-F) for a given URL.
- **Agent capability:** An agent can quickly check any website's compliance score without the full scan details.

### 6. search-rules (readOnly, trusted)
- **Endpoint:** `GET /api/rules/search?q=`
- **What it does:** Searches agent readiness rules by keyword. Returns matching rule definitions with IDs, categories, and descriptions.
- **Agent capability:** An agent can search through 145+ compliance rules to understand what checks are performed and how to comply.

## The Declarative Form API

### submitScanRequest
- **Action:** `/api/scan`
- **Method:** GET
- **Input:** url (string)
- **What it does:** Submit a scan request via HTML form. The agent fills the form and the browser submits it.
- **Agent capability:** Agents that prefer declarative discovery can use the HTML form instead of imperative tool calls.

## WebMCP vs Traditional API — Key Differences

| Feature | Traditional API | WebMCP (AgentBadge) |
|---|---|---|
| Discovery | Manual docs reading | Automatic via `/.well-known/webmcp.json` |
| Authentication | API keys, OAuth tokens | Browser-mediated, no keys needed |
| Integration | SDK setup, config files | Zero integration — browser native |
| Security | Developer manages secrets | Browser mediates all calls |
| Trust model | All-or-nothing access | Per-tool trust levels (trusted/untrusted) |
| Agent experience | Read docs, get keys, write code | Discover tools, call directly |

## WebMCP vs Traditional MCP (Model Context Protocol)

| Feature | Traditional MCP | WebMCP (AgentBadge) |
|---|---|---|
| Setup | MCP server installation | Zero setup — browser native |
| Transport | stdio or SSE | HTTP endpoints via browser |
| Discovery | Manual server config | `/.well-known/webmcp.json` auto-discovery |
| Security | Developer manages permissions | Browser-mediated trust levels |
| Agent access | Requires MCP client | Any agent with browser access |
| Tool registration | Server-side code | `document.modelContext.registerTool()` |

## What an Agent Gets When It Visits AgentBadge

1. **Compliance scanning:** Scan any website for 145+ AI readiness checks
2. **Identity verification:** Issue and verify on-chain agent passports (Hedera + EVM)
3. **Compliance badges:** Generate SVG badges for visual compliance indicators
4. **Rule search:** Search the full compliance rule library
5. **Score lookup:** Quick compliance score for any URL
6. **Declarative forms:** HTML form-based tool access for declarative agents
7. **Automatic discovery:** No manual setup — tools are discovered via standard endpoint
8. **Browser-mediated security:** No API keys to manage — browser handles trust

## Architecture

- **Frontend:** Hono-based web server serving pages and API endpoints
- **Blockchain:** Hedera (testnet/mainnet) for passport NFTs, EVM chain support (Base Sepolia)
- **DID support:** `did:hcs:` (Hedera) and `did:eip155:` (EVM)
- **Scoring:** 18 categories, 145+ rules, 4 pillars (Discovery, Understandability, Executability, Verifiability)
- **Compliance grades:** A (90+), B (80+), C (70+), D (60+), F (<60)
