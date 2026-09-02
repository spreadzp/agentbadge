/**
 * Tests for SLICE-15-5: Standalone agentgate-sign CLI script
 *
 * Tests the sign-transaction.ts script by importing its core logic
 * and verifying it produces correct signatures compatible with
 * signTransactionBytes from @agentbadge/hedera-core.
 */

import { describe, it, expect } from "vitest";
import { PrivateKey, Transaction, TransferTransaction, Client, Hbar } from "@hashgraph/sdk";
import { signTransactionBytes } from "@agentbadge/hedera-core";
import { execSync } from "node:child_process";
import { resolve } from "node:path";

function makeFrozenTx(): { txBytes: string; privateKey: PrivateKey } {
  const privateKey = PrivateKey.generateED25519();
  const accountId = "0.0.12345";
  const client = Client.forTestnet();
  client.setOperator(accountId, privateKey);
  const tx = new TransferTransaction()
    .addHbarTransfer(accountId, Hbar.fromTinybars(-100))
    .addHbarTransfer("0.0.67890", Hbar.fromTinybars(100));
  tx.freezeWith(client);
  const txBytes = Buffer.from(tx.toBytes()).toString("base64");
  client.close();
  return { txBytes, privateKey };
}

function makeFrozenTxECDSA(): { txBytes: string; privateKey: PrivateKey } {
  const privateKey = PrivateKey.generateECDSA();
  const accountId = "0.0.22222";
  const client = Client.forTestnet();
  client.setOperator(accountId, privateKey);
  const tx = new TransferTransaction()
    .addHbarTransfer(accountId, Hbar.fromTinybars(-50))
    .addHbarTransfer("0.0.33333", Hbar.fromTinybars(50));
  tx.freezeWith(client);
  const txBytes = Buffer.from(tx.toBytes()).toString("base64");
  client.close();
  return { txBytes, privateKey };
}

function runCli(args: string[]): string {
  const scriptPath = resolve(__dirname, "../scripts/sign-transaction.ts");
  const cmd = `bun ${scriptPath} ${args.join(" ")}`;
  return execSync(cmd, { encoding: "utf-8", timeout: 10000 }).trim();
}

describe("SLICE-15-5: Standalone sign-transaction CLI", () => {
  it("produces valid signature for ED25519 DER key", () => {
    const { txBytes, privateKey } = makeFrozenTx();
    const output = runCli(["--tx-bytes", txBytes, "--key", privateKey.toStringDer()]);
    const parsed = JSON.parse(output);

    expect(parsed.signature).toBeDefined();
    expect(parsed.publicKey).toBeDefined();
    expect(parsed.publicKey).toBe(privateKey.publicKey.toStringDer());

    // signature is JSON-encoded array of base64 strings
    const sigArr = JSON.parse(parsed.signature);
    expect(Array.isArray(sigArr)).toBe(true);
    expect(sigArr.length).toBeGreaterThan(0);

    // Verify signature matches signTransactionBytes output
    const expected = signTransactionBytes(txBytes, privateKey.toStringDer());
    expect(parsed.signature).toBe(expected.signature);
    expect(parsed.publicKey).toBe(expected.publicKey);
  });

  it("produces valid signature for ECDSA hex key", () => {
    const { txBytes, privateKey } = makeFrozenTxECDSA();
    const hexKey = `0x${privateKey.toStringRaw()}`;
    const output = runCli(["--tx-bytes", txBytes, "--key", hexKey, "--key-type", "hex"]);
    const parsed = JSON.parse(output);

    expect(parsed.signature).toBeDefined();
    expect(parsed.publicKey).toBeDefined();

    const sigArr = JSON.parse(parsed.signature);
    expect(Array.isArray(sigArr)).toBe(true);
    expect(sigArr.length).toBeGreaterThan(0);
  });

  it("output is valid input for complete_task (signature is JSON array of base64)", () => {
    const { txBytes, privateKey } = makeFrozenTx();
    const output = runCli(["--tx-bytes", txBytes, "--key", privateKey.toStringDer()]);
    const parsed = JSON.parse(output);

    // signature must be parseable as JSON array
    const sigArr = JSON.parse(parsed.signature);
    expect(Array.isArray(sigArr)).toBe(true);
    // each element must be valid base64
    for (const sig of sigArr) {
      expect(typeof sig).toBe("string");
      expect(() => Buffer.from(sig, "base64")).not.toThrow();
    }
    // publicKey must be a non-empty string
    expect(typeof parsed.publicKey).toBe("string");
    expect(parsed.publicKey.length).toBeGreaterThan(0);
  });

  it("does not echo private key in output", () => {
    const { txBytes, privateKey } = makeFrozenTx();
    const output = runCli(["--tx-bytes", txBytes, "--key", privateKey.toStringDer()]);
    const dataStr = output;
    expect(dataStr).not.toContain(privateKey.toStringDer());
    expect(dataStr).not.toContain(privateKey.toStringRaw());
  });

  it("exits with error for missing --tx-bytes", () => {
    const privateKey = PrivateKey.generateED25519();
    expect(() => runCli(["--key", privateKey.toStringDer()])).toThrow();
  });

  it("exits with error for missing --key", () => {
    const { txBytes } = makeFrozenTx();
    expect(() => runCli(["--tx-bytes", txBytes])).toThrow();
  });

  it("exits with error for invalid key", () => {
    const { txBytes } = makeFrozenTx();
    expect(() => runCli(["--tx-bytes", txBytes, "--key", "not-a-valid-key"])).toThrow();
  });

  it("works with explicit --key-type der", () => {
    const { txBytes, privateKey } = makeFrozenTx();
    const output = runCli([
      "--tx-bytes", txBytes,
      "--key", privateKey.toStringDer(),
      "--key-type", "der",
    ]);
    const parsed = JSON.parse(output);
    expect(parsed.signature).toBeDefined();
    expect(parsed.publicKey).toBe(privateKey.publicKey.toStringDer());
  });
});
