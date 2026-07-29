/**
 * Create Hedera testnet accounts for agents 3-6 and fill their .env files.
 *
 * Usage: bun run scripts/create-agent-accounts.ts
 */

import {
  AccountCreateTransaction,
  PrivateKey,
  Hbar,
  Client,
} from "@hashgraph/sdk";
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const OPERATOR_ID = process.env.HEDERA_OPERATOR_ID!;
const OPERATOR_KEY = process.env.HEDERA_OPERATOR_KEY!;
const NETWORK = process.env.HEDERA_NETWORK ?? "testnet";

const AGENTS_DIR = join(__dirname, "..", "..", "agents");

const AGENT_NUMBERS = [3, 4, 5, 6];

async function main() {
  const client = Client.forName(NETWORK);
  client.setOperator(OPERATOR_ID, OPERATOR_KEY);

  for (const num of AGENT_NUMBERS) {
    const agentDir = join(AGENTS_DIR, `agent${num}`);

    // Check if .env already has a filled account ID
    const envPath = join(agentDir, ".env");
    if (existsSync(envPath)) {
      const existing = readFileSync(envPath, "utf8");
      const match = existing.match(/IDE_ACCOUNT_ID="(\d+\.\d+\.\d+)"/);
      if (match && match[1]) {
        console.log(`agent${num}: already has account ${match[1]}, skipping`);
        continue;
      }
    }

    // Generate new key pair
    const privateKey = PrivateKey.generateECDSA();
    const publicKey = privateKey.publicKey;

    // Create account
    const tx = await new AccountCreateTransaction()
      .setKey(publicKey)
      .setInitialBalance(new Hbar(5))
      .setAccountMemo(`Agent ${num} — testnet account for hackathon`)
      .execute(client);

    const receipt = await tx.getReceipt(client);
    const accountId = receipt.accountId!.toString();

    // Get EVM address
    const evmAddress = `0x${publicKey.toEvmAddress()}`;

    // Get key formats
    const privateKeyHex = `0x${privateKey.toStringRaw()}`;
    const privateKeyEncoded = privateKey.toStringDer();
    const publicKeyEncoded = publicKey.toStringDer();

    // Ensure agent directory exists
    if (!existsSync(agentDir)) {
      mkdirSync(agentDir, { recursive: true });
    }

    // Write .env file
    const envContent = [
      `IDE_ACCOUNT_ID="${accountId}"`,
      `IDE_EVM_ADDRESS="${evmAddress}"`,
      `IDE_PRIVATE_KEY_HEX="${privateKeyHex}"`,
      `IDE_PRIVATE_KEY_ENCODED="${privateKeyEncoded}"`,
      `IDE_ENCODED_PUBLIC_KEY="${publicKeyEncoded}"`,
    ].join("\n") + "\n";

    writeFileSync(envPath, envContent);

    console.log(`agent${num}: created account ${accountId} (EVM: ${evmAddress})`);
  }

  client.close();
  console.log("\nDone! All agent .env files filled.");
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
