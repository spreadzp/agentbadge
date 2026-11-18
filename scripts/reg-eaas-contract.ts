// Register testnet ERC8183 in EaaS allowlist via wallet-sig (dogfood helper)
import { privateKeyToAccount } from "viem/accounts";
const KEY = process.env.EAAS_WALLET_KEY as `0x${string}` | undefined;
if (!KEY) {
  console.error("Set EAAS_WALLET_KEY (0x…) for the signer wallet");
  process.exit(1);
}
const acct = privateKeyToAccount(KEY);
const ts = Math.floor(Date.now() / 1000);
const msg = [
  "agentbadge-access:v1",
  `wallet:${acct.address.toLowerCase()}`,
  "method:POST",
  "path:/api/eaas/contracts",
  `timestamp:${ts}`,
].join("\n");
const sig = await acct.signMessage({ message: msg });
const res = await fetch("http://localhost:4021/api/eaas/contracts", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Wallet": acct.address,
    "X-Sig": sig,
    "X-Timestamp": String(ts),
  },
  body: JSON.stringify({ address: "0x0049e5362736c933055e502b3cf3ba90cc0bf6a0", chainId: 5042002 }),
});
console.log(res.status, await res.text());
