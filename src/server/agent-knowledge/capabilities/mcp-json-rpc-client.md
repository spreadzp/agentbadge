# MCP JSON-RPC Client

## What Is the MCP JSON-RPC Client?

The AgentBadge MCP JSON-RPC client is a minimal, dependency-free implementation of the MCP client side of the protocol — `initialize`, `tools/list`, and `tools/call` over Streamable HTTP (JSON-RPC 2.0 POST + SSE GET). It was built and battle-tested against SaSame GEC's live provider path during the October 2026 interoperability field report.

## What Was Verified

The client was exercised end-to-end against a production MCP server with no SDK — roughly 600 lines of TypeScript:

1. **`initialize`** — protocol handshake, capability negotiation
2. **`tools/list`** — tool discovery from the server manifest
3. **`tools/call`** — authenticated invocation (`gec_bid_submit` → bid accepted, `SUBMITTED` state)
4. **SSE stream** — `GET` with `Accept: text/event-stream` for server-pushed messages

The full flow — keyless open-demands projection, CIMD-based OAuth 2.1 PKCE, EIP-191 wallet verification, Account-Control consent, token exchange, authenticated User MCP session — completed in one script with $0 gas.

## Why It Matters

Most MCP clients are SDK wrappers. A hand-rolled JSON-RPC client proves the protocol is implementable from the spec alone — which is exactly the property AgentBadge scans for in customer APIs: can an agent integrate without reading prose documentation?

## Related

- [MCP](/agent-guide/concepts/mcp) — The protocol and our server surface
- [GEC Interop Field Report](/blog/gec-interop-field-report) — The full interoperability write-up
- [Agent Interop](/agent-guide/articles/arc-c40-agent-interop) — Cross-protocol agent communication
