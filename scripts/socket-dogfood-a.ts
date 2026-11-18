// EPIC-173 dogfood Scenario A: socket ping + real memo-anchor tx through SocketSigner
import { createSocketSigner, MEMO_ABI, memoIdFor, ARC_CONTRACTS } from "@agentbadge/circle-payments";
import { createPublicClient, http, defineChain, encodeFunctionData, encodeAbiParameters, keccak256 } from "viem";

const c = defineChain({id:5042002,name:'Arc Testnet',nativeCurrency:{name:'USDC',symbol:'USDC',decimals:6},rpcUrls:{default:{http:['https://rpc.blockdaemon.testnet.arc.io']}}});
const pub = createPublicClient({chain:c, transport:http()});
const signer = createSocketSigner({ socketPath: "/tmp/agentbadge-signer.sock" });

// 1. ping / health — populates .address
const health = await (signer as {ping():Promise<{address?:string}>}).ping();
console.log("ping:", JSON.stringify(health));
const signerAddr = (health as {address?:string}).address ?? signer.address;
console.log("signer address:", signerAddr);

// 2. real sendTransaction → memo(self, 0x, memoId, data) on testnet memo contract
const MEMO = ARC_CONTRACTS.memo as `0x${string}`;
const memoId = memoIdFor("chain", "eaas-dogfood-173", BigInt(Math.floor(Date.now()/1000)));
const data = encodeFunctionData({
  abi: MEMO_ABI as never,
  functionName: "memo",
  args: [signerAddr, "0x", memoId, "0x" + "173d".repeat(24) as `0x${string}`],
});
console.log("sending memo-anchor tx to", MEMO);
const txHash = await signer.sendTransaction({ to: MEMO, data });
console.log("txHash:", txHash);
const r = await pub.waitForTransactionReceipt({hash: txHash as `0x${string}`});
console.log("status:", r.status, "from:", r.from, "block:", r.blockNumber.toString());
console.log("explorer: https://testnet.arcscan.app/tx/" + txHash);
if (r.from.toLowerCase() !== signerAddr.toLowerCase()) throw new Error("tx not from signer EOA!");
console.log("SCENARIO-A PASS: settle-capable tx signed by socket signer EOA on Arc testnet");
