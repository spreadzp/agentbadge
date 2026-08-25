# Installation

## Prerequisites

- **Bun ≥ 1.1** — TypeScript runtime & package manager ([install](https://bun.sh))
- **Git** — version control
- **Hedera Testnet Account** — get free testnet HBAR at [portal.hedera.com](https://portal.hedera.com)
- **IPFS API Key** — sign up at [Pinata](https://pinata.cloud) for free IPFS storage

## Steps

1. **Clone the repository:**

```bash
git clone https://github.com/spreadzp/agentbadge.git
cd agentbadge
```

2. **Install dependencies:**

```bash
cd hackathon/server
bun install
```

3. **Set up environment variables:**

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

| Variable | Description |
|----------|-------------|
| `HEDERA_OPERATOR_ID` | Your Hedera testnet account ID (e.g. `0.0.5266613`) |
| `HEDERA_OPERATOR_KEY` | Your Hedera private key (DER-encoded hex) |
| `IPFS_API_KEY` | Pinata API key for IPFS uploads |
| `IPFS_API_SECRET` | Pinata API secret |
| `PASSPORT_TOKEN_ID` | HTS token ID for passports (created once via setup script) |
| `AUDIT_TOPIC_ID` | HCS topic for audit trail |
| `DIRECTORY_TOPIC_ID` | HCS topic for agent directory |
| `A2A_TOPIC_ID` | HCS topic for A2A messaging |
| `MARKET_TOPIC_ID` | HCS topic for marketplace |

4. **Run the dev server:**

```bash
bun run dev
```

5. **Verify:** Open `http://localhost:4021` in your browser.

{% hint style="info" %}
For Hedera testnet account setup, see `hedera-testnet-setup/` in the repository root. It contains scripts to create tokens, topics, and configure your testnet environment.
{% endhint %}

## Optional: Start MCP Server

In a separate terminal:

```bash
bun run mcp
```

This starts the MCP server (stdio mode) for Claude/Cursor/Windsurf integration.

## Optional: Start Hermes Demo Agent

```bash
bun run hermes
```

Hermes runs on port 4030 and registers itself in the agent directory.

## Docker

```bash
docker build -f Dockerfile -t agentbadge:latest .
docker run -d --name agentbadge --env-file .env -p 4021:4021 agentbadge:latest
```
