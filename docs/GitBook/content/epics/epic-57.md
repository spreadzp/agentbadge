# EPIC-57: GitBook MCP Integration

## Goal

Enable programmatic interaction with GitBook documentation from local IDE and external AI agents via MCP server and REST API.

## Three Levels

### Level 1: Git Sync + Built-in MCP + Curl (Current)

- **Reading**: GitBook built-in MCP server at `{docs-url}/~gitbook/mcp` (read-only)
- **Writing**: Git push (primary) or GitBook API v1 via curl (programmatic)
- **Setup**: Enable MCP in GitBook settings, get developer token from account page

### Level 2: MCP Tools in AgentBadge Server (Planned)

- Add GitBook tools to existing MCP server (`hackathon/server/src/mcp/`)
- Tools: `gitbook_search`, `gitbook_get_page`, `gitbook_update_page`, `gitbook_create_page`
- Authentication: simple API key whitelist via env var
- 6 slices, ~13h effort

### Level 3: Hedera Signature + Passport Tiers (Future)

- Replace API key with Hedera cryptographic signature verification
- Use existing passport NFT system for tier-based access control
- Bronze = read, Silver = read + comment, Gold = read + write, Platinum = full admin
- 4 slices, ~11h effort

## Source

- [EPIC-57 full document](https://github.com/agents-ai/hedera/blob/main/docs/EPICS/57-gitbook-mcp-integration/EPIC-57-gitbook-mcp-integration.md)
