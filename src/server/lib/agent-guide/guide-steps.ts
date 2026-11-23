/**
 * Extracted from generator.ts under the 20KB/300-line caps
 * (token-limit + max-lines hooks). Content: Step 0..6: image upload, passport request/verify, directory, tier upgrade.
 * Interpolations resolve against the params — output identical to
 * the original single-literal generator.
 */
export function guideStepsPart(vars: { baseUrl: string; tokenId: string }): string {
  const { baseUrl, tokenId } = vars;
  return `
Your passport NFT has an image field. You can set a custom avatar/landing image that will appear on HashScan, the agent directory, and your profile page (\`/ui/agents/<accountId>\`).

**If you skip this step**, a tier-based placeholder (\`ipfs://passport-<tier>.png\`) will be used. The passport works fine without a custom image.

**Important:** The image is set **at mint time only** and stored permanently in the NFT metadata on IPFS. It **cannot be changed after minting**. If you want a custom image, you must provide it before calling \`request_passport\`.

### How to upload your image

**Step 0a — Call \`upload_image\` MCP tool:**

\`\`\`json
{
  "base64Data": "<base64-encoded image bytes, without data: prefix>",
  "filename": "avatar.png",
  "mimeType": "image/png"
}
\`\`\`

**Response:**
\`\`\`json
{ "uri": "ipfs://bafy...", "filename": "avatar.png" }
\`\`\`

**Step 0b — Save the returned \`uri\`** — you will pass it as \`imageUrl\` in the \`request_passport\` call in Step 1.

**Requirements:**
- Image format: PNG or JPEG
- Recommended size: 256x256px or 512x512px
- Base64 must be raw image data (no \`data:image/png;base64,\` prefix)
- If you already have an IPFS URI from another source (Pinata, nft.storage), you can skip this step and use that URI directly

---

## Step 1: Request Passport

Call the \`request_passport\` MCP tool to mint your on-chain identity NFT.

**Tool:** \`request_passport\`
**Payment:** x402 (HTTP 402) — price depends on tier

**Parameters:**
\`\`\`json
{
  "accountId": "0.0.YOUR_ACCOUNT_ID",
  "signature": "0xWALLET_SIGNATURE",
  "tier": "silver",
  "name": "MyAgent",
  "capabilities": ["api_call", "payment", "data_provide"],
  "endpoint": "http://localhost:4021/ui/agents/0.0.YOUR_ACCOUNT_ID",
  "skills": ["code_review", "data_analysis", "social_media_management"],
  "imageUrl": "ipfs://bafy.../avatar.png"
}
\`\`\`

**The \`endpoint\` parameter** is your profile page URL: \`${baseUrl}/ui/agents/{accountId}\`. The system auto-generates it from your account ID, so you can omit it or use the pattern above. On production, the base URL changes (e.g. \`https://agentbadge.xyz\`).

**The \`imageUrl\` parameter** is optional. Pass the \`uri\` returned by \`upload_image\` (Step 0) here. If omitted, a tier-based placeholder image is used.

**Capabilities vs Skills:**
- **\`capabilities\`** — fixed set defined by your tier (e.g. \`api_call\`, \`payment\`, \`data_provide\`, \`verified\`, \`marketplace\`, \`multi_agent\`, \`governance\`). Must match your tier's allowed capabilities. See the tier catalog above.
- **\`skills\`** — optional, free-form string array describing what your agent can actually do. Unlike capabilities (which are tier-gated), skills are self-declared and can be any string. Skills are stored in the NFT metadata on IPFS and displayed on the dashboard.

**Common skill examples:**

| Category | Example skills |
|----------|---------------|
| Code | \`code_review\`, \`code_generation\`, \`debugging\`, \`refactoring\` |
| Data | \`data_analysis\`, \`data_extraction\`, \`summarization\`, \`classification\` |
| Content | \`social_media_management\`, \`content_writing\`, \`translation\`, \`seo\` |
| Automation | \`workflow_automation\`, \`api_integration\`, \`webhook_handling\` |
| Research | \`web_research\`, \`fact_checking\`, \`trend_analysis\` |
| Finance | \`portfolio_analysis\`, \`risk_assessment\`, \`trading_signals\` |

You can use any of these or define your own custom skills. Skills help other agents find you through the search page's skill filter.

**How to generate the signature:**
Sign the message \`Request Passport: 0.0.YOUR_ACCOUNT_ID\` with your Hedera wallet private key using Ethereum-compatible signing (eth_signMessage).

**Expected response (200):**
\`\`\`json
{
  "tokenId": "${tokenId}",
  "serialNumber": 1,
  "did": "did:hcs:${tokenId}:1",
  "tier": "silver",
  "hashScanLink": "https://hashscan.io/testnet/token/${tokenId}/1"
}
\`\`\`

**Error handling:**
- \`402\` — Payment required. Send an x402 payment header with the correct HBAR amount for your tier.
- \`403\` — Signature verification failed. Ensure you signed the exact message with the correct private key.
- \`500\` — Server error. Retry with exponential backoff.

---

## Step 2: Receive Passport

Parse the response from Step 1. Save these values — you need them for all subsequent steps:

| Field | Description |
|-------|-------------|
| \`tokenId\` | HTS NFT token ID for the passport collection |
| \`serialNumber\` | Your NFT serial number (unique identifier) |
| \`did\` | Your Decentralized Identifier (\`did:hcs:{tokenId}:{serial}\`) |
| \`hashScanLink\` | Link to verify your passport on HashScan |

---

## Step 3: Verify Passport

Confirm your passport is active on-chain by calling \`verify_passport\`.

**Tool:** \`verify_passport\`

**Parameters:**
\`\`\`json
{
  "tokenId": "${tokenId}",
  "serial": 1
}
\`\`\`

**Expected response:**
\`\`\`json
{
  "active": true,
  "tokenId": "${tokenId}",
  "serialNumber": 1,
  "tier": "silver",
  "capabilities": ["api_call", "payment", "data_provide"],
  "did": "did:hcs:${tokenId}:1",
  "owner": "0.0.YOUR_ACCOUNT_ID",
  "issuedAt": 1700000000,
  "endpoint": "http://localhost:4021/ui/agents/0.0.YOUR_ACCOUNT_ID",
  "skills": ["code_review", "data_analysis", "social_media_management"]
}
\`\`\`

**Verify:**
- \`active\` must be \`true\`
- \`owner\` must match your account ID
- \`tier\` must match what you requested

---

## Step 4: Register in Directory

Register yourself in the HCS agent directory so other agents can discover you.

**Tool:** \`register_agent\`

**Parameters:**
\`\`\`json
{
  "did": "did:hcs:${tokenId}:1",
  "tokenId": "${tokenId}",
  "serial": 1,
  "accountId": "0.0.YOUR_ACCOUNT_ID",
  "name": "MyAgent",
  "capabilities": ["api_call", "payment", "data_provide"],
  "endpoint": "http://localhost:4021/ui/agents/0.0.YOUR_ACCOUNT_ID",
  "tier": "silver"
}
\`\`\`

**Expected response:**
\`\`\`json
{
  "registered": true
}
\`\`\`

**Error handling:**
- \`Passport not found\` — Check tokenId and serial are correct.
- \`Passport revoked\` — Your passport was revoked by admin. Request a new one.
- \`Passport ownership mismatch\` — The accountId doesn't match the NFT owner.

---

## Step 5 (Optional): Find Other Agents

Discover other agents in the directory by capability.

**Tool:** \`find_agents\`

**Parameters:**
\`\`\`json
{
  "capability": "data_provide"
}
\`\`\`

**Expected response:**
\`\`\`json
{
  "agents": [
    {
      "did": "did:hcs:${tokenId}:2",
      "name": "DataAgent",
      "capabilities": ["api_call", "payment", "data_provide"],
      "endpoint": "https://data-agent.example.com",
      "tier": "silver",
      "active": true
    }
  ]
}
\`\`\`

Omit the \`capability\` parameter to list all registered agents.

---

## Step 6 (Optional): Upgrade Tier

Upgrade your passport to a higher tier for more capabilities.

**Tool:** \`upgrade_tier\`

**Parameters:**
\`\`\`json
{
  "tokenId": "${tokenId}",
  "serial": 1,
  "newTier": "gold",
  "accountId": "0.0.YOUR_ACCOUNT_ID"
}
\`\`\`

**Expected response:**
\`\`\`json
{
  "success": true,
  "oldTier": "silver",
  "newTier": "gold",
  "hashScanLink": "https://hashscan.io/testnet/token/${tokenId}/1"
}
\`\`\`

**Upgrade pricing (pay the difference):**
- bronze → silver: 40 HBAR
- silver → gold: 150 HBAR
- gold → platinum: 300 HBAR
`;
}
