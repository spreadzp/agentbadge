/// <reference types="node" />
// Vitest global setup — set env vars for test environment
// Disable DID signature auth middleware (EPIC-83) for unit/integration tests
// Re-enable per-suite when testing auth behavior specifically
process.env.DID_AUTH_MODE = "off";
process.env.ALLOW_KEY_ENDPOINTS = "true";
