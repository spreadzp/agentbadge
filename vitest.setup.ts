/// <reference types="node" />
// Vitest global setup — set env vars for test environment
// Disable DID signature auth middleware (EPIC-83) for unit/integration tests
// Re-enable per-suite when testing auth behavior specifically
process.env.DID_AUTH_MODE = "off";
process.env.ALLOW_KEY_ENDPOINTS = "true";
// SLICE-169-9: most suites exercise Hedera chain features — default the
// gate ON for tests. Suites asserting disabled behavior unset it and
// call resetConfigCache() (see tests/admin-revoke.test.ts).
if (process.env.PASSPORT_CHAIN_ENABLED === undefined) {
  process.env.PASSPORT_CHAIN_ENABLED = "true";
}

// Load .env file for test environment (no dotenv dependency)
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
try {
    const envPath = resolve(process.cwd(), ".env");
    const envContent = readFileSync(envPath, "utf-8");
    for (const line of envContent.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx === -1) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        let value = trimmed.slice(eqIdx + 1).trim();
        // Strip matching surrounding quotes (dotenv semantics) —
        // KEEPERHUB_API_KEY="kh_…" must validate as kh_-prefixed.
        if (
          value.length >= 2 &&
          ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'")))
        ) {
          value = value.slice(1, -1);
        }
        if (!process.env[key]) process.env[key] = value;
    }
} catch {
    // .env not found — skip
}

// Placeholder values for the env vars getConfig() requires, so suites run in a
// fresh clone without a .env. `??=` keeps any value from the shell or .env above.
process.env.HEDERA_OPERATOR_ID ??= "0.0.1001";
process.env.HEDERA_OPERATOR_KEY ??= "302e020100300506032b657004220420" + "00".repeat(32);
process.env.PASSPORT_TOKEN_ID ??= "0.0.1002";
process.env.AUDIT_TOPIC_ID ??= "0.0.1003";
process.env.DIRECTORY_TOPIC_ID ??= "0.0.1004";
process.env.x402_FACILITATOR_URL ??= "https://facilitator.test.invalid";
process.env.x402_FEE_PAYER ??= "0.0.1005";
process.env.x402_TREASURY ??= "0.0.1006";
process.env.IPFS_API_KEY ??= "test-ipfs-key";
process.env.IPFS_API_SECRET ??= "test-ipfs-secret";
process.env.MOCK_HEDERA ??= "true";
process.env.MOCK_X402 ??= "true";
process.env.MOCK_IPFS ??= "true";

// Shim: @agentbadge/passport bundled CJS uses require("crypto")
// Provide global require for ESM interop in vitest
import { createRequire } from "node:module";
(globalThis as any).require = createRequire(import.meta.url);
