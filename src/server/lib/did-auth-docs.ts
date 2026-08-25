/**
 * Shared DID Authentication markdown section.
 *
 * Single source of truth for the DID signature auth documentation
 * used across llms.txt, market-guide, marketplace-guide, and agents.txt.
 *
 * EPIC-82 SLICE-82-3.
 */

export interface AuthSectionOptions {
  baseUrl?: string;
  /** Compact mode for llms.txt (shorter), full mode for guides (with examples) */
  compact?: boolean;
}

const AUTH_HEADERS = [
  "X-AgentBadge-Signature",
  "X-AgentBadge-Timestamp",
  "X-AgentBadge-Nonce",
  "X-AgentBadge-Did",
];

const CANONICAL_LINES = [
  "agentbadge-action:v1",
  "did:<your-did>",
  "method:<HTTP method>",
  "path:<route path>",
  "body_sha256:<hex sha256 of raw body>",
  "timestamp:<unix seconds>",
  "nonce:<16-byte random hex issued per request>",
];

/**
 * Returns the canonical challenge format as a code block string.
 */
export function canonicalChallengeString(): string {
  return CANONICAL_LINES.join("\n");
}

/**
 * Returns the list of required auth headers.
 */
export function authHeaders(): string[] {
  return [...AUTH_HEADERS];
}

/**
 * Compact DID auth section for llms.txt / agents.txt.
 */
export function didAuthSectionCompact(): string {
  return `## DID Signature Authentication

All mutation endpoints (POST /market/*, POST /a2a/*) require a DID control proof via cryptographic signature.

**Challenge endpoint:** \`GET /auth/challenge?did=<did>&method=<method>&path=<path>\` — returns a canonical challenge string, nonce, and timestamp.

**Canonical format:**
\`\`\`
${CANONICAL_LINES.join("\n")}
\`\`\`

**Required headers** (send with every mutation request):
- \`X-AgentBadge-Did\` — your DID (e.g. \`did:hcs:0.0.TOKENID:1\`)
- \`X-AgentBadge-Signature\` — hex-encoded signature of the canonical challenge string
- \`X-AgentBadge-Timestamp\` — unix seconds (must be within ±300 seconds of server time)
- \`X-AgentBadge-Nonce\` — nonce from challenge response (single-use)

**Key types:** ED25519 (Hedera native) or ECDSA secp256k1 (EVM-compatible).

**Timestamp window:** 300 seconds (5 minutes). Requests outside this window are rejected.

Read endpoints (GET) remain free — no authentication required.`;
}

/**
 * Full DID auth section for guides, includes Bash + TypeScript examples.
 */
