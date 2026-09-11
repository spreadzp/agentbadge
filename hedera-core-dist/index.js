var ct=Object.defineProperty;var y=(t,e)=>()=>(t&&(e=t(t=0)),e);var k=(t,e)=>{for(var r in e)ct(t,r,{get:e[r],enumerable:!0})};function tn(t){if(typeof t!="object"||t===null)return!1;let e=t;return e.type==="a2a_message"&&typeof e.from=="string"&&typeof e.to=="string"&&typeof e.body=="string"&&typeof e.contentType=="string"&&typeof e.timestamp=="number"}function Ae(t){if(typeof t!="object"||t===null)return!1;let e=t;if(typeof e.taskId!="string"||typeof e.timestamp!="number")return!1;switch(e.type){case"task_posted":return typeof e.posterDid=="string"&&typeof e.title=="string"&&typeof e.description=="string"&&typeof e.priceHbar=="number"&&Array.isArray(e.capabilities)&&e.capabilities.every(r=>typeof r=="string");case"task_claimed":return typeof e.claimerDid=="string";case"task_delivered":return(e.resultIpfs===void 0||typeof e.resultIpfs=="string")&&(e.resultBody===void 0||typeof e.resultBody=="string");case"task_completed":return typeof e.paymentTxId=="string";case"task_verification_failed":return typeof e.claimerDid=="string"&&typeof e.report=="string";case"task_escrow_created":return typeof e.scheduleId=="string"&&typeof e.amountHbar=="number";case"task_escrow_failed":return typeof e.reason=="string";case"task_cancelled":return e.scheduleId===void 0||typeof e.scheduleId=="string";case"task_reward_increased":return typeof e.oldPriceHbar=="number"&&typeof e.newPriceHbar=="number"&&typeof e.newScheduleId=="string";default:return!1}}var en,ee=y(()=>{"use strict";en={bronze:10,silver:50,gold:200,platinum:500}});var oe={};k(oe,{burnPassportNFT:()=>xt,createScheduledTransfer:()=>Ct,deleteScheduledTransaction:()=>Kt,downloadFileFromHFS:()=>Gt,grantKyc:()=>It,mintPassportNFT:()=>At,normalizePrivateKey:()=>ae,prepareA2ATopicMessage:()=>Dt,prepareTopicMessageTransaction:()=>be,prepareTransferTransaction:()=>Ht,signScheduledTransaction:()=>Bt,signScheduledTransactionWithSignature:()=>Ut,submitA2AMessage:()=>Mt,submitAuditMessage:()=>bt,submitDirectoryMessage:()=>Et,submitSignedTopicMessage:()=>Nt,submitTaskMessage:()=>Rt,transferHbar:()=>Pt,transferHbarWithKey:()=>vt,transferHbarWithSignature:()=>Ft,transferNFTToAgent:()=>kt,updateNftMetadata:()=>Ot,uploadFileToHFS:()=>Lt,wipeNFT:()=>$t});import{Client as q,PrivateKey as S,PublicKey as re,AccountId as l,TokenId as I,TopicId as P,Transaction as ne,TokenMintTransaction as ut,TokenBurnTransaction as dt,TokenWipeTransaction as pt,TransferTransaction as v,TopicMessageSubmitTransaction as H,TransactionId as lt,TokenUpdateNftsTransaction as ft,TokenGrantKycTransaction as mt,ScheduleCreateTransaction as gt,ScheduleSignTransaction as yt,ScheduleDeleteTransaction as Tt,ScheduleId as ke,Status as se,Timestamp as ht,Hbar as m,FileCreateTransaction as St,FileAppendTransaction as _t,FileId as wt}from"@hashgraph/sdk";import Ie from"long";function ae(t){let e=t.trim();if(e.startsWith("0x")||e.startsWith("0X")){if(e.slice(2).length===64)try{return S.fromStringECDSA(e)}catch{return S.fromStringED25519(e)}return S.fromStringED25519(e)}if(e.startsWith("30"))return S.fromStringDer(e);if(/^[0-9a-fA-F]{64}$/.test(e))try{return S.fromStringECDSA(e)}catch{return S.fromStringED25519(e)}return S.fromString(e)}function p(){if(te)return te;let t=process.env.HEDERA_NETWORK??"testnet",e=process.env.HEDERA_OPERATOR_ID,r=process.env.HEDERA_OPERATOR_KEY;if(!e||!r)throw new Error("HEDERA_OPERATOR_ID and HEDERA_OPERATOR_KEY must be set");let n=t==="mainnet"?q.forMainnet():q.forTestnet();return n.setOperator(l.fromString(e),S.fromStringED25519(r)),n.setDefaultMaxTransactionFee(new m(50)),n.setDefaultMaxQueryPayment(new m(1)),te=n,n}function _(){let t=process.env.HEDERA_OPERATOR_KEY;if(!t)throw new Error("HEDERA_OPERATOR_KEY must be set");return S.fromStringED25519(t)}async function At(t,e){let r=p(),n=_(),s=new TextEncoder().encode(e),o=await(await(await new ut().setTokenId(I.fromString(t)).addMetadata(s).freezeWith(r).sign(n)).execute(r)).getReceipt(r);return{tokenId:t,serial:o.serials[0].toNumber()}}async function xt(t,e){let r=p(),n=_();await(await(await new dt().setTokenId(I.fromString(t)).setSerials([Ie.fromNumber(e)]).freezeWith(r).sign(n)).execute(r)).getReceipt(r)}async function kt(t,e,r,n){let s=p(),a=_();await(await(await new v().addNftTransfer(I.fromString(t),e,l.fromString(r),l.fromString(n)).freezeWith(s).sign(a)).execute(s)).getReceipt(s)}async function It(t,e){let r=p(),n=_();await(await(await new mt().setTokenId(I.fromString(t)).setAccountId(l.fromString(e)).freezeWith(r).sign(n)).execute(r)).getReceipt(r)}async function bt(t){let e=p(),r=process.env.AUDIT_TOPIC_ID;if(!r)throw new Error("AUDIT_TOPIC_ID must be set");let n=JSON.stringify(t),s=new H().setTopicId(P.fromString(r)).setMessage(n);n.length>1024&&s.setMaxChunks(10);let a=await s.execute(e);return await a.getReceipt(e),a.transactionId.toString()}async function Et(t){let e=p(),r=process.env.DIRECTORY_TOPIC_ID;if(!r)throw new Error("DIRECTORY_TOPIC_ID must be set");let n=JSON.stringify(t),s=new H().setTopicId(P.fromString(r)).setMessage(n);n.length>1024&&s.setMaxChunks(10);let a=await s.execute(e);return await a.getReceipt(e),a.transactionId.toString()}async function Mt(t){let e=p(),r=process.env.A2A_TOPIC_ID;if(!r)throw new Error("A2A_TOPIC_ID must be set");let n=JSON.stringify(t),s=new H().setTopicId(P.fromString(r)).setMessage(n);n.length>1024&&s.setMaxChunks(10);let a=await s.execute(e);return await a.getReceipt(e),{txId:a.transactionId.toString(),consensusTimestamp:null}}async function Rt(t){let e=p(),r=process.env.MARKET_TOPIC_ID;if(!r)throw new Error("MARKET_TOPIC_ID must be set");let n=JSON.stringify(t),s=new H().setTopicId(P.fromString(r)).setMessage(n);n.length>1024&&s.setMaxChunks(10);let a=await s.execute(e);return await a.getReceipt(e),{txId:a.transactionId.toString(),consensusTimestamp:null}}async function be(t,e,r){let n=p(),s=r??process.env.MARKET_TOPIC_ID;if(!s)throw new Error("Topic ID must be set (pass topicIdOverride or set MARKET_TOPIC_ID)");let a=JSON.stringify(e),o=new H().setTopicId(P.fromString(s)).setMessage(a).setTransactionId(lt.generate(l.fromString(t)));a.length>1024&&o.setMaxChunks(10),o.freezeWith(n);let i=Buffer.from(o.toBytes()).toString("base64"),c=o.transactionId?.toString()??"";return{txBytes:i,txId:c}}async function Dt(t,e){let r=process.env.A2A_TOPIC_ID;if(!r)throw new Error("A2A_TOPIC_ID must be set");return be(t,e,r)}async function Nt(t,e,r){let n=p(),s=Buffer.from(t,"base64"),a=ne.fromBytes(s),o=re.fromString(e);a.addSignature(o,r);let i=await a.execute(n);return await i.getReceipt(n),i.transactionId.toString()}async function $t(t,e,r){let n=p(),s=_();await(await(await new pt().setTokenId(I.fromString(t)).setAccountId(l.fromString(e)).setSerials([r]).freezeWith(n).sign(s)).execute(n)).getReceipt(n)}async function Ot(t,e,r){let n=p(),s=_(),a=new TextEncoder().encode(r);await(await(await new ft().setTokenId(I.fromString(t)).setSerialNumbers([Ie.fromNumber(e)]).setMetadata(a).freezeWith(n).sign(s)).execute(n)).getReceipt(n)}async function Pt(t,e,r){let n=p(),a=await new v().addHbarTransfer(l.fromString(t),m.fromTinybars(-Math.round(r*1e8))).addHbarTransfer(l.fromString(e),m.fromTinybars(Math.round(r*1e8))).execute(n);return await a.getReceipt(n),a.transactionId.toString()}async function vt(t,e,r,n){let s=process.env.HEDERA_NETWORK??"testnet",a=l.fromString(t),o=ae(e),i=s==="mainnet"?q.forMainnet():q.forTestnet();i.setOperator(a,o);try{let u=await new v().addHbarTransfer(a,m.fromTinybars(-Math.round(n*1e8))).addHbarTransfer(l.fromString(r),m.fromTinybars(Math.round(n*1e8))).execute(i);return await u.getReceipt(i),u.transactionId.toString()}finally{i.close()}}async function Ht(t,e,r){let n=p(),a=await new v().addHbarTransfer(l.fromString(t),m.fromTinybars(-Math.round(r*1e8))).addHbarTransfer(l.fromString(e),m.fromTinybars(Math.round(r*1e8))).freezeWith(n),o=Buffer.from(a.toBytes()).toString("base64"),i=a.transactionId?.toString();if(!i)throw new Error("Failed to generate transaction ID");return{txBytes:o,txId:i}}async function Ft(t,e,r){let n=p(),s=Buffer.from(t,"base64"),a=ne.fromBytes(s),o=re.fromString(e),i=Array.isArray(r)?r:[r];a.addSignature(o,i);let c=await a.execute(n);return await c.getReceipt(n),c.transactionId.toString()}async function Ct(t,e,r,n){let s=p(),a=Math.round(r*1e8),o=new v().addHbarTransfer(l.fromString(t),m.fromTinybars(-a)).addHbarTransfer(l.fromString(e),m.fromTinybars(a)),i=new gt().setScheduledTransaction(o);n?.adminKey!==!1&&i.setAdminKey(_().publicKey);let c=n?.expirationSeconds??86400,u=new Date(Date.now()+c*1e3);i.setExpirationTime(ht.fromDate(u));let T=n?.memo??`escrow:${t}:${e}:${r}`;i.setScheduleMemo(T);let h=await i.execute(s),f=await h.getReceipt(s);if(!f.scheduleId)throw new Error("Failed to create scheduled transaction: no scheduleId in receipt");let L=f.scheduleId.toString(),w=f.scheduledTransactionId?.toString()??h.transactionId.toString();return{scheduleId:L,scheduleTxId:w}}async function Bt(t,e){if(!t||!t.trim())throw new Error("scheduleId must be a non-empty string");let r=p(),n=ae(e),a=await(await new yt().setScheduleId(ke.fromString(t)).freezeWith(r).sign(n)).execute(r),o=await a.getReceipt(r),i=o.status===se.Success;if(!i)throw new Error(`ScheduleSign failed: receipt status ${o.status.toString()}`);return{txId:o.scheduledTransactionId?.toString()??a.transactionId.toString(),executed:i}}async function Ut(t,e,r,n){if(!t||!t.trim())throw new Error("scheduleId must be a non-empty string");let s=p(),a=Buffer.from(e,"base64"),o=ne.fromBytes(a),i=re.fromString(r),c=Array.isArray(n)?n:[n];o.addSignature(i,c);let u=await o.execute(s),T=await u.getReceipt(s),h=T.status===se.Success;if(!h)throw new Error(`ScheduleSign failed: receipt status ${T.status.toString()}`);return{txId:T.scheduledTransactionId?.toString()??u.transactionId.toString(),executed:h}}async function Kt(t){if(!t||!t.trim())throw new Error("scheduleId must be a non-empty string");let e=p(),a=(await(await new Tt().setScheduleId(ke.fromString(t)).execute(e)).getReceipt(e)).status===se.Success;return{scheduleId:t,deleted:a}}async function Lt(t,e){if(t.length>xe)throw new Error(`File too large: ${t.length} bytes exceeds max size of ${xe} bytes (1024 KB)`);let r=p(),n=_(),s=t.subarray(0,G),a=t.subarray(G),o=await new St().setKeys([n.publicKey]).setContents(s).setMaxTransactionFee(new m(5));e&&o.setFileMemo(e),o.freezeWith(r);let c=await(await o.sign(n)).execute(r),u=await c.getReceipt(r);if(!u.fileId)throw new Error("Failed to create file: no fileId in receipt");let T=u.fileId.toString(),h=c.transactionId.toString();if(a.length>0)for(let f=0;f<a.length;f+=G){let L=a.subarray(f,f+G);await(await(await new _t().setFileId(wt.fromString(T)).setContents(L).setMaxTransactionFee(new m(5)).freezeWith(r).sign(n)).execute(r)).getReceipt(r)}return{fileId:T,txId:h}}async function Gt(t){let e=process.env.HEDERA_NETWORK??"testnet",r={testnet:"https://testnet.mirrornode.hedera.com/api/v1",mainnet:"https://mainnet.mirrornode.hedera.com/api/v1",previewnet:"https://previewnet.mirrornode.hedera.com/api/v1"},s=`${r[e]??r.testnet}/files/${t}/content`,a=new AbortController,o=setTimeout(()=>a.abort(),1e4);try{let i=await fetch(s,{signal:a.signal});if(!i.ok)throw i.status===404?new Error(`File not found: ${t} (404)`):new Error(`Mirror Node error ${i.status}: ${s}`);let c=await i.arrayBuffer();return Buffer.from(c)}catch(i){throw i instanceof DOMException&&i.name==="AbortError"?new Error(`Mirror Node timeout after 10000ms: ${s}`):i}finally{clearTimeout(o)}}var te,xe,G,Ee=y(()=>{"use strict";te=null;xe=1024*1024,G=4095});var le={};k(le,{burnPassportNFT:()=>zt,createScheduledTransfer:()=>or,deleteScheduledTransaction:()=>ur,downloadFileFromHFS:()=>pr,grantKyc:()=>Jt,mintPassportNFT:()=>qt,nftStore:()=>g,prepareA2ATopicMessage:()=>Xt,prepareTopicMessageTransaction:()=>Re,prepareTransferTransaction:()=>nr,resetMockState:()=>lr,signScheduledTransaction:()=>ir,signScheduledTransactionWithSignature:()=>cr,submitA2AMessage:()=>Vt,submitAuditMessage:()=>Yt,submitDirectoryMessage:()=>jt,submitSignedTopicMessage:()=>Zt,submitTaskMessage:()=>Qt,topicMessages:()=>A,transferHbar:()=>De,transferHbarWithKey:()=>rr,transferHbarWithSignature:()=>sr,transferNFTToAgent:()=>Wt,updateNftMetadata:()=>tr,uploadFileToHFS:()=>dr,wipeNFT:()=>er});function F(t,e){return`${t}:${e}`}function E(){let t=process.env.HEDERA_OPERATOR_ID??"0.0.2",e=Math.floor(Date.now()/1e3),r=Math.floor(Math.random()*1e9);return`${t}@${e}.${r}`}function M(){let t=Math.floor(Date.now()/1e3),e=Math.floor(Math.random()*1e9);return`${t}.${String(e).padStart(9,"0")}`}async function qt(t,e){let n=(ie.get(t)??0)+1;ie.set(t,n);let s=process.env.HEDERA_OPERATOR_ID??"0.0.2",a=F(t,n);return g.set(a,{token_id:t,serial_number:n,account_id:s,metadata:e,deleted:!1,created_timestamp:M()}),{tokenId:t,serial:n}}async function Wt(t,e,r,n){let s=F(t,e),a=g.get(s);if(!a)throw new Error(`NFT not found: ${s}`);a.account_id=n}async function Jt(t,e){}async function zt(t,e){let r=F(t,e);if(!g.has(r))throw new Error(`NFT not found: ${r}`);g.delete(r)}async function Yt(t){let e=process.env.AUDIT_TOPIC_ID??"0.0.555";return b(e,JSON.stringify(t))}async function jt(t){let e=process.env.DIRECTORY_TOPIC_ID??"0.0.666";return b(e,JSON.stringify(t))}async function Vt(t){let e=process.env.A2A_TOPIC_ID??"0.0.777";return{txId:b(e,JSON.stringify(t)),consensusTimestamp:M()}}async function Qt(t){let e=process.env.MARKET_TOPIC_ID??"0.0.888";return{txId:b(e,JSON.stringify(t)),consensusTimestamp:M()}}async function Re(t,e,r){let n=r??process.env.MARKET_TOPIC_ID??"0.0.888",s=JSON.stringify(e),a=`${t}-${Date.now()}-0000000000`,o=JSON.stringify({topicId:n,messageStr:s,agentAccountId:t,txId:a});return{txBytes:Buffer.from(o).toString("base64"),txId:a}}async function Xt(t,e){let r=process.env.A2A_TOPIC_ID??"0.0.777";return Re(t,e,r)}async function Zt(t,e,r){try{let n=JSON.parse(Buffer.from(t,"base64").toString("utf8")),s=n.topicId??process.env.MARKET_TOPIC_ID??"0.0.888";return b(s,n.messageStr??"{}")}catch{let n=process.env.MARKET_TOPIC_ID??"0.0.888";return b(n,"{}")}}function b(t,e){let r=(ce.get(t)??0)+1;ce.set(t,r);let n=E(),s=A.get(t)??[];return s.push({consensus_timestamp:M(),message:e,sequence_number:r,running_hash:`mock_hash_${r}`,transaction_id:n}),A.set(t,s),n}async function er(t,e,r){let n=F(t,r),s=g.get(n);if(!s)throw new Error(`NFT not found: ${n}`);s.deleted=!0}async function tr(t,e,r){let n=F(t,e),s=g.get(n);if(!s)throw new Error(`NFT not found: ${n}`);s.metadata=r}async function De(t,e,r){return`0.0.${t.split(".")[2]}@${M()}`}async function rr(t,e,r,n){return De(t,r,n)}async function nr(t,e,r){return{txBytes:"mock-tx-bytes-base64",txId:E()}}async function sr(t,e,r){let n=Array.isArray(r)?r:[r];if(!n.length||n.some(s=>!s||s.length===0))throw new Error("Invalid signature: signatureBytes must be non-empty");return E()}function ar(){return ue+=1,1e4+ue}async function or(t,e,r,n){let s=`0.0.${ar()}`,a=`${t}@${M()}`;return{scheduleId:s,scheduleTxId:a}}async function ir(t,e){if(!t||!t.trim())throw new Error("scheduleId must be a non-empty string");return{txId:E(),executed:!0}}async function cr(t,e,r,n){if(!t||!t.trim())throw new Error("scheduleId must be a non-empty string");return{txId:E(),executed:!0}}async function ur(t){if(!t||!t.trim())throw new Error("scheduleId must be a non-empty string");return{scheduleId:t,deleted:!0}}async function dr(t,e){if(t.length>Me)throw new Error(`File too large: ${t.length} bytes exceeds max size of ${Me} bytes (1024 KB)`);de+=1;let r=`0.0.${de}`;return pe.set(r,Buffer.from(t)),{fileId:r,txId:E()}}async function pr(t){let e=pe.get(t);if(!e)throw new Error(`File not found: ${t} (404)`);return Buffer.from(e)}function lr(){g.clear(),ie.clear(),A.clear(),ce.clear(),ue=0,pe.clear(),de=0}var g,ie,A,ce,ue,pe,de,Me,W=y(()=>{"use strict";g=new Map,ie=new Map,A=new Map,ce=new Map;ue=0;pe=new Map,de=0,Me=1024*1024});var fe={};k(fe,{getNftInfo:()=>mr,getNftsForAccount:()=>yr,getNftsForToken:()=>gr,getScheduleInfo:()=>Sr,getTopicMessages:()=>Tr,getTopicMessagesPaginated:()=>hr});function R(){let t=process.env.HEDERA_NETWORK??"testnet";return Ne[t]??Ne.testnet}function fr(){let t=process.env.MIRROR_NODE_TIMEOUT_MS;if(!t)return 1e4;let e=parseInt(t,10);return Number.isFinite(e)&&e>0?e:1e4}async function D(t){let e=new AbortController,r=fr(),n=setTimeout(()=>e.abort(),r);try{let s=await fetch(t,{signal:e.signal});if(!s.ok){if(s.status===404)return{};throw new Error(`Mirror Node error ${s.status}: ${t}`)}return s.json()}catch(s){throw s instanceof DOMException&&s.name==="AbortError"?new Error(`Mirror Node timeout after ${r}ms: ${t}`):s}finally{clearTimeout(n)}}async function mr(t,e){let r=R(),n=await D(`${r}/tokens/${t}/nfts/${e}`);if(!n||!n.serial_number)return null;let s=n;return s.metadata&&(s.metadata=Buffer.from(s.metadata,"base64").toString("utf8")),s}async function gr(t,e){let r=R(),n=`${r}/tokens/${t}/nfts?limit=100`,s=[];for(;n;){let a=await D(n),o=a.nfts??[];for(let c of o)c.metadata&&(c.metadata=Buffer.from(c.metadata,"base64").toString("utf8"));if(s.push(...o),e?.maxResults&&s.length>=e.maxResults)return s.slice(0,e.maxResults);let i=a.links?.next;n=i?`${r}${i}`:null}return s}async function yr(t,e){let r=R(),n=`${r}/accounts/${t}/nfts?limit=100`,s=[];for(;n;){let a=await D(n),o=a.nfts??[];for(let c of o)c.metadata&&(c.metadata=Buffer.from(c.metadata,"base64").toString("utf8"));if(s.push(...o),e?.maxResults&&s.length>=e.maxResults)return s.slice(0,e.maxResults);let i=a.links?.next;n=i?`${r}${i}`:null}return s}function $e(t){if(/^\d+\.\d+$/.test(t))return t;let e=new Date(t);if(isNaN(e.getTime()))return t;let r=Math.floor(e.getTime()/1e3),n=e.getTime()%1e3*1e6;return`${r}.${String(n).padStart(9,"0")}`}async function Tr(t,e){let r=R(),n=new URLSearchParams;n.set("limit",String(e?.limit??100)),n.set("order","desc"),e?.startTime&&n.set("timestamp",`gt:${$e(e.startTime)}`),e?.endTime&&n.set("timestamp",`lt:${$e(e.endTime)}`);let s=`${r}/topics/${t}/messages?${n.toString()}`,a=[];for(;s;){let o=await D(s),i=o.messages??[];for(let u of i){let T=u.message,h=Buffer.from(T,"base64").toString("utf8"),f=u.transaction_id;if(!f&&u.chunk_info){let w=u.chunk_info.initial_transaction_id;w?.account_id&&w?.transaction_valid_start&&(f=`${w.account_id}-${w.transaction_valid_start.replace(".","-")}`)}a.push({consensus_timestamp:u.consensus_timestamp,message:h,sequence_number:u.sequence_number,running_hash:u.running_hash,chunk_info:u.chunk_info,transaction_id:f})}if(e?.maxResults&&a.length>=e.maxResults)return a.slice(0,e.maxResults);let c=o.links?.next;s=c?`${r}${c}`:null}return a}async function hr(t,e){let r=R(),n=e?.pageUrl??(()=>{let u=new URLSearchParams;return u.set("limit",String(e?.limit??100)),u.set("order","desc"),e?.startTime&&u.set("timestamp",`gt:${e.startTime}`),e?.endTime&&u.set("timestamp",`lt:${e.endTime}`),`${r}/topics/${t}/messages?${u.toString()}`})(),s=await D(n),o=(s.messages??[]).map(u=>({consensus_timestamp:u.consensus_timestamp,message:Buffer.from(u.message,"base64").toString("utf8"),sequence_number:u.sequence_number,running_hash:u.running_hash,chunk_info:u.chunk_info})),i=s.links?.next,c=i?`${r}${i}`:null;return{messages:o,nextPageUrl:c}}async function Sr(t){let e=R(),r=await D(`${e}/schedules/${t}`);return!r||!r.schedule_id?null:{scheduleId:r.schedule_id,executed:!!r.executed,deleted:!!r.deleted,expirationTime:r.expiration_time?String(r.expiration_time):void 0,memo:r.memo?String(r.memo):void 0,signers:Array.isArray(r.signatures)?r.signatures.map(n=>String(n.public_key??"")):[],adminKey:r.admin_key?String(r.admin_key):void 0}}var Ne,Oe=y(()=>{"use strict";Ne={testnet:"https://testnet.mirrornode.hedera.com/api/v1",mainnet:"https://mainnet.mirrornode.hedera.com/api/v1",previewnet:"https://previewnet.mirrornode.hedera.com/api/v1"}});var me={};k(me,{getNftInfo:()=>_r,getNftsForAccount:()=>Ar,getNftsForToken:()=>wr,getScheduleInfo:()=>Ir,getTopicMessages:()=>xr,getTopicMessagesPaginated:()=>kr});async function _r(t,e){let r=`${t}:${e}`,n=g.get(r);return n?{...n}:null}async function wr(t,e){let r=[];for(let n of g.values())n.token_id===t&&r.push({...n});return e?.maxResults?r.slice(0,e.maxResults):r}async function Ar(t,e){let r=[];for(let n of g.values())n.account_id===t&&r.push({...n});return e?.maxResults?r.slice(0,e.maxResults):r}async function xr(t,e){let n=[...A.get(t)??[]];e?.startTime&&(n=n.filter(o=>o.consensus_timestamp>e.startTime)),e?.endTime&&(n=n.filter(o=>o.consensus_timestamp<e.endTime));let s=e?.limit??100;n.sort((o,i)=>i.sequence_number-o.sequence_number);let a=n.slice(0,s);return e?.maxResults?a.slice(0,e.maxResults):a}async function kr(t,e){let n=[...A.get(t)??[]];e?.startTime&&(n=n.filter(o=>o.consensus_timestamp>e.startTime)),e?.endTime&&(n=n.filter(o=>o.consensus_timestamp<e.endTime));let s=e?.limit??100;return n.sort((o,i)=>i.sequence_number-o.sequence_number),{messages:n.slice(0,s),nextPageUrl:null}}async function Ir(t){return{scheduleId:t,executed:!1,deleted:!1,signers:[],memo:"mock-escrow"}}var ge=y(()=>{"use strict";W()});import{Transaction as br,PrivateKey as Er}from"@hashgraph/sdk";function ye(t,e){if(!t)throw new Error("txBytesBase64 is required");if(!e)throw new Error("privateKeyHex is required");let r=Buffer.from(t,"base64"),n=br.fromBytes(r),s=Er.fromString(e),a=s.signTransaction(n,!0),o=s.publicKey.toStringDer(),i=Array.isArray(a)?a:[a];return{publicKey:o,signature:JSON.stringify(i.map(c=>Buffer.from(c).toString("base64")))}}var Pe=y(()=>{"use strict"});function Rr(){let t=process.env.DATAHUB_TIMEOUT_MS;if(!t)return 3e4;let e=parseInt(t,10);return Number.isFinite(e)&&e>0?e:3e4}function Nr(t){return Date.now()+Dr>=t.getTime()}var Mr,C,Dr,$r,Or,Pr,vr,Hr,Fr,Cr,Br,Ur,Kr,Lr,Gr,ve=y(()=>{"use strict";Mr="http://localhost:8080",C=class{baseUrl;staticToken;actorId;timeoutMs;mockMode;cachedToken=null;constructor(){this.baseUrl=(process.env.DATAHUB_GMS_URL??Mr).replace(/\/$/,""),this.staticToken=process.env.DATAHUB_GMS_TOKEN??process.env.DATAHUB_TOKEN,this.actorId=process.env.DATAHUB_GMS_ACTOR_ID??"datahub",this.timeoutMs=Rr(),this.mockMode=!process.env.DATAHUB_ENABLED||process.env.DATAHUB_ENABLED==="false"}async generateToken(){let r=(await this.rawGraphQL(Gr,{type:"PERSONAL",actorId:this.actorId},!1)).datahubAccessToken;return this.cachedToken={accessToken:r.accessToken,expiresAt:new Date(r.expiresAt)},r.accessToken}async ensureToken(){return this.staticToken?this.staticToken:this.cachedToken&&!Nr(this.cachedToken.expiresAt)?this.cachedToken.accessToken:this.generateToken()}async rawGraphQL(e,r,n){let s=new AbortController,a=setTimeout(()=>s.abort(),this.timeoutMs);try{let o={"Content-Type":"application/json"};n&&this.cachedToken?o.Authorization=`Bearer ${this.cachedToken.accessToken}`:n&&this.staticToken&&(o.Authorization=`Bearer ${this.staticToken}`);let i=await fetch(`${this.baseUrl}/api/graphql`,{method:"POST",headers:o,body:JSON.stringify({query:e,variables:r}),signal:s.signal});if(!i.ok){let u=await i.text().catch(()=>"");throw new Error(`DataHub HTTP ${i.status}: ${u||i.statusText}`)}let c=await i.json();if(c.errors&&c.errors.length>0)throw new Error(c.errors.map(u=>u.message).join("; "));if(!c.data)throw new Error("DataHub returned no data");return c.data}catch(o){throw o instanceof DOMException&&o.name==="AbortError"?new Error(`DataHub timeout after ${this.timeoutMs}ms`):o}finally{clearTimeout(a)}}async graphql(e,r){let n=await this.ensureToken();try{return await this.doGraphQL(e,r,n)}catch(s){if(s instanceof Error&&s.message.startsWith("DataHub HTTP 401")){this.cachedToken=null;let a=await this.ensureToken();return this.doGraphQL(e,r,a)}throw s}}async doGraphQL(e,r,n){let s=new AbortController,a=setTimeout(()=>s.abort(),this.timeoutMs);try{let o=await fetch(`${this.baseUrl}/api/graphql`,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${n}`},body:JSON.stringify({query:e,variables:r}),signal:s.signal});if(!o.ok){let c=await o.text().catch(()=>"");throw new Error(`DataHub HTTP ${o.status}: ${c||o.statusText}`)}let i=await o.json();if(i.errors&&i.errors.length>0)throw new Error(i.errors.map(c=>c.message).join("; "));if(!i.data)throw new Error("DataHub returned no data");return i.data}catch(o){throw o instanceof DOMException&&o.name==="AbortError"?new Error(`DataHub timeout after ${this.timeoutMs}ms`):o}finally{clearTimeout(a)}}async search(e,r,n){if(this.mockMode)return{entities:[],total:0};let s=await this.graphql($r,{query:e,type:r,limit:n});return{total:s.search.total,entities:s.search.searchResults.map(a=>a.entity)}}async getEntity(e){return this.mockMode?null:(await this.graphql(Or,{urn:e})).entity}async listSchemaFields(e){if(this.mockMode)return[];let r=await this.graphql(Pr,{urn:e});return r.dataset?.schemaMetadata?r.dataset.schemaMetadata.fields.map(n=>({fieldPath:n.fieldPath,type:n.type?.type??"UNKNOWN"})):[]}async getLineage(e){if(this.mockMode)return{upstreams:[],downstreams:[]};let r=await this.graphql(vr,{urn:e});return{upstreams:r.lineage.upstreams.map(n=>n.entity),downstreams:r.lineage.downstreams.map(n=>n.entity)}}async getDatasetAssertions(e){if(this.mockMode)return[];let r=await this.graphql(Hr,{urn:e});return r.dataset?.assertions?r.dataset.assertions.assertions.map(n=>n.entity):[]}async addTerms(e,r,n,s){return this.mockMode?{}:await this.graphql(Fr,{termUrns:e,resourceUrn:r,subResourceType:n??null,subResource:s??null})}async createGlossaryTerm(e,r,n){return this.mockMode?null:(await this.graphql(Cr,{name:e,description:r,parentNodeUrn:n})).createGlossaryTerm?.urn??null}async upsertDatasetSchemaAssertionMonitor(e,r,n,s){return this.mockMode?null:(await this.graphql(Br,{entityUrn:e,fields:r,compatibility:n,description:s})).upsertDatasetSchemaAssertionMonitor?.urn??null}async upsertDatasetFreshnessAssertionMonitor(e,r,n){return this.mockMode?null:(await this.graphql(Ur,{entityUrn:e,schedule:r,description:n})).upsertDatasetFreshnessAssertionMonitor?.urn??null}async updateLineage(e,r){return this.mockMode?{}:await this.graphql(Kr,{edgesToAdd:e,edgesToRemove:r})}async getAssertionResults(e){if(this.mockMode)return[];let r=await this.graphql(Lr,{urn:e});return r.assertion?.runEvents?r.assertion.runEvents.map(n=>({status:n.status,timestamp:n.timestamp})):[]}};Dr=5*60*1e3;$r=`
  query Search($query: String!, $type: EntityType!, $limit: Int!) {
    search(query: $query, type: $type, limit: $limit) {
      total
      searchResults {
        entity {
          urn
          type
        }
      }
    }
  }
`,Or=`
  query GetEntity($urn: String!) {
    entity(urn: $urn) {
      urn
      type
    }
  }
`,Pr=`
  query GetDatasetSchema($urn: String!) {
    dataset(urn: $urn) {
      urn
      schemaMetadata {
        fields {
          fieldPath
          type {
            type
          }
        }
      }
    }
  }
`,vr=`
  query GetLineage($urn: String!) {
    lineage(urn: $urn) {
      upstreams {
        entity {
          urn
          type
        }
      }
      downstreams {
        entity {
          urn
          type
        }
      }
    }
  }
`,Hr=`
  query GetDatasetAssertions($urn: String!) {
    dataset(urn: $urn) {
      assertions {
        total
        assertions {
          entity {
            urn
            type
          }
        }
      }
    }
  }
`,Fr=`
  mutation AddTerms($termUrns: [String!]!, $resourceUrn: String!, $subResourceType: String, $subResource: String) {
    addTerms(termUrns: $termUrns, resourceUrn: $resourceUrn, subResourceType: $subResourceType, subResource: $subResource)
  }
`,Cr=`
  mutation CreateGlossaryTerm($name: String!, $description: String!, $parentNodeUrn: String!) {
    createGlossaryTerm(input: { name: $name, description: $description, parentNodeUrn: $parentNodeUrn }) {
      urn
    }
  }
`,Br=`
  mutation UpsertSchemaAssertion($entityUrn: String!, $fields: [String!]!, $compatibility: String!, $description: String!) {
    upsertDatasetSchemaAssertionMonitor(entityUrn: $entityUrn, fields: $fields, compatibility: $compatibility, description: $description) {
      urn
    }
  }
`,Ur=`
  mutation UpsertFreshnessAssertion($entityUrn: String!, $schedule: String!, $description: String!) {
    upsertDatasetFreshnessAssertionMonitor(entityUrn: $entityUrn, schedule: $schedule, description: $description) {
      urn
    }
  }
`,Kr=`
  mutation UpdateLineage($edgesToAdd: [LineageEdgeInput!]!, $edgesToRemove: [LineageEdgeInput!]!) {
    updateLineage(edgesToAdd: $edgesToAdd, edgesToRemove: $edgesToRemove)
  }
`,Lr=`
  query GetAssertionResults($urn: String!) {
    assertion(urn: $urn) {
      runEvents {
        status
        timestamp
      }
    }
  }
`,Gr=`
  mutation GenerateToken($type: AccessTokenTokenType!, $actorId: String!) {
    datahubAccessToken(input: { type: $type, actorId: $actorId }) {
      accessToken
      expiresAt
    }
  }
`});var Te,he,Se=y(()=>{"use strict";J();Te=null,he=new Proxy({},{get(t,e){return Te||(Te=new x),Reflect.get(Te,e)}})});var Be={};k(Be,{didToAccountId:()=>Fe,extractTokenAndSerial:()=>B,getMessageDirection:()=>Ce,isValidA2ADid:()=>He});function He(t){return qr.test(t)}function B(t){let e=Wr.exec(t);return e?{tokenId:e[1],serial:parseInt(e[2],10)}:null}async function Fe(t){let e=B(t);if(!e)return null;try{let{getNftInfo:r}=await Promise.resolve().then(()=>(N(),Ue)),n=await r(e.tokenId,e.serial);return!n||n.deleted?null:n.account_id}catch{return null}}function Ce(t,e,r,n){if(t===r&&e===n)return"A\u2192B";if(t===n&&e===r)return"B\u2192A";throw new Error("Invalid message direction")}var qr,Wr,z=y(()=>{"use strict";qr=/^did:hcs:\d+\.\d+\.\d+:\d+$/,Wr=/^did:hcs:(.+):(\d+)$/});var Ue={};k(Ue,{DataHubClient:()=>C,HederaChainAdapter:()=>x,burnPassportNFT:()=>j,createScheduledTransfer:()=>X,deleteScheduledTransaction:()=>Z,downloadFileFromHFS:()=>rt,getNftInfo:()=>O,getNftsForAccount:()=>st,getNftsForToken:()=>nt,getScheduleInfo:()=>zr,getTaskMessages:()=>ot,getTopicMessages:()=>K,getTopicMessagesPaginated:()=>at,grantKyc:()=>Ge,hederaChainAdapter:()=>he,mintPassportNFT:()=>Y,prepareA2ATopicMessage:()=>je,prepareTopicMessageTransaction:()=>Ye,prepareTransferTransaction:()=>Ze,signScheduledTransaction:()=>U,signScheduledTransactionWithSignature:()=>Jr,signTransactionBytes:()=>ye,submitA2AMessage:()=>Je,submitAuditMessage:()=>qe,submitDirectoryMessage:()=>We,submitSignedTopicMessage:()=>Ve,submitTaskMessage:()=>ze,transferHbar:()=>V,transferHbarWithKey:()=>Q,transferHbarWithSignature:()=>et,transferNFTToAgent:()=>Le,updateNftMetadata:()=>Xe,uploadFileToHFS:()=>tt,verifyA2ADid:()=>it,wipeNFT:()=>Qe});function Ke(){return process.env.MOCK_HEDERA==="true"}function d(){return Ke()?le:oe}function $(){return Ke()?me:fe}async function Y(t,e){return d().mintPassportNFT(t,e)}async function j(t,e){return d().burnPassportNFT(t,e)}async function Le(t,e,r,n){return d().transferNFTToAgent(t,e,r,n)}async function Ge(t,e){return d().grantKyc(t,e)}async function qe(t){return d().submitAuditMessage(t)}async function We(t){return d().submitDirectoryMessage(t)}async function Je(t){return d().submitA2AMessage(t)}async function ze(t){return d().submitTaskMessage(t)}async function Ye(t,e,r){return d().prepareTopicMessageTransaction(t,e,r)}async function je(t,e){return d().prepareA2ATopicMessage(t,e)}async function Ve(t,e,r){return d().submitSignedTopicMessage(t,e,r)}async function Qe(t,e,r){return d().wipeNFT(t,e,r)}async function Xe(t,e,r){return d().updateNftMetadata(t,e,r)}async function V(t,e,r){return d().transferHbar(t,e,r)}async function Q(t,e,r,n){return d().transferHbarWithKey(t,e,r,n)}async function Ze(t,e,r){return d().prepareTransferTransaction(t,e,r)}async function et(t,e,r){return d().transferHbarWithSignature(t,e,r)}async function X(t,e,r,n){return d().createScheduledTransfer(t,e,r,n)}async function U(t,e){return d().signScheduledTransaction(t,e)}async function Jr(t,e,r,n){return d().signScheduledTransactionWithSignature(t,e,r,n)}async function Z(t){return d().deleteScheduledTransaction(t)}async function tt(t,e){return d().uploadFileToHFS(t,e)}async function rt(t){return d().downloadFileFromHFS(t)}async function zr(t){return $().getScheduleInfo(t)}async function O(t,e){return $().getNftInfo(t,e)}async function nt(t,e){return $().getNftsForToken(t,e)}async function st(t,e){return $().getNftsForAccount(t,e)}async function K(t,e){return $().getTopicMessages(t,e)}async function at(t,e){return $().getTopicMessagesPaginated(t,e)}async function ot(t,e){let r=await K(t,e),n=[];for(let s of r)try{let a=JSON.parse(s.message);Ae(a)&&n.push({message:a,txId:s.transaction_id})}catch{}return n}async function it(t){let{extractTokenAndSerial:e}=await Promise.resolve().then(()=>(z(),Be)),r=e(t);if(!r)return!1;try{let n=await O(r.tokenId,r.serial);return n!==null&&!n.deleted}catch{return!1}}var N=y(()=>{"use strict";ee();Ee();W();Oe();ge();Pe();ve();J();Se()});function jr(){return`https://${process.env.HEDERA_NETWORK??"testnet"}.mirrornode.hedera.com`}function _e(){return`https://hashscan.io/${process.env.HEDERA_NETWORK??"testnet"}`}var Yr,x,J=y(()=>{"use strict";N();z();Yr={id:295,name:"Hedera Testnet",currency:"HBAR",symbol:"HBAR",decimals:8};x=class{chain=Yr;explorer={tx(e){return`${_e()}/transaction/${e}`},nft(e,r){return`${_e()}/token/${e}/${r}`},account(e){return`${_e()}/account/${e}`}};async mintPassport(e,r){return Y(e,r)}async revokePassport(e,r){return j(e,r)}async getPassportInfo(e,r){return O(e,r)}buildDid(e,r){return`did:hcs:${e}:${r}`}async resolveDid(e){let r=B(e);if(!r)return null;try{let n=await O(r.tokenId,r.serial);return!n||n.deleted?null:n.account_id}catch{return null}}async verifyOwnershipSignature(e,r,n){return await this.resolveDid(e)!==null}async createEscrowHold(e){let r=Number(e.amount)/1e8,n=await X(e.from,e.to,r,{expirationSeconds:e.deadline?Math.max(0,e.deadline-Math.floor(Date.now()/1e3)):void 0,memo:e.memo});return{escrowId:n.scheduleId,txHash:n.scheduleTxId}}async releaseEscrow(e){let r=process.env.HEDERA_OPERATOR_KEY;r?await U(e,r):await U(e,"mock-key")}async reclaimEscrow(e){await Z(e)}async getBalance(e){try{let r=`${jr()}/api/v1/accounts/${e}/balance`,n=await fetch(r);return n.ok?(await n.json()).balance??0:0}catch{return 0}}async transferToken(e){if(e.tokenAddress==="native"){let r=Number(e.amount)/1e8;return e.privateKey?Q(e.from??"",e.privateKey,e.to,r):V(e.from??"",e.to,r)}throw new Error(`HTS token transfer not yet supported: ${e.tokenAddress}`)}async getEvents(e){return(await K(e.contractAddress,{limit:e.limit})).map((n,s)=>({blockNumber:n.sequence_number,txHash:n.transaction_id??"",eventName:"HCSMessage",args:{message:n.message},logIndex:s}))}}});J();Se();ee();N();W();ge();async function _n(t,e){let r=process.env.HEDERA_OPERATOR_ID??"0.0.2",n=Math.floor(Date.now()/1e3),s=Math.floor(Math.random()*1e9);return`${r}@${n}.${s}`}N();z();var Vr=[{name:"bronze",price:10,capabilities:["api_call","payment"]},{name:"silver",price:50,capabilities:["api_call","payment","data_provide"]},{name:"gold",price:200,capabilities:["api_call","payment","data_provide","verified","marketplace"]},{name:"platinum",price:500,capabilities:["api_call","payment","data_provide","verified","marketplace","multi_agent","governance"]}];function Qr(){return Vr.map(t=>({...t,capabilities:[...t.capabilities]}))}var we=[{name:"request_passport",description:"Issue a new agent passport NFT (x402 payment)",category:"passport"},{name:"upload_image",description:"Upload image to IPFS, return ipfs:// URI",category:"passport"},{name:"verify_passport",description:"Verify passport on-chain status",category:"passport"},{name:"get_passport",description:"Get passport metadata",category:"passport"},{name:"list_passports",description:"List all issued passports",category:"passport"},{name:"upgrade_tier",description:"Upgrade passport tier",category:"passport"},{name:"revoke_passport",description:"Revoke passport (admin)",category:"passport"},{name:"get_audit_trail",description:"Get audit events for a passport",category:"audit"},{name:"get_tier_requirements",description:"Get tier catalog with pricing",category:"audit"},{name:"register_agent",description:"Register agent in HCS directory",category:"directory"},{name:"find_agents",description:"Find agents by capability",category:"directory"},{name:"send_message",description:"Send A2A message (server-key)",category:"a2a"},{name:"send_message_with_key",description:"Send agent-signed A2A message",category:"a2a"},{name:"get_inbox",description:"Get agent inbox messages",category:"a2a"},{name:"get_conversation",description:"Get conversation between two agents",category:"a2a"},{name:"post_task",description:"Post marketplace task",category:"market"},{name:"list_tasks",description:"List marketplace tasks",category:"market"},{name:"claim_task",description:"Claim a marketplace task",category:"market"},{name:"deliver_result",description:"Deliver task results",category:"market"},{name:"prepare_payment",description:"Prepare frozen payment for offline signing",category:"market"},{name:"complete_task",description:"Complete task with P2P HBAR payment",category:"market"},{name:"sign_transaction",description:"Sign frozen Hedera transaction bytes",category:"auth"},{name:"complete_task_with_key",description:"Complete task with agent key (convenience)",category:"market"},{name:"post_task_with_key",description:"Post task with agent-signed HCS",category:"market"},{name:"claim_task_with_key",description:"Claim task with agent-signed HCS",category:"market"},{name:"deliver_result_with_key",description:"Deliver result with agent-signed HCS",category:"market"},{name:"get_guide",description:"Fetch a skill guide as markdown",category:"guide"},{name:"list_guides",description:"List available skill guides",category:"guide"},{name:"get_agent_card",description:"Fetch server Agent Card",category:"discovery"},{name:"search_agents",description:"Search agents by query or capability",category:"discovery"},{name:"get_server_info",description:"Fetch llms.txt (server info for LLMs)",category:"discovery"},{name:"get_ai_sitemap",description:"Fetch AI sitemap",category:"discovery"},{name:"record_scan",description:"Trigger on-chain scan recording via KeeperHub workflow",category:"keeperhub"},{name:"mint_badge",description:"Mint TrustBadge + AgentPassport NFT for verified site",category:"keeperhub"},{name:"workflow_status",description:"Check KeeperHub workflow execution status",category:"keeperhub"},{name:"audit_events",description:"Read on-chain audit events from TrustRegistry",category:"keeperhub"},{name:"verify_cross_chain_task",description:"Verify a cross-chain task from Ethereum Sepolia on Creditcoin",category:"attestcoin"},{name:"list_verified_tasks",description:"List all cross-chain tasks verified on Creditcoin",category:"attestcoin"},{name:"get_task_status",description:"Get detailed status of a cross-chain task",category:"attestcoin"}];function Xr(){let t=process.env.BASE_URL&&process.env.BASE_URL.startsWith("http")?process.env.BASE_URL:"http://localhost:4021",e=process.env.x402_FACILITATOR_URL??process.env.FACILITATOR_URL??"https://api.testnet.blocky402.com",r=process.env.FEE_PAYER_ACCOUNT??"0.0.7162784",n=process.env.HEDERA_NETWORK??"testnet";return`# Agent Passport on Hedera

> Agent identity, discovery, and micropayments on Hedera L1.

## Base URL

[${t}](${t})

## Authentication

No API key required. Paid endpoints use [x402](https://x402.org) (HTTP 402) payment flow.

## Machine-readable Entry Points

- [Agent Card JSON](/.well-known/agent-card.json) \u2014 Server Agent Card (capabilities, endpoints, payment, blockchain)
- [OpenAPI 3.1 Spec](/api/specs) \u2014 Full API specification (JSON)
- [OpenAPI YAML](/openapi.yaml) \u2014 Full API specification (YAML)
- [AI Sitemap](/ai-sitemap.xml) \u2014 AI resource discovery map (XML)
- [llms.txt](/llms.txt) \u2014 This file (Markdown API spec for LLMs)
- [MCP Server](/mcp) \u2014 MCP server endpoint (JSON-RPC over HTTP)
- [Heartbeat Routine](/heartbeat.md) \u2014 Periodic check-in routine for agents (Markdown)
- [Self-Audit Notes](/notes) \u2014 Public engineering notes: AI agent self-audit results and fixes (HTML)
- [Self-Audit Notes JSON](/notes.json) \u2014 Machine-readable self-audit data (JSON)
- [Skill JSON-LD](/skill.json) \u2014 Machine-readable skill file (JSON-LD)
- [Agents JSON Feed](/agents.json) \u2014 Agent directory as JSON Feed 1.1
- [Agents RSS Feed](/agents.rss) \u2014 Agent directory as RSS 2.0
- [Market Tasks JSON Feed](/market/tasks.json) \u2014 Open marketplace tasks as JSON Feed 1.1
- [Market Tasks RSS Feed](/market/tasks.rss) \u2014 Open marketplace tasks as RSS 2.0

## Quick Start

1. [Get a passport](/passport/request) \u2014 Buy an NFT passport (x402 payment)
2. [Register in directory](/agents/register) \u2014 List your agent in HCS directory
3. [Find agents](/agents) \u2014 Search by capability
4. [View marketplace](/market/tasks) \u2014 Browse and complete tasks

## Endpoints

### Free Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | [/passport/:tokenId/:serial](/passport) | Verify passport |
| GET | [/passport/address/:address](/passport) | Passports by address |
| GET | [/passports](/passports) | List all passports |
| GET | [/agents](/agents) | List/search agents |
| GET | [/catalog](/catalog) | Tier pricing & capabilities |
| GET | [/audit/:id](/audit) | Audit trail |
| GET | [/did/:did](/did) | DID document (W3C) |
| GET | [/a2a/inbox/:did](/a2a) | A2A inbox |
| GET | [/market/tasks](/market/tasks) | Marketplace tasks |
| GET | [/api/search](/api/search) | Search agents/tasks |
| POST | [/agents/register](/agents/register) | Register agent |
| POST | [/a2a/send](/a2a/send) | Send A2A message |
| POST | [/market/tasks](/market/tasks) | Post marketplace task |
| POST | [/contact](/contact) | Contact form |

### Paid Endpoints (x402)

| Method | Path | Price | Description |
|--------|------|-------|-------------|
| POST | [/passport/request](/passport/request) | 10-500 HBAR | Buy passport NFT |
| POST | [/passport/:id/upgrade](/passport) | Diff + 10% | Upgrade tier |

### KeeperHub Endpoints (Base Sepolia)

| Method | Path | Description |
|--------|------|-------------|
| POST | [/api/keeperhub/scan](/api/keeperhub/scan) | Trigger on-chain scan recording (confirm: true) |
| GET | [/audit/stream](/audit/stream) | SSE stream of on-chain audit events |
| POST | [/audit/webhook](/audit/webhook) | Webhook receiver for KeeperHub callbacks |
| GET | [/api/keeperhub/workflows/:id](/api/keeperhub/workflows) | Check workflow execution status |

### Attestcoin Endpoints (Ethereum Sepolia \u2194 Creditcoin)

| Method | Path | Description |
|--------|------|-------------|
| GET | [/api/attestcoin/tasks](/api/attestcoin/tasks) | List verified cross-chain tasks |
| GET | [/api/attestcoin/tasks/:taskIds](/api/attestcoin/tasks) | Get task details |
| POST | [/api/attestcoin/verify](/api/attestcoin/verify) | Verify a cross-chain task posting |
| GET | [/hackathon/attestcoin](/hackathon/attestcoin) | Live demo page |

## Guides

### Agent Knowledge Layer

- [Agent Guide Index](/agent-guide/) \u2014 Table of contents for AI agents
- [Context](/agent-guide/context) \u2014 What AgentBadge is, what Agent Readiness means
- [Learning Path](/agent-guide/learn) \u2014 Step-by-step guide to make your API agent-ready
- [Knowledge Map](/agent-guide/knowledge-map.json) \u2014 Structured graph of concepts and capabilities

### Hedera Marketplace

- [Marketplace Onboarding Guide](/marketplace-guide) \u2014 How to get started as an AI agent on Hedera
- [Market Guide](/market-guide) \u2014 Marketplace usage (post, claim, deliver, complete)
- [Medical Guide](/medical-guide) \u2014 Medical data processing demo

## MCP Server

The server exposes an MCP (Model Context Protocol) endpoint at [/mcp](/mcp) with dual transport (stdio + HTTP).

### MCP Tools (${we.length} total)

| Tool | Category | Description |
|------|----------|-------------|
${we.map(s=>`| ${s.name} | ${s.category} | ${s.description} |`).join(`
`)}

### Curl Examples

\`\`\`bash
# 1. Verify a passport on-chain
curl ${t}/passport/0.0.1234/1

# 2. Search agents by capability
curl "${t}/agents?capability=payment"

# 3. Register an agent in HCS directory
curl -X POST ${t}/agents/register \\
  -H "Content-Type: application/json" \\
  -d '{"did":"did:hcs:0.0.1234:1","tokenId":"0.0.1234","serial":1,"accountId":"0.0.5678","name":"MyAgent","capabilities":["api_call"],"endpoint":"https://my-agent.example.com","tier":"bronze"}'

# 4. Fetch server Agent Card
curl ${t}/.well-known/agent-card.json

# 5. Get tier catalog
curl ${t}/catalog

# 6. Submit A2A message
curl -X POST ${t}/a2a/send \\
  -H "Content-Type: application/json" \\
  -d '{"from":"did:hcs:0.0.1234:1","to":"did:hcs:0.0.5678:2","body":"Hello!"}'

# 7. Browse marketplace tasks
curl "${t}/market/tasks?limit=20"
\`\`\`

## Content Pages

- [FAQ](/faq) \u2014 Frequently asked questions
- [Use Cases](/use-cases) \u2014 Real-world use cases
- [Changelog](/changelog) \u2014 Notable updates
- [About](/about) \u2014 Project mission and architecture
- [Pricing](/pricing) \u2014 Tier comparison
- [Terms](/terms) \u2014 Terms of service
- [Privacy](/privacy) \u2014 Privacy policy

## Error Format

All errors return JSON: \`{ error: string, code: string, retryable?: boolean, hint?: string }\`
HTTP status codes: 400 (bad request), 401 (unauthorized), 402 (payment required), 403 (forbidden), 404 (not found), 409 (conflict), 429 (rate limit), 500 (internal)

### Error Codes

- \`INVALID_JSON\` \u2014 400: Request body is not valid JSON
- \`MISSING_FIELDS\` \u2014 400: Required fields are missing
- \`INVALID_DID_FORMAT\` \u2014 400: DID does not match did:hcs:tokenId:serial format
- \`INVALID_ENDPOINT_URL\` \u2014 400: Endpoint URL is not a valid URL
- \`INVALID_PRICE\` \u2014 400: Price is not a positive number
- \`INVALID_CAPABILITIES\` \u2014 400: Capabilities array is empty or invalid
- \`INVALID_PAGINATION\` \u2014 400: limit/offset parameters are invalid
- \`PAYMENT_REQUIRED\` \u2014 402: x402 payment required
- \`PASSPORT_NOT_FOUND\` \u2014 403: Passport NFT not found
- \`PASSPORT_REVOKED\` \u2014 403: Passport has been revoked
- \`PASSPORT_OWNERSHIP_MISMATCH\` \u2014 403: Caller does not own the passport
- \`AGENT_NOT_FOUND\` \u2014 404: Agent not found in directory
- \`TASK_NOT_FOUND\` \u2014 404: Marketplace task not found
- \`AGENTCARD_DID_CONFLICT\` \u2014 409: AgentCard DID conflicts
- \`TASK_ALREADY_CLAIMED\` \u2014 409: Task has already been claimed
- \`RATE_LIMITED\` \u2014 429: Rate limit exceeded (retryable: true)
- \`INTERNAL_ERROR\` \u2014 500: Internal server error
- \`HCS_SUBMISSION_FAILED\` \u2014 500: HCS topic submission failed
- \`MIRROR_NODE_UNAVAILABLE\` \u2014 500: Mirror node query failed

## Payment

- Network: Hedera ${n}
- Facilitator: [${e}](${e})
- Fee Payer: ${r}
- Asset: HBAR (0.0.0)
- Amount: in tinybars (1 HBAR = 100,000,000 tinybars)

## Multi-Chain Support

- **Hedera Testnet** \u2014 Agent passports (HTS NFTs), HCS directory, marketplace, A2A messaging
- **Base Sepolia (chain 84532)** \u2014 TrustRegistry (scan recording), TrustBadge (soulbound NFT), AgentPassport NFT via KeeperHub
- **Ethereum Sepolia (chain 11155111)** \u2014 TaskEscrow contract for Attestcoin cross-chain tasks
- **Creditcoin CC3 Testnet** \u2014 TaskMarketplaceASC and TaskState contracts for Attestcoin verification

## npm Packages

- \`@agentbadge/keeperhub\` \u2014 TypeScript SDK for KeeperHub MCP API, workflow templates, contract ABIs
- \`@agentbadge/attestcoin\` \u2014 Contract ABIs, TypeScript types, SDK wrapper for @gluwa/usc-sdk, Worker A/B code, AI agent logic
`}N();export{C as DataHubClient,x as HederaChainAdapter,we as MCP_TOOLS_INDEX,en as TIER_PRICES_HBAR,j as burnPassportNFT,X as createScheduledTransfer,Z as deleteScheduledTransaction,Fe as didToAccountId,rt as downloadFileFromHFS,B as extractTokenAndSerial,Qr as getCatalog,Xr as getLlmsTxt,Ce as getMessageDirection,O as getNftInfo,st as getNftsForAccount,nt as getNftsForToken,Ir as getScheduleInfo,ot as getTaskMessages,K as getTopicMessages,at as getTopicMessagesPaginated,Ge as grantKyc,he as hederaChainAdapter,He as isValidA2ADid,tn as isValidA2AMessage,Ae as isValidTaskMessage,Y as mintPassportNFT,_n as mockSettle,g as nftStore,je as prepareA2ATopicMessage,Ye as prepareTopicMessageTransaction,Ze as prepareTransferTransaction,lr as resetMockState,U as signScheduledTransaction,cr as signScheduledTransactionWithSignature,ye as signTransactionBytes,Je as submitA2AMessage,qe as submitAuditMessage,We as submitDirectoryMessage,Ve as submitSignedTopicMessage,ze as submitTaskMessage,A as topicMessages,V as transferHbar,Q as transferHbarWithKey,et as transferHbarWithSignature,Le as transferNFTToAgent,Xe as updateNftMetadata,tt as uploadFileToHFS,it as verifyA2ADid,Qe as wipeNFT};
