/// <reference types="node" />
// Vitest global setup — set env vars for test environment
// Disable DID signature auth middleware (EPIC-83) for unit/integration tests
// Re-enable per-suite when testing auth behavior specifically
process.env.DID_AUTH_MODE = "off";
process.env.ALLOW_KEY_ENDPOINTS = "true";

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
        const value = trimmed.slice(eqIdx + 1).trim();
        if (!process.env[key]) process.env[key] = value;
    }
} catch {
    // .env not found — skip
}

// Shim: @agentbadge/passport bundled CJS uses require("crypto")
// Provide global require for ESM interop in vitest
import { createRequire } from "node:module";
(globalThis as any).require = createRequire(import.meta.url);
