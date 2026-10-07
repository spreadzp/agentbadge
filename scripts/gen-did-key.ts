#!/usr/bin/env bun
/**
 * SLICE-178-7 (MYPROJ-2587): one-shot DID signing key generator.
 *
 * Generates an Ed25519 keypair for the platform did:web identity and
 * prints the values to put in .env. The private key NEVER leaves this
 * script — it is a separate role from money/verdict keys (EPIC-173
 * authority-split): compromise of DID_SIGNING_KEY lets an attacker
 * sign domain-linkage claims, never spend funds.
 *
 * Usage:  bun run scripts/gen-did-key.ts
 */

import { generateKeyPair, exportPKCS8, exportJWK } from "jose";

async function main() {
  const { privateKey, publicKey } = await generateKeyPair("Ed25519", {
    extractable: true,
  });

  // Single-line base64 PKCS8 — env-friendly (no PEM newlines).
  const pem = await exportPKCS8(privateKey);
  const b64 = pem
    .replace(/-----[A-Z ]+-----/g, "")
    .replace(/\s+/g, "");
  const jwk = await exportJWK(publicKey);

  console.log("# DID_SIGNING_KEY (Ed25519 PKCS8, base64 — single line):");
  console.log(`DID_SIGNING_KEY=${b64}`);
  console.log();
  console.log("# Public JWK (verifiable, safe to publish):");
  console.log(JSON.stringify({ ...jwk, kid: "agentbadge-2026-1" }, null, 2));
  console.log();
  console.log("Store DID_SIGNING_KEY in .env / secrets manager ONLY.");
  console.log("Rotation: re-run this script, bump kid agentbadge-YYYY-N,");
  console.log("keep the OLD key's verificationMethod in did.json until");
  console.log("the old did-configuration VC-JWT exp (+1y) lapses.");
}

main().catch((err) => {
  console.error("gen-did-key failed:", err);
  process.exit(1);
});
