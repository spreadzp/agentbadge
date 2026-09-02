var ne=Object.defineProperty;var h=(e,t)=>()=>(e&&(t=e(e=0)),t);var A=(e,t)=>{for(var n in t)ne(e,n,{get:t[n],enumerable:!0})};function Yn(e){if(typeof e!="object"||e===null)return!1;let t=e;return t.type==="a2a_message"&&typeof t.from=="string"&&typeof t.to=="string"&&typeof t.body=="string"&&typeof t.contentType=="string"&&typeof t.timestamp=="number"}function ut(e){if(typeof e!="object"||e===null)return!1;let t=e;if(typeof t.taskId!="string"||typeof t.timestamp!="number")return!1;switch(t.type){case"task_posted":return typeof t.posterDid=="string"&&typeof t.title=="string"&&typeof t.description=="string"&&typeof t.priceHbar=="number"&&Array.isArray(t.capabilities)&&t.capabilities.every(n=>typeof n=="string");case"task_claimed":return typeof t.claimerDid=="string";case"task_delivered":return(t.resultIpfs===void 0||typeof t.resultIpfs=="string")&&(t.resultBody===void 0||typeof t.resultBody=="string");case"task_completed":return typeof t.paymentTxId=="string";case"task_verification_failed":return typeof t.claimerDid=="string"&&typeof t.report=="string";case"task_escrow_created":return typeof t.scheduleId=="string"&&typeof t.amountHbar=="number";case"task_cancelled":return t.scheduleId===void 0||typeof t.scheduleId=="string";case"task_reward_increased":return typeof t.oldPriceHbar=="number"&&typeof t.newPriceHbar=="number"&&typeof t.newScheduleId=="string";default:return!1}}var Jn,L=h(()=>{"use strict";Jn={bronze:10,silver:50,gold:200,platinum:500}});var J={};A(J,{burnPassportNFT:()=>Te,createScheduledTransfer:()=>Ne,deleteScheduledTransaction:()=>ve,downloadFileFromHFS:()=>Ce,grantKyc:()=>_e,mintPassportNFT:()=>ye,normalizePrivateKey:()=>z,prepareA2ATopicMessage:()=>Ie,prepareTopicMessageTransaction:()=>ft,prepareTransferTransaction:()=>De,signScheduledTransaction:()=>Oe,signScheduledTransactionWithSignature:()=>Pe,submitA2AMessage:()=>we,submitAuditMessage:()=>Se,submitDirectoryMessage:()=>xe,submitSignedTopicMessage:()=>be,submitTaskMessage:()=>Ae,transferHbar:()=>Me,transferHbarWithKey:()=>Re,transferHbarWithSignature:()=>$e,transferNFTToAgent:()=>he,updateNftMetadata:()=>ke,uploadFileToHFS:()=>Fe,wipeNFT:()=>Ee});import{Client as H,PrivateKey as _,PublicKey as G,AccountId as l,TokenId as I,TopicId as D,Transaction as q,TokenMintTransaction as re,TokenBurnTransaction as se,TokenWipeTransaction as ae,TransferTransaction as $,TopicMessageSubmitTransaction as N,TransactionId as oe,TokenUpdateNftsTransaction as ie,TokenGrantKycTransaction as ce,ScheduleCreateTransaction as ue,ScheduleSignTransaction as de,ScheduleDeleteTransaction as pe,ScheduleId as pt,Status as W,Timestamp as le,Hbar as m,FileCreateTransaction as fe,FileAppendTransaction as me,FileId as ge}from"@hashgraph/sdk";import lt from"long";function z(e){let t=e.trim();if(t.startsWith("0x")||t.startsWith("0X")){if(t.slice(2).length===64)try{return _.fromStringECDSA(t)}catch{return _.fromStringED25519(t)}return _.fromStringED25519(t)}if(t.startsWith("30"))return _.fromStringDer(t);if(/^[0-9a-fA-F]{64}$/.test(t))try{return _.fromStringECDSA(t)}catch{return _.fromStringED25519(t)}return _.fromString(t)}function p(){if(K)return K;let e=process.env.HEDERA_NETWORK??"testnet",t=process.env.HEDERA_OPERATOR_ID,n=process.env.HEDERA_OPERATOR_KEY;if(!t||!n)throw new Error("HEDERA_OPERATOR_ID and HEDERA_OPERATOR_KEY must be set");let r=e==="mainnet"?H.forMainnet():H.forTestnet();return r.setOperator(l.fromString(t),_.fromStringED25519(n)),r.setDefaultMaxTransactionFee(new m(50)),r.setDefaultMaxQueryPayment(new m(1)),K=r,r}function S(){let e=process.env.HEDERA_OPERATOR_KEY;if(!e)throw new Error("HEDERA_OPERATOR_KEY must be set");return _.fromStringED25519(e)}async function ye(e,t){let n=p(),r=S(),s=new TextEncoder().encode(t),o=await(await(await new re().setTokenId(I.fromString(e)).addMetadata(s).freezeWith(n).sign(r)).execute(n)).getReceipt(n);return{tokenId:e,serial:o.serials[0].toNumber()}}async function Te(e,t){let n=p(),r=S();await(await(await new se().setTokenId(I.fromString(e)).setSerials([lt.fromNumber(t)]).freezeWith(n).sign(r)).execute(n)).getReceipt(n)}async function he(e,t,n,r){let s=p(),a=S();await(await(await new $().addNftTransfer(I.fromString(e),t,l.fromString(n),l.fromString(r)).freezeWith(s).sign(a)).execute(s)).getReceipt(s)}async function _e(e,t){let n=p(),r=S();await(await(await new ce().setTokenId(I.fromString(e)).setAccountId(l.fromString(t)).freezeWith(n).sign(r)).execute(n)).getReceipt(n)}async function Se(e){let t=p(),n=process.env.AUDIT_TOPIC_ID;if(!n)throw new Error("AUDIT_TOPIC_ID must be set");let r=JSON.stringify(e),s=new N().setTopicId(D.fromString(n)).setMessage(r);r.length>1024&&s.setMaxChunks(10);let a=await s.execute(t);return await a.getReceipt(t),a.transactionId.toString()}async function xe(e){let t=p(),n=process.env.DIRECTORY_TOPIC_ID;if(!n)throw new Error("DIRECTORY_TOPIC_ID must be set");let r=JSON.stringify(e),s=new N().setTopicId(D.fromString(n)).setMessage(r);r.length>1024&&s.setMaxChunks(10);let a=await s.execute(t);return await a.getReceipt(t),a.transactionId.toString()}async function we(e){let t=p(),n=process.env.A2A_TOPIC_ID;if(!n)throw new Error("A2A_TOPIC_ID must be set");let r=JSON.stringify(e),s=new N().setTopicId(D.fromString(n)).setMessage(r);r.length>1024&&s.setMaxChunks(10);let a=await s.execute(t);return await a.getReceipt(t),a.transactionId.toString()}async function Ae(e){let t=p(),n=process.env.MARKET_TOPIC_ID;if(!n)throw new Error("MARKET_TOPIC_ID must be set");let r=JSON.stringify(e),s=new N().setTopicId(D.fromString(n)).setMessage(r);r.length>1024&&s.setMaxChunks(10);let a=await s.execute(t);return await a.getReceipt(t),a.transactionId.toString()}async function ft(e,t,n){let r=p(),s=n??process.env.MARKET_TOPIC_ID;if(!s)throw new Error("Topic ID must be set (pass topicIdOverride or set MARKET_TOPIC_ID)");let a=JSON.stringify(t),o=new N().setTopicId(D.fromString(s)).setMessage(a).setTransactionId(oe.generate(l.fromString(e)));a.length>1024&&o.setMaxChunks(10),o.freezeWith(r);let i=Buffer.from(o.toBytes()).toString("base64"),c=o.transactionId?.toString()??"";return{txBytes:i,txId:c}}async function Ie(e,t){let n=process.env.A2A_TOPIC_ID;if(!n)throw new Error("A2A_TOPIC_ID must be set");return ft(e,t,n)}async function be(e,t,n){let r=p(),s=Buffer.from(e,"base64"),a=q.fromBytes(s),o=G.fromString(t);a.addSignature(o,n);let i=await a.execute(r);return await i.getReceipt(r),i.transactionId.toString()}async function Ee(e,t,n){let r=p(),s=S();await(await(await new ae().setTokenId(I.fromString(e)).setAccountId(l.fromString(t)).setSerials([n]).freezeWith(r).sign(s)).execute(r)).getReceipt(r)}async function ke(e,t,n){let r=p(),s=S(),a=new TextEncoder().encode(n);await(await(await new ie().setTokenId(I.fromString(e)).setSerialNumbers([lt.fromNumber(t)]).setMetadata(a).freezeWith(r).sign(s)).execute(r)).getReceipt(r)}async function Me(e,t,n){let r=p(),a=await new $().addHbarTransfer(l.fromString(e),m.fromTinybars(-Math.round(n*1e8))).addHbarTransfer(l.fromString(t),m.fromTinybars(Math.round(n*1e8))).execute(r);return await a.getReceipt(r),a.transactionId.toString()}async function Re(e,t,n,r){let s=process.env.HEDERA_NETWORK??"testnet",a=l.fromString(e),o=z(t),i=s==="mainnet"?H.forMainnet():H.forTestnet();i.setOperator(a,o);try{let u=await new $().addHbarTransfer(a,m.fromTinybars(-Math.round(r*1e8))).addHbarTransfer(l.fromString(n),m.fromTinybars(Math.round(r*1e8))).execute(i);return await u.getReceipt(i),u.transactionId.toString()}finally{i.close()}}async function De(e,t,n){let r=p(),a=await new $().addHbarTransfer(l.fromString(e),m.fromTinybars(-Math.round(n*1e8))).addHbarTransfer(l.fromString(t),m.fromTinybars(Math.round(n*1e8))).freezeWith(r),o=Buffer.from(a.toBytes()).toString("base64"),i=a.transactionId?.toString();if(!i)throw new Error("Failed to generate transaction ID");return{txBytes:o,txId:i}}async function $e(e,t,n){let r=p(),s=Buffer.from(e,"base64"),a=q.fromBytes(s),o=G.fromString(t),i=Array.isArray(n)?n:[n];a.addSignature(o,i);let c=await a.execute(r);return await c.getReceipt(r),c.transactionId.toString()}async function Ne(e,t,n,r){let s=p(),a=Math.round(n*1e8),o=new $().addHbarTransfer(l.fromString(e),m.fromTinybars(-a)).addHbarTransfer(l.fromString(t),m.fromTinybars(a)),i=new ue().setScheduledTransaction(o);r?.adminKey!==!1&&i.setAdminKey(S().publicKey);let c=r?.expirationSeconds??86400,u=new Date(Date.now()+c*1e3);i.setExpirationTime(le.fromDate(u));let y=r?.memo??`escrow:${e}:${t}:${n}`;i.setScheduleMemo(y);let T=await i.execute(s),f=await T.getReceipt(s);if(!f.scheduleId)throw new Error("Failed to create scheduled transaction: no scheduleId in receipt");let F=f.scheduleId.toString(),x=f.scheduledTransactionId?.toString()??T.transactionId.toString();return{scheduleId:F,scheduleTxId:x}}async function Oe(e,t){if(!e||!e.trim())throw new Error("scheduleId must be a non-empty string");let n=p(),r=z(t),a=await(await new de().setScheduleId(pt.fromString(e)).freezeWith(n).sign(r)).execute(n),o=await a.getReceipt(n),i=o.status===W.Success;if(!i)throw new Error(`ScheduleSign failed: receipt status ${o.status.toString()}`);return{txId:o.scheduledTransactionId?.toString()??a.transactionId.toString(),executed:i}}async function Pe(e,t,n,r){if(!e||!e.trim())throw new Error("scheduleId must be a non-empty string");let s=p(),a=Buffer.from(t,"base64"),o=q.fromBytes(a),i=G.fromString(n),c=Array.isArray(r)?r:[r];o.addSignature(i,c);let u=await o.execute(s),y=await u.getReceipt(s),T=y.status===W.Success;if(!T)throw new Error(`ScheduleSign failed: receipt status ${y.status.toString()}`);return{txId:y.scheduledTransactionId?.toString()??u.transactionId.toString(),executed:T}}async function ve(e){if(!e||!e.trim())throw new Error("scheduleId must be a non-empty string");let t=p(),a=(await(await new pe().setScheduleId(pt.fromString(e)).execute(t)).getReceipt(t)).status===W.Success;return{scheduleId:e,deleted:a}}async function Fe(e,t){if(e.length>dt)throw new Error(`File too large: ${e.length} bytes exceeds max size of ${dt} bytes (1024 KB)`);let n=p(),r=S(),s=e.subarray(0,C),a=e.subarray(C),o=await new fe().setKeys([r.publicKey]).setContents(s).setMaxTransactionFee(new m(5));t&&o.setFileMemo(t),o.freezeWith(n);let c=await(await o.sign(r)).execute(n),u=await c.getReceipt(n);if(!u.fileId)throw new Error("Failed to create file: no fileId in receipt");let y=u.fileId.toString(),T=c.transactionId.toString();if(a.length>0)for(let f=0;f<a.length;f+=C){let F=a.subarray(f,f+C);await(await(await new me().setFileId(ge.fromString(y)).setContents(F).setMaxTransactionFee(new m(5)).freezeWith(n).sign(r)).execute(n)).getReceipt(n)}return{fileId:y,txId:T}}async function Ce(e){let t=process.env.HEDERA_NETWORK??"testnet",n={testnet:"https://testnet.mirrornode.hedera.com/api/v1",mainnet:"https://mainnet.mirrornode.hedera.com/api/v1",previewnet:"https://previewnet.mirrornode.hedera.com/api/v1"},s=`${n[t]??n.testnet}/files/${e}/content`,a=new AbortController,o=setTimeout(()=>a.abort(),1e4);try{let i=await fetch(s,{signal:a.signal});if(!i.ok)throw i.status===404?new Error(`File not found: ${e} (404)`):new Error(`Mirror Node error ${i.status}: ${s}`);let c=await i.arrayBuffer();return Buffer.from(c)}catch(i){throw i instanceof DOMException&&i.name==="AbortError"?new Error(`Mirror Node timeout after 10000ms: ${s}`):i}finally{clearTimeout(o)}}var K,dt,C,mt=h(()=>{"use strict";K=null;dt=1024*1024,C=4095});var Z={};A(Z,{burnPassportNFT:()=>Le,createScheduledTransfer:()=>tn,deleteScheduledTransaction:()=>rn,downloadFileFromHFS:()=>an,grantKyc:()=>Be,mintPassportNFT:()=>He,nftStore:()=>g,prepareA2ATopicMessage:()=>ze,prepareTopicMessageTransaction:()=>yt,prepareTransferTransaction:()=>je,resetMockState:()=>on,signScheduledTransaction:()=>en,signScheduledTransactionWithSignature:()=>nn,submitA2AMessage:()=>qe,submitAuditMessage:()=>Ke,submitDirectoryMessage:()=>Ge,submitSignedTopicMessage:()=>Je,submitTaskMessage:()=>We,topicMessages:()=>w,transferHbar:()=>Tt,transferHbarWithKey:()=>Qe,transferHbarWithSignature:()=>Xe,transferNFTToAgent:()=>Ue,updateNftMetadata:()=>Ve,uploadFileToHFS:()=>sn,wipeNFT:()=>Ye});function O(e,t){return`${e}:${t}`}function E(){let e=process.env.HEDERA_OPERATOR_ID??"0.0.2",t=Math.floor(Date.now()/1e3),n=Math.floor(Math.random()*1e9);return`${e}@${t}.${n}`}function U(){let e=Math.floor(Date.now()/1e3),t=Math.floor(Math.random()*1e9);return`${e}.${String(t).padStart(9,"0")}`}async function He(e,t){let r=(Y.get(e)??0)+1;Y.set(e,r);let s=process.env.HEDERA_OPERATOR_ID??"0.0.2",a=O(e,r);return g.set(a,{token_id:e,serial_number:r,account_id:s,metadata:t,deleted:!1,created_timestamp:U()}),{tokenId:e,serial:r}}async function Ue(e,t,n,r){let s=O(e,t),a=g.get(s);if(!a)throw new Error(`NFT not found: ${s}`);a.account_id=r}async function Be(e,t){}async function Le(e,t){let n=O(e,t);if(!g.has(n))throw new Error(`NFT not found: ${n}`);g.delete(n)}async function Ke(e){let t=process.env.AUDIT_TOPIC_ID??"0.0.555";return b(t,JSON.stringify(e))}async function Ge(e){let t=process.env.DIRECTORY_TOPIC_ID??"0.0.666";return b(t,JSON.stringify(e))}async function qe(e){let t=process.env.A2A_TOPIC_ID??"0.0.777";return b(t,JSON.stringify(e))}async function We(e){let t=process.env.MARKET_TOPIC_ID??"0.0.888";return b(t,JSON.stringify(e))}async function yt(e,t,n){let r=n??process.env.MARKET_TOPIC_ID??"0.0.888",s=JSON.stringify(t),a=`${e}-${Date.now()}-0000000000`,o=JSON.stringify({topicId:r,messageStr:s,agentAccountId:e,txId:a});return{txBytes:Buffer.from(o).toString("base64"),txId:a}}async function ze(e,t){let n=process.env.A2A_TOPIC_ID??"0.0.777";return yt(e,t,n)}async function Je(e,t,n){try{let r=JSON.parse(Buffer.from(e,"base64").toString("utf8")),s=r.topicId??process.env.MARKET_TOPIC_ID??"0.0.888";return b(s,r.messageStr??"{}")}catch{let r=process.env.MARKET_TOPIC_ID??"0.0.888";return b(r,"{}")}}function b(e,t){let n=(V.get(e)??0)+1;V.set(e,n);let r=E(),s=w.get(e)??[];return s.push({consensus_timestamp:U(),message:t,sequence_number:n,running_hash:`mock_hash_${n}`,transaction_id:r}),w.set(e,s),r}async function Ye(e,t,n){let r=O(e,n),s=g.get(r);if(!s)throw new Error(`NFT not found: ${r}`);s.deleted=!0}async function Ve(e,t,n){let r=O(e,t),s=g.get(r);if(!s)throw new Error(`NFT not found: ${r}`);s.metadata=n}async function Tt(e,t,n){return`0.0.${e.split(".")[2]}@${U()}`}async function Qe(e,t,n,r){return Tt(e,n,r)}async function je(e,t,n){return{txBytes:"mock-tx-bytes-base64",txId:E()}}async function Xe(e,t,n){let r=Array.isArray(n)?n:[n];if(!r.length||r.some(s=>!s||s.length===0))throw new Error("Invalid signature: signatureBytes must be non-empty");return E()}function Ze(){return Q+=1,1e4+Q}async function tn(e,t,n,r){let s=`0.0.${Ze()}`,a=`${e}@${U()}`;return{scheduleId:s,scheduleTxId:a}}async function en(e,t){if(!e||!e.trim())throw new Error("scheduleId must be a non-empty string");return{txId:E(),executed:!0}}async function nn(e,t,n,r){if(!e||!e.trim())throw new Error("scheduleId must be a non-empty string");return{txId:E(),executed:!0}}async function rn(e){if(!e||!e.trim())throw new Error("scheduleId must be a non-empty string");return{scheduleId:e,deleted:!0}}async function sn(e,t){if(e.length>gt)throw new Error(`File too large: ${e.length} bytes exceeds max size of ${gt} bytes (1024 KB)`);j+=1;let n=`0.0.${j}`;return X.set(n,Buffer.from(e)),{fileId:n,txId:E()}}async function an(e){let t=X.get(e);if(!t)throw new Error(`File not found: ${e} (404)`);return Buffer.from(t)}function on(){g.clear(),Y.clear(),w.clear(),V.clear(),Q=0,X.clear(),j=0}var g,Y,w,V,Q,X,j,gt,B=h(()=>{"use strict";g=new Map,Y=new Map,w=new Map,V=new Map;Q=0;X=new Map,j=0,gt=1024*1024});var tt={};A(tt,{getNftInfo:()=>un,getNftsForAccount:()=>pn,getNftsForToken:()=>dn,getScheduleInfo:()=>mn,getTopicMessages:()=>ln,getTopicMessagesPaginated:()=>fn});function k(){let e=process.env.HEDERA_NETWORK??"testnet";return ht[e]??ht.testnet}function cn(){let e=process.env.MIRROR_NODE_TIMEOUT_MS;if(!e)return 1e4;let t=parseInt(e,10);return Number.isFinite(t)&&t>0?t:1e4}async function M(e){let t=new AbortController,n=cn(),r=setTimeout(()=>t.abort(),n);try{let s=await fetch(e,{signal:t.signal});if(!s.ok){if(s.status===404)return{};throw new Error(`Mirror Node error ${s.status}: ${e}`)}return s.json()}catch(s){throw s instanceof DOMException&&s.name==="AbortError"?new Error(`Mirror Node timeout after ${n}ms: ${e}`):s}finally{clearTimeout(r)}}async function un(e,t){let n=k(),r=await M(`${n}/tokens/${e}/nfts/${t}`);if(!r||!r.serial_number)return null;let s=r;return s.metadata&&(s.metadata=Buffer.from(s.metadata,"base64").toString("utf8")),s}async function dn(e,t){let n=k(),r=`${n}/tokens/${e}/nfts?limit=100`,s=[];for(;r;){let a=await M(r),o=a.nfts??[];for(let c of o)c.metadata&&(c.metadata=Buffer.from(c.metadata,"base64").toString("utf8"));if(s.push(...o),t?.maxResults&&s.length>=t.maxResults)return s.slice(0,t.maxResults);let i=a.links?.next;r=i?`${n}${i}`:null}return s}async function pn(e,t){let n=k(),r=`${n}/accounts/${e}/nfts?limit=100`,s=[];for(;r;){let a=await M(r),o=a.nfts??[];for(let c of o)c.metadata&&(c.metadata=Buffer.from(c.metadata,"base64").toString("utf8"));if(s.push(...o),t?.maxResults&&s.length>=t.maxResults)return s.slice(0,t.maxResults);let i=a.links?.next;r=i?`${n}${i}`:null}return s}function _t(e){if(/^\d+\.\d+$/.test(e))return e;let t=new Date(e);if(isNaN(t.getTime()))return e;let n=Math.floor(t.getTime()/1e3),r=t.getTime()%1e3*1e6;return`${n}.${String(r).padStart(9,"0")}`}async function ln(e,t){let n=k(),r=new URLSearchParams;r.set("limit",String(t?.limit??100)),r.set("order","desc"),t?.startTime&&r.set("timestamp",`gt:${_t(t.startTime)}`),t?.endTime&&r.set("timestamp",`lt:${_t(t.endTime)}`);let s=`${n}/topics/${e}/messages?${r.toString()}`,a=[];for(;s;){let o=await M(s),i=o.messages??[];for(let u of i){let y=u.message,T=Buffer.from(y,"base64").toString("utf8"),f=u.transaction_id;if(!f&&u.chunk_info){let x=u.chunk_info.initial_transaction_id;x?.account_id&&x?.transaction_valid_start&&(f=`${x.account_id}-${x.transaction_valid_start.replace(".","-")}`)}a.push({consensus_timestamp:u.consensus_timestamp,message:T,sequence_number:u.sequence_number,running_hash:u.running_hash,chunk_info:u.chunk_info,transaction_id:f})}if(t?.maxResults&&a.length>=t.maxResults)return a.slice(0,t.maxResults);let c=o.links?.next;s=c?`${n}${c}`:null}return a}async function fn(e,t){let n=k(),r=t?.pageUrl??(()=>{let u=new URLSearchParams;return u.set("limit",String(t?.limit??100)),u.set("order","desc"),t?.startTime&&u.set("timestamp",`gt:${t.startTime}`),t?.endTime&&u.set("timestamp",`lt:${t.endTime}`),`${n}/topics/${e}/messages?${u.toString()}`})(),s=await M(r),o=(s.messages??[]).map(u=>({consensus_timestamp:u.consensus_timestamp,message:Buffer.from(u.message,"base64").toString("utf8"),sequence_number:u.sequence_number,running_hash:u.running_hash,chunk_info:u.chunk_info})),i=s.links?.next,c=i?`${n}${i}`:null;return{messages:o,nextPageUrl:c}}async function mn(e){let t=k(),n=await M(`${t}/schedules/${e}`);return!n||!n.schedule_id?null:{scheduleId:n.schedule_id,executed:!!n.executed,deleted:!!n.deleted,expirationTime:n.expiration_time?String(n.expiration_time):void 0,memo:n.memo?String(n.memo):void 0,signers:Array.isArray(n.signatures)?n.signatures.map(r=>String(r.public_key??"")):[],adminKey:n.admin_key?String(n.admin_key):void 0}}var ht,St=h(()=>{"use strict";ht={testnet:"https://testnet.mirrornode.hedera.com/api/v1",mainnet:"https://mainnet.mirrornode.hedera.com/api/v1",previewnet:"https://previewnet.mirrornode.hedera.com/api/v1"}});var et={};A(et,{getNftInfo:()=>gn,getNftsForAccount:()=>Tn,getNftsForToken:()=>yn,getScheduleInfo:()=>Sn,getTopicMessages:()=>hn,getTopicMessagesPaginated:()=>_n});async function gn(e,t){let n=`${e}:${t}`,r=g.get(n);return r?{...r}:null}async function yn(e,t){let n=[];for(let r of g.values())r.token_id===e&&n.push({...r});return t?.maxResults?n.slice(0,t.maxResults):n}async function Tn(e,t){let n=[];for(let r of g.values())r.account_id===e&&n.push({...r});return t?.maxResults?n.slice(0,t.maxResults):n}async function hn(e,t){let r=[...w.get(e)??[]];t?.startTime&&(r=r.filter(o=>o.consensus_timestamp>t.startTime)),t?.endTime&&(r=r.filter(o=>o.consensus_timestamp<t.endTime));let s=t?.limit??100;r.sort((o,i)=>i.sequence_number-o.sequence_number);let a=r.slice(0,s);return t?.maxResults?a.slice(0,t.maxResults):a}async function _n(e,t){let r=[...w.get(e)??[]];t?.startTime&&(r=r.filter(o=>o.consensus_timestamp>t.startTime)),t?.endTime&&(r=r.filter(o=>o.consensus_timestamp<t.endTime));let s=t?.limit??100;return r.sort((o,i)=>i.sequence_number-o.sequence_number),{messages:r.slice(0,s),nextPageUrl:null}}async function Sn(e){return{scheduleId:e,executed:!1,deleted:!1,signers:[],memo:"mock-escrow"}}var nt=h(()=>{"use strict";B()});import{Transaction as xn,PrivateKey as wn}from"@hashgraph/sdk";function rt(e,t){if(!e)throw new Error("txBytesBase64 is required");if(!t)throw new Error("privateKeyHex is required");let n=Buffer.from(e,"base64"),r=xn.fromBytes(n),s=wn.fromString(t),a=s.signTransaction(r,!0),o=s.publicKey.toStringDer(),i=Array.isArray(a)?a:[a];return{publicKey:o,signature:JSON.stringify(i.map(c=>Buffer.from(c).toString("base64")))}}var xt=h(()=>{"use strict"});function In(){let e=process.env.DATAHUB_TIMEOUT_MS;if(!e)return 3e4;let t=parseInt(e,10);return Number.isFinite(t)&&t>0?t:3e4}function En(e){return Date.now()+bn>=e.getTime()}var An,P,bn,kn,Mn,Rn,Dn,$n,Nn,On,Pn,vn,Fn,Cn,Hn,wt=h(()=>{"use strict";An="http://localhost:8080",P=class{baseUrl;staticToken;actorId;timeoutMs;mockMode;cachedToken=null;constructor(){this.baseUrl=(process.env.DATAHUB_GMS_URL??An).replace(/\/$/,""),this.staticToken=process.env.DATAHUB_GMS_TOKEN??process.env.DATAHUB_TOKEN,this.actorId=process.env.DATAHUB_GMS_ACTOR_ID??"datahub",this.timeoutMs=In(),this.mockMode=!process.env.DATAHUB_ENABLED||process.env.DATAHUB_ENABLED==="false"}async generateToken(){let n=(await this.rawGraphQL(Hn,{type:"PERSONAL",actorId:this.actorId},!1)).datahubAccessToken;return this.cachedToken={accessToken:n.accessToken,expiresAt:new Date(n.expiresAt)},n.accessToken}async ensureToken(){return this.staticToken?this.staticToken:this.cachedToken&&!En(this.cachedToken.expiresAt)?this.cachedToken.accessToken:this.generateToken()}async rawGraphQL(t,n,r){let s=new AbortController,a=setTimeout(()=>s.abort(),this.timeoutMs);try{let o={"Content-Type":"application/json"};r&&this.cachedToken?o.Authorization=`Bearer ${this.cachedToken.accessToken}`:r&&this.staticToken&&(o.Authorization=`Bearer ${this.staticToken}`);let i=await fetch(`${this.baseUrl}/api/graphql`,{method:"POST",headers:o,body:JSON.stringify({query:t,variables:n}),signal:s.signal});if(!i.ok){let u=await i.text().catch(()=>"");throw new Error(`DataHub HTTP ${i.status}: ${u||i.statusText}`)}let c=await i.json();if(c.errors&&c.errors.length>0)throw new Error(c.errors.map(u=>u.message).join("; "));if(!c.data)throw new Error("DataHub returned no data");return c.data}catch(o){throw o instanceof DOMException&&o.name==="AbortError"?new Error(`DataHub timeout after ${this.timeoutMs}ms`):o}finally{clearTimeout(a)}}async graphql(t,n){let r=await this.ensureToken();try{return await this.doGraphQL(t,n,r)}catch(s){if(s instanceof Error&&s.message.startsWith("DataHub HTTP 401")){this.cachedToken=null;let a=await this.ensureToken();return this.doGraphQL(t,n,a)}throw s}}async doGraphQL(t,n,r){let s=new AbortController,a=setTimeout(()=>s.abort(),this.timeoutMs);try{let o=await fetch(`${this.baseUrl}/api/graphql`,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${r}`},body:JSON.stringify({query:t,variables:n}),signal:s.signal});if(!o.ok){let c=await o.text().catch(()=>"");throw new Error(`DataHub HTTP ${o.status}: ${c||o.statusText}`)}let i=await o.json();if(i.errors&&i.errors.length>0)throw new Error(i.errors.map(c=>c.message).join("; "));if(!i.data)throw new Error("DataHub returned no data");return i.data}catch(o){throw o instanceof DOMException&&o.name==="AbortError"?new Error(`DataHub timeout after ${this.timeoutMs}ms`):o}finally{clearTimeout(a)}}async search(t,n,r){if(this.mockMode)return{entities:[],total:0};let s=await this.graphql(kn,{query:t,type:n,limit:r});return{total:s.search.total,entities:s.search.searchResults.map(a=>a.entity)}}async getEntity(t){return this.mockMode?null:(await this.graphql(Mn,{urn:t})).entity}async listSchemaFields(t){if(this.mockMode)return[];let n=await this.graphql(Rn,{urn:t});return n.dataset?.schemaMetadata?n.dataset.schemaMetadata.fields.map(r=>({fieldPath:r.fieldPath,type:r.type?.type??"UNKNOWN"})):[]}async getLineage(t){if(this.mockMode)return{upstreams:[],downstreams:[]};let n=await this.graphql(Dn,{urn:t});return{upstreams:n.lineage.upstreams.map(r=>r.entity),downstreams:n.lineage.downstreams.map(r=>r.entity)}}async getDatasetAssertions(t){if(this.mockMode)return[];let n=await this.graphql($n,{urn:t});return n.dataset?.assertions?n.dataset.assertions.assertions.map(r=>r.entity):[]}async addTerms(t,n,r,s){return this.mockMode?{}:await this.graphql(Nn,{termUrns:t,resourceUrn:n,subResourceType:r??null,subResource:s??null})}async createGlossaryTerm(t,n,r){return this.mockMode?null:(await this.graphql(On,{name:t,description:n,parentNodeUrn:r})).createGlossaryTerm?.urn??null}async upsertDatasetSchemaAssertionMonitor(t,n,r,s){return this.mockMode?null:(await this.graphql(Pn,{entityUrn:t,fields:n,compatibility:r,description:s})).upsertDatasetSchemaAssertionMonitor?.urn??null}async upsertDatasetFreshnessAssertionMonitor(t,n,r){return this.mockMode?null:(await this.graphql(vn,{entityUrn:t,schedule:n,description:r})).upsertDatasetFreshnessAssertionMonitor?.urn??null}async updateLineage(t,n){return this.mockMode?{}:await this.graphql(Fn,{edgesToAdd:t,edgesToRemove:n})}async getAssertionResults(t){if(this.mockMode)return[];let n=await this.graphql(Cn,{urn:t});return n.assertion?.runEvents?n.assertion.runEvents.map(r=>({status:r.status,timestamp:r.timestamp})):[]}};bn=5*60*1e3;kn=`
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
`,Mn=`
  query GetEntity($urn: String!) {
    entity(urn: $urn) {
      urn
      type
    }
  }
`,Rn=`
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
`,Dn=`
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
`,$n=`
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
`,Nn=`
  mutation AddTerms($termUrns: [String!]!, $resourceUrn: String!, $subResourceType: String, $subResource: String) {
    addTerms(termUrns: $termUrns, resourceUrn: $resourceUrn, subResourceType: $subResourceType, subResource: $subResource)
  }
`,On=`
  mutation CreateGlossaryTerm($name: String!, $description: String!, $parentNodeUrn: String!) {
    createGlossaryTerm(input: { name: $name, description: $description, parentNodeUrn: $parentNodeUrn }) {
      urn
    }
  }
`,Pn=`
  mutation UpsertSchemaAssertion($entityUrn: String!, $fields: [String!]!, $compatibility: String!, $description: String!) {
    upsertDatasetSchemaAssertionMonitor(entityUrn: $entityUrn, fields: $fields, compatibility: $compatibility, description: $description) {
      urn
    }
  }
`,vn=`
  mutation UpsertFreshnessAssertion($entityUrn: String!, $schedule: String!, $description: String!) {
    upsertDatasetFreshnessAssertionMonitor(entityUrn: $entityUrn, schedule: $schedule, description: $description) {
      urn
    }
  }
`,Fn=`
  mutation UpdateLineage($edgesToAdd: [LineageEdgeInput!]!, $edgesToRemove: [LineageEdgeInput!]!) {
    updateLineage(edgesToAdd: $edgesToAdd, edgesToRemove: $edgesToRemove)
  }
`,Cn=`
  query GetAssertionResults($urn: String!) {
    assertion(urn: $urn) {
      runEvents {
        status
        timestamp
      }
    }
  }
`,Hn=`
  mutation GenerateToken($type: AccessTokenTokenType!, $actorId: String!) {
    datahubAccessToken(input: { type: $type, actorId: $actorId }) {
      accessToken
      expiresAt
    }
  }
`});var Et={};A(Et,{didToAccountId:()=>It,extractTokenAndSerial:()=>st,getMessageDirection:()=>bt,isValidA2ADid:()=>At});function At(e){return Un.test(e)}function st(e){let t=Bn.exec(e);return t?{tokenId:t[1],serial:parseInt(t[2],10)}:null}async function It(e){let t=st(e);if(!t)return null;try{let{getNftInfo:n}=await Promise.resolve().then(()=>(v(),kt)),r=await n(t.tokenId,t.serial);return!r||r.deleted?null:r.account_id}catch{return null}}function bt(e,t,n,r){if(e===n&&t===r)return"A\u2192B";if(e===r&&t===n)return"B\u2192A";throw new Error("Invalid message direction")}var Un,Bn,at=h(()=>{"use strict";Un=/^did:hcs:\d+\.\d+\.\d+:\d+$/,Bn=/^did:hcs:(.+):(\d+)$/});var kt={};A(kt,{DataHubClient:()=>P,burnPassportNFT:()=>Dt,createScheduledTransfer:()=>zt,deleteScheduledTransaction:()=>Yt,downloadFileFromHFS:()=>Qt,getNftInfo:()=>ot,getNftsForAccount:()=>Xt,getNftsForToken:()=>jt,getScheduleInfo:()=>Kn,getTaskMessages:()=>te,getTopicMessages:()=>it,getTopicMessagesPaginated:()=>Zt,grantKyc:()=>Nt,mintPassportNFT:()=>Rt,prepareA2ATopicMessage:()=>Ht,prepareTopicMessageTransaction:()=>Ct,prepareTransferTransaction:()=>qt,signScheduledTransaction:()=>Jt,signScheduledTransactionWithSignature:()=>Ln,signTransactionBytes:()=>rt,submitA2AMessage:()=>vt,submitAuditMessage:()=>Ot,submitDirectoryMessage:()=>Pt,submitSignedTopicMessage:()=>Ut,submitTaskMessage:()=>Ft,transferHbar:()=>Kt,transferHbarWithKey:()=>Gt,transferHbarWithSignature:()=>Wt,transferNFTToAgent:()=>$t,updateNftMetadata:()=>Lt,uploadFileToHFS:()=>Vt,verifyA2ADid:()=>ee,wipeNFT:()=>Bt});function Mt(){return process.env.MOCK_HEDERA==="true"}function d(){return Mt()?Z:J}function R(){return Mt()?et:tt}async function Rt(e,t){return d().mintPassportNFT(e,t)}async function Dt(e,t){return d().burnPassportNFT(e,t)}async function $t(e,t,n,r){return d().transferNFTToAgent(e,t,n,r)}async function Nt(e,t){return d().grantKyc(e,t)}async function Ot(e){return d().submitAuditMessage(e)}async function Pt(e){return d().submitDirectoryMessage(e)}async function vt(e){return d().submitA2AMessage(e)}async function Ft(e){return d().submitTaskMessage(e)}async function Ct(e,t,n){return d().prepareTopicMessageTransaction(e,t,n)}async function Ht(e,t){return d().prepareA2ATopicMessage(e,t)}async function Ut(e,t,n){return d().submitSignedTopicMessage(e,t,n)}async function Bt(e,t,n){return d().wipeNFT(e,t,n)}async function Lt(e,t,n){return d().updateNftMetadata(e,t,n)}async function Kt(e,t,n){return d().transferHbar(e,t,n)}async function Gt(e,t,n,r){return d().transferHbarWithKey(e,t,n,r)}async function qt(e,t,n){return d().prepareTransferTransaction(e,t,n)}async function Wt(e,t,n){return d().transferHbarWithSignature(e,t,n)}async function zt(e,t,n,r){return d().createScheduledTransfer(e,t,n,r)}async function Jt(e,t){return d().signScheduledTransaction(e,t)}async function Ln(e,t,n,r){return d().signScheduledTransactionWithSignature(e,t,n,r)}async function Yt(e){return d().deleteScheduledTransaction(e)}async function Vt(e,t){return d().uploadFileToHFS(e,t)}async function Qt(e){return d().downloadFileFromHFS(e)}async function Kn(e){return R().getScheduleInfo(e)}async function ot(e,t){return R().getNftInfo(e,t)}async function jt(e,t){return R().getNftsForToken(e,t)}async function Xt(e,t){return R().getNftsForAccount(e,t)}async function it(e,t){return R().getTopicMessages(e,t)}async function Zt(e,t){return R().getTopicMessagesPaginated(e,t)}async function te(e,t){let n=await it(e,t),r=[];for(let s of n)try{let a=JSON.parse(s.message);ut(a)&&r.push({message:a,txId:s.transaction_id})}catch{}return r}async function ee(e){let{extractTokenAndSerial:t}=await Promise.resolve().then(()=>(at(),Et)),n=t(e);if(!n)return!1;try{let r=await ot(n.tokenId,n.serial);return r!==null&&!r.deleted}catch{return!1}}var v=h(()=>{"use strict";L();mt();B();St();nt();xt();wt()});L();v();B();nt();async function ar(e,t){let n=process.env.HEDERA_OPERATOR_ID??"0.0.2",r=Math.floor(Date.now()/1e3),s=Math.floor(Math.random()*1e9);return`${n}@${r}.${s}`}v();at();var Gn=[{name:"bronze",price:10,capabilities:["api_call","payment"]},{name:"silver",price:50,capabilities:["api_call","payment","data_provide"]},{name:"gold",price:200,capabilities:["api_call","payment","data_provide","verified","marketplace"]},{name:"platinum",price:500,capabilities:["api_call","payment","data_provide","verified","marketplace","multi_agent","governance"]}];function qn(){return Gn.map(e=>({...e,capabilities:[...e.capabilities]}))}var ct=[{name:"request_passport",description:"Issue a new agent passport NFT (x402 payment)",category:"passport"},{name:"upload_image",description:"Upload image to IPFS, return ipfs:// URI",category:"passport"},{name:"verify_passport",description:"Verify passport on-chain status",category:"passport"},{name:"get_passport",description:"Get passport metadata",category:"passport"},{name:"list_passports",description:"List all issued passports",category:"passport"},{name:"upgrade_tier",description:"Upgrade passport tier",category:"passport"},{name:"revoke_passport",description:"Revoke passport (admin)",category:"passport"},{name:"get_audit_trail",description:"Get audit events for a passport",category:"audit"},{name:"get_tier_requirements",description:"Get tier catalog with pricing",category:"audit"},{name:"register_agent",description:"Register agent in HCS directory",category:"directory"},{name:"find_agents",description:"Find agents by capability",category:"directory"},{name:"send_message",description:"Send A2A message (server-key)",category:"a2a"},{name:"send_message_with_key",description:"Send agent-signed A2A message",category:"a2a"},{name:"get_inbox",description:"Get agent inbox messages",category:"a2a"},{name:"get_conversation",description:"Get conversation between two agents",category:"a2a"},{name:"post_task",description:"Post marketplace task",category:"market"},{name:"list_tasks",description:"List marketplace tasks",category:"market"},{name:"claim_task",description:"Claim a marketplace task",category:"market"},{name:"deliver_result",description:"Deliver task results",category:"market"},{name:"prepare_payment",description:"Prepare frozen payment for offline signing",category:"market"},{name:"complete_task",description:"Complete task with P2P HBAR payment",category:"market"},{name:"sign_transaction",description:"Sign frozen Hedera transaction bytes",category:"auth"},{name:"complete_task_with_key",description:"Complete task with agent key (convenience)",category:"market"},{name:"post_task_with_key",description:"Post task with agent-signed HCS",category:"market"},{name:"claim_task_with_key",description:"Claim task with agent-signed HCS",category:"market"},{name:"deliver_result_with_key",description:"Deliver result with agent-signed HCS",category:"market"},{name:"get_guide",description:"Fetch a skill guide as markdown",category:"guide"},{name:"list_guides",description:"List available skill guides",category:"guide"},{name:"get_agent_card",description:"Fetch server Agent Card",category:"discovery"},{name:"search_agents",description:"Search agents by query or capability",category:"discovery"},{name:"get_server_info",description:"Fetch llms.txt (server info for LLMs)",category:"discovery"},{name:"get_ai_sitemap",description:"Fetch AI sitemap",category:"discovery"}];function Wn(){let e=process.env.BASE_URL&&process.env.BASE_URL.startsWith("http")?process.env.BASE_URL:"http://localhost:4021",t=process.env.x402_FACILITATOR_URL??process.env.FACILITATOR_URL??"https://api.testnet.blocky402.com",n=process.env.FEE_PAYER_ACCOUNT??"0.0.7162784",r=process.env.HEDERA_NETWORK??"testnet";return`# Agent Passport on Hedera

> Agent identity, discovery, and micropayments on Hedera L1.

## Base URL

[${e}](${e})

## Authentication

No API key required. Paid endpoints use [x402](https://x402.org) (HTTP 402) payment flow.

## Machine-readable Entry Points

- [Agent Card JSON](/.well-known/agent-card.json) \u2014 Server Agent Card (capabilities, endpoints, payment, blockchain)
- [OpenAPI 3.1 Spec](/api/specs) \u2014 Full API specification (JSON)
- [AI Sitemap](/ai-sitemap.xml) \u2014 AI resource discovery map (XML)
- [llms.txt](/llms.txt) \u2014 This file (Markdown API spec for LLMs)
- [MCP Server](/mcp) \u2014 MCP server endpoint (JSON-RPC over HTTP)

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

### MCP Tools (${ct.length} total)

| Tool | Category | Description |
|------|----------|-------------|
${ct.map(s=>`| ${s.name} | ${s.category} | ${s.description} |`).join(`
`)}

### Curl Examples

\`\`\`bash
# 1. Verify a passport on-chain
curl ${e}/passport/0.0.1234/1

# 2. Search agents by capability
curl "${e}/agents?capability=payment"

# 3. Register an agent in HCS directory
curl -X POST ${e}/agents/register \\
  -H "Content-Type: application/json" \\
  -d '{"did":"did:hcs:0.0.1234:1","tokenId":"0.0.1234","serial":1,"accountId":"0.0.5678","name":"MyAgent","capabilities":["api_call"],"endpoint":"https://my-agent.example.com","tier":"bronze"}'

# 4. Fetch server Agent Card
curl ${e}/.well-known/agent-card.json

# 5. Get tier catalog
curl ${e}/catalog

# 6. Submit A2A message
curl -X POST ${e}/a2a/send \\
  -H "Content-Type: application/json" \\
  -d '{"from":"did:hcs:0.0.1234:1","to":"did:hcs:0.0.5678:2","body":"Hello!"}'

# 7. Browse marketplace tasks
curl "${e}/market/tasks?limit=20"
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

- Network: Hedera ${r}
- Facilitator: [${t}](${t})
- Fee Payer: ${n}
- Asset: HBAR (0.0.0)
- Amount: in tinybars (1 HBAR = 100,000,000 tinybars)
`}v();export{P as DataHubClient,ct as MCP_TOOLS_INDEX,Jn as TIER_PRICES_HBAR,Dt as burnPassportNFT,zt as createScheduledTransfer,Yt as deleteScheduledTransaction,It as didToAccountId,Qt as downloadFileFromHFS,st as extractTokenAndSerial,qn as getCatalog,Wn as getLlmsTxt,bt as getMessageDirection,ot as getNftInfo,Xt as getNftsForAccount,jt as getNftsForToken,Sn as getScheduleInfo,te as getTaskMessages,it as getTopicMessages,Zt as getTopicMessagesPaginated,Nt as grantKyc,At as isValidA2ADid,Yn as isValidA2AMessage,ut as isValidTaskMessage,Rt as mintPassportNFT,ar as mockSettle,g as nftStore,Ht as prepareA2ATopicMessage,Ct as prepareTopicMessageTransaction,qt as prepareTransferTransaction,on as resetMockState,Jt as signScheduledTransaction,nn as signScheduledTransactionWithSignature,rt as signTransactionBytes,vt as submitA2AMessage,Ot as submitAuditMessage,Pt as submitDirectoryMessage,Ut as submitSignedTopicMessage,Ft as submitTaskMessage,w as topicMessages,Kt as transferHbar,Gt as transferHbarWithKey,Wt as transferHbarWithSignature,$t as transferNFTToAgent,Lt as updateNftMetadata,Vt as uploadFileToHFS,ee as verifyA2ADid,Bt as wipeNFT};