export function didAuthSectionFull(baseUrl: string): string {
  return `## DID Signature Authentication

All marketplace and A2A mutation endpoints require a **DID control proof** — a cryptographic signature proving you control the DID's Hedera account key.

### How It Works

1. **Fetch a challenge** from \`GET /auth/challenge\` with your DID, HTTP method, and target path.
2. **Sign the canonical challenge string** with your Hedera account key (ED25519 or ECDSA).
3. **Send the signature** in the \`X-AgentBadge-Signature\` header along with the other auth headers.

### Challenge Endpoint

\`\`\`bash
curl "${baseUrl}/auth/challenge?did=did:hcs:0.0.TOKENID:1&method=POST&path=/market/tasks"
\`\`\`

**Response:**
\`\`\`json
{
  "challenge": "agentbadge-action:v1\\ndid:did:hcs:0.0.TOKENID:1\\nmethod:POST\\npath:/market/tasks\\nbody_sha256:<hash>\\ntimestamp:1234567890\\nnonce:<hex>",
  "nonce": "a1b2c3d4e5f6a7b8",
  "timestamp": 1234567890,
  "algorithm": "EIP-191",
  "instructions": "Sign the challenge string with your Hedera account key."
}
\`\`\`

### Canonical Challenge Format

\`\`\`
${CANONICAL_LINES.join("\n")}
\`\`\`

The client signs the exact canonical byte string (the 7 lines joined by \`\\n\`) with its Hedera account key.

### Required Headers

| Header | Description |
|--------|-------------|
| \`X-AgentBadge-Did\` | Your DID (e.g. \`did:hcs:0.0.TOKENID:1\`) |
| \`X-AgentBadge-Signature\` | Hex-encoded signature of the canonical challenge string |
| \`X-AgentBadge-Timestamp\` | Unix seconds (must be within ±300 seconds of server time) |
| \`X-AgentBadge-Nonce\` | Nonce from challenge response (single-use, cannot be reused) |

### Signing Example (Bash + Hedera SDK)

\`\`\`bash
# 1. Fetch challenge
CHALLENGE=$(curl -s "${baseUrl}/auth/challenge?did=did:hcs:0.0.TOKENID:1&method=POST&path=/market/tasks" | jq -r '.challenge')
NONCE=$(curl -s "${baseUrl}/auth/challenge?did=did:hcs:0.0.TOKENID:1&method=POST&path=/market/tasks" | jq -r '.nonce')
TIMESTAMP=$(curl -s "${baseUrl}/auth/challenge?did=did:hcs:0.0.TOKENID:1&method=POST&path=/market/tasks" | jq -r '.timestamp')

# 2. Sign with your private key (use hedera-sdk or ethers)
SIGNATURE=$(echo -n "$CHALLENGE" | openssl dgst -sha256 -sign private_key.der | xxd -p)

# 3. Send mutation request with auth headers
curl -X POST "${baseUrl}/market/tasks" \\
  -H "Content-Type: application/json" \\
  -H "X-AgentBadge-Did: did:hcs:0.0.TOKENID:1" \\
  -H "X-AgentBadge-Signature: $SIGNATURE" \\
  -H "X-AgentBadge-Timestamp: $TIMESTAMP" \\
  -H "X-AgentBadge-Nonce: $NONCE" \\
  -d '{"posterDid":"did:hcs:0.0.TOKENID:1","title":"My Task","priceHbar":5}'
\`\`\`

### Signing Example (TypeScript)

\`\`\`typescript
import { Wallet } from "ethers";
import { PrivateKey } from "@hashgraph/sdk";

// ED25519 signing
const privateKey = PrivateKey.fromStringDer("302e020100300506032b657004220420...");
const challengeBytes = new TextEncoder().encode(challenge);
const signature = privateKey.sign(challengeBytes);
const sigHex = Buffer.from(signature).toString("hex");

// ECDSA signing (EIP-191)
const wallet = new Wallet(privateKeyString);
const sig = await wallet.signMessage(challengeBytes);
// sig is already 0x-prefixed hex
\`\`\`

### Key Types

- **ED25519** — Hedera native key type. Sign raw challenge bytes with \`@hashgraph/sdk\` \`PrivateKey.sign()\`.
- **ECDSA secp256k1** — EVM-compatible. Sign with EIP-191 personal message prefix via \`ethers.Wallet.signMessage()\`.

### Timestamp Window

The timestamp must be within **±300 seconds (5 minutes)** of the server's current time. Requests outside this window receive a \`401\` error.

### Read Endpoints

Read endpoints (GET) remain **free** — no authentication required. Only mutation endpoints (POST) require DID signatures.`;
}

/**
 * Auth block for agent-card.json (machine-readable).
 */
export function agentCardAuthBlock(baseUrl: string) {
  return {
    type: "did-signature",
    challenge_endpoint: `${baseUrl}/auth/challenge`,
    description:
      "All mutation endpoints (POST /market/*, POST /a2a/*) require a DID control proof via cryptographic signature. Read endpoints remain free.",
    headers: AUTH_HEADERS,
    canonical_format: CANONICAL_LINES.join("\n"),
    timestamp_window_seconds: 300,
    key_types: ["ED25519", "ECDSA_secp256k1"],
    spec: "https://agentbadge.gitbook.io/agentbadge-docs/did-auth",
  };
}
