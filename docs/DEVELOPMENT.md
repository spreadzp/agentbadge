# Development Guide

## Architecture

The server consumes three npm-published packages under the `@agentgate-hedera` scope:

```text
@agentgate-hedera/hedera-core   ← Hedera SDK wrapper, Mirror Node, types
@agentgate-hedera/passport       ← Passport service, caches (directory, A2A, marketplace)
@agentgate-hedera/mcp            ← MCP tools (20 tools)
```

Dependency chain:

```text
hedera-core  ←  passport  ←  mcp
                 ↑
            server (this project)
```

All three are installed from npm registry — no local `file:` references in the published repo.

## Commands

| Command | Description |
|---------|-------------|
| `bun run dev` | Dev server with watch mode |
| `bun run typecheck` | Type checking (tsc --noEmit) |
| `bun run test` | Run tests (Vitest) |
| `bun run test:watch` | Tests in watch mode |
| `bun run test:coverage` | Tests with coverage report |
| `bun run lint` | ESLint |
| `bun run format` | Prettier formatting |
| `bun run mcp` | Start MCP server (stdio) |
| `bun run hermes` | Start Hermes demo agent |
| `bun run demo:full-flow` | Run full flow demo |
| `bun run demo:medical-marketplace` | Run medical marketplace demo |

## Getting Started

```bash
# 1. Clone the repository
git clone <repo-url>
cd agentgate

# 2. Install dependencies (npm packages)
bun install

# 3. Set up environment
cp .env.example .env
# Edit .env with your Hedera operator key, IPFS API key, etc.

# 4. Run dev server
bun run dev
# Server available at http://localhost:4021

# 5. (Optional) Start MCP server in another terminal
bun run mcp
# MCP server ready for Claude/Cursor connection
```

## Docker

The Dockerfile always builds with npm packages (production mode):

```dockerfile
FROM oven/bun:1.2
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --production --frozen-lockfile

COPY src ./src
COPY public ./public

EXPOSE 4021
CMD ["bun", "src/server/index.ts"]
```

The container pulls npm packages during `bun install`. Local `packages/` directory is not needed inside the container.

### Build and run locally

```bash
# Ensure package.json uses npm versions (not file: references)
# Ensure bun.lock is up to date (run `bun install` before building)

docker build -f Dockerfile -t agentgate:latest .

docker run -d --name agentgate \
  --env-file .env \
  -p 4021:4021 \
  agentgate:latest

# Verify
curl -s http://localhost:4021/catalog | python3 -m json.tool
curl -s http://localhost:4021/agents | python3 -m json.tool
curl -s http://localhost:4021/market/tasks | python3 -m json.tool

# Stop
docker stop agentgate && docker rm agentgate
```

## Environment Variables

The server requires a `.env` file with the following variables:

```bash
# Hedera
HEDERA_OPERATOR_ID=0.0.xxxxx
HEDERA_OPERATOR_KEY=302e020100...
HEDERA_NETWORK=testnet

# Passport token (created once via setup script)
PASSPORT_TOKEN_ID=0.0.xxxxx
AUDIT_TOPIC_ID=0.0.xxxxx
DIRECTORY_TOPIC_ID=0.0.xxxxx
A2A_TOPIC_ID=0.0.xxxxx
MARKET_TOPIC_ID=0.0.xxxxx

# x402 Payment
x402_FACILITATOR_URL=https://api.testnet.blocky402.com
x402_FEE_PAYER=0.0.xxxxx
x402_TREASURY=0.0.xxxxx

# IPFS (nft.storage)
IPFS_API_KEY=xxx
IPFS_API_SECRET=xxx

# Server
PORT=4021
BASE_URL=http://localhost:4021

# Mock mode (skip Hedera SDK init for local dev)
# MOCK_HEDERA=true
```

## NPM Packages

The project uses three published npm packages under the `@agentgate-hedera` scope:

```bash
npm install @agentgate-hedera/hedera-core
npm install @agentgate-hedera/passport
npm install @agentgate-hedera/mcp
```

### Updating internal packages

If you need to update the internal packages (e.g., after publishing a new version):

```bash
# Update version in package.json
# e.g., change "@agentgate-hedera/hedera-core": "^0.1.5" to "^0.1.6"

# Reinstall
bun install

# Verify
bun run typecheck
bun run test
```

### Signature-Based Payment Flow (for external agents)

```typescript
import { signTransactionBytes } from "@agentgate-hedera/hedera-core";

// 1. MCP: prepare_payment(taskId, posterDid) → { txBytes, txId, ... }

// 2. Sign locally — private key never leaves the agent
const { publicKey, signature } = await signTransactionBytes(txBytes, privateKeyDer);
// signature = JSON array of base64 strings (one per inner transaction)

// 3. MCP: complete_task(taskId, posterDid, txBytes, publicKey, signature)
//    → Server attaches signatures + submits to Hedera → HBAR transferred
```

## Known Limitations

- **Tests with npm packages**: `vi.mock("@agentgate-hedera/hedera-core")` does not intercept calls from minified bundles inside `passport`. This is a known limitation of using published npm packages instead of local source.
- **Docker**: Always uses npm packages (production). No access to local `packages/` directory inside the container.
