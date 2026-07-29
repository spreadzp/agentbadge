#!/usr/bin/env bun
/**
 * agentgate-sign — Standalone transaction signing CLI
 *
 * Signs frozen Hedera transaction bytes locally without any network calls.
 * Private key never leaves the machine.
 *
 * Usage:
 *   bun scripts/sign-transaction.ts --tx-bytes <BASE64> --key <HEX|DER>
 *   bun scripts/sign-transaction.ts --tx-bytes <BASE64> --key 0x... --key-type hex
 *   bun scripts/sign-transaction.ts --tx-bytes <BASE64> --key 302e... --key-type der
 *
 * Output (stdout): JSON { signature: string, publicKey: string }
 *   - signature: JSON-encoded array of base64 strings (compatible with complete_task MCP tool)
 *   - publicKey: DER-encoded public key string
 *
 * Can be compiled to standalone binary:
 *   bun build scripts/sign-transaction.ts --compile --outfile agentgate-sign
 */

import { Transaction, PrivateKey } from "@hashgraph/sdk";

interface CliArgs {
  txBytes: string;
  key: string;
  keyType: "hex" | "der";
}

function parseArgs(argv: string[]): CliArgs {
  const args: Record<string, string> = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        console.error(`Error: --${key} requires a value`);
        process.exit(1);
      }
      args[key] = value;
      i++;
    }
  }

  if (!args["tx-bytes"]) {
    console.error("Error: --tx-bytes is required (base64-encoded frozen transaction bytes)");
    process.exit(1);
  }
  if (!args.key) {
    console.error("Error: --key is required (private key in hex or DER format)");
    process.exit(1);
  }

  const keyType = (args["key-type"] as "hex" | "der") || "der";

  return { txBytes: args["tx-bytes"], key: args.key, keyType };
}

function main(): void {
  const { txBytes, key, keyType } = parseArgs(process.argv);

  try {
    // Parse private key — works with both hex (0x-prefixed ECDSA) and DER-encoded (302e...)
    let privateKey: PrivateKey;
    if (keyType === "hex") {
      const hexKey = key.startsWith("0x") ? key.slice(2) : key;
      privateKey = PrivateKey.fromStringECDSA(hexKey);
    } else {
      // DER format — PrivateKey.fromString auto-detects ED25519 vs ECDSA
      privateKey = PrivateKey.fromString(key);
    }

    // Deserialize frozen transaction
    const txBytesBuffer = Buffer.from(txBytes, "base64");
    const tx = Transaction.fromBytes(txBytesBuffer);

    // Sign locally — no network calls
    // Second arg `true` = transaction is already frozen (matches signTransactionBytes)
    const signatureBytes = privateKey.signTransaction(tx, true);
    const sigArray = Array.isArray(signatureBytes) ? signatureBytes : [signatureBytes];

    // Output JSON compatible with complete_task / post_task_with_key MCP tools
    // signature is a JSON-encoded array of base64 strings (matching signTransactionBytes format)
    const output = {
      signature: JSON.stringify(sigArray.map((sb) => Buffer.from(sb as Uint8Array).toString("base64"))),
      publicKey: privateKey.publicKey.toStringDer(),
    };

    console.log(JSON.stringify(output));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown signing error";
    console.error(`Signing failed: ${msg}`);
    process.exit(1);
  }
}

main();
