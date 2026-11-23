#!/usr/bin/env bun
// EPIC-262 (SLICE-262-0a): generate the intel Ed25519 signing pair.
// Prints env lines for fly secrets / .env plus the public key that
// /.well-known/agentbadge-keys.json will publish. The private seed
// never enters the repo — copy the output into the secret store.
//
//   bun scripts/intel-keygen.mts [key_id]
import { generateSigningKey } from "../src/agent-readiness/integrity/key-manager";

const keyId = process.argv[2] ?? `intel-${new Date().toISOString().slice(0, 10)}`;
const key = generateSigningKey(keyId);

const privB64 = Buffer.from(key.privateKey).toString("base64");
const pubB64 = Buffer.from(key.publicKey).toString("base64");

console.log(`# Intel signing key "${keyId}" — keep the private line secret`);
console.log(`INTEL_ENABLED=true`);
console.log(`INTEL_KEY_ID=${keyId}`);
console.log(`INTEL_SIGNING_PRIVATE_KEY=${privB64}`);
console.log(`# public (for verification — matches well-known doc):`);
console.log(`# ${pubB64}`);
