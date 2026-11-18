import { createPublicClient, http, defineChain } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
const c = defineChain({id:5042002,name:'Arc Testnet',nativeCurrency:{name:'USDC',symbol:'USDC',decimals:6},rpcUrls:{default:{http:['https://rpc.blockdaemon.testnet.arc.io']}}});
const pub = createPublicClient({chain:c, transport:http()});
const keys = ['ARC_EVALUATOR_KEY','GEC_INTEROP_PRIVATE_KEY','ARC_PRIVATE_KEY','ARC_OPS_KEY','DEPLOYER_PRIVATE_KEY'];
for (const name of keys) {
  const v = process.env[name]?.replace(/['"\s]/g,'');
  if (!v || !/^0x[0-9a-fA-F]{64}$/.test(v)) { console.log(name,': unset'); continue; }
  try {
    const addr = privateKeyToAccount(v as `0x${string}`).address;
    const bal = await pub.getBalance({address:addr});
    console.log(name.slice(0,22), addr.slice(0,14), '→', bal.toString());
  } catch(e){ console.log(name,'ERR',(e as Error).message?.slice(0,60)); }
}
