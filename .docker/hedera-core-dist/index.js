var Wt=Object.defineProperty;var g=(e,t)=>()=>(e&&(t=e(e=0)),t);var S=(e,t)=>{for(var n in t)Wt(e,n,{get:t[n],enumerable:!0})};function Mn(e){if(typeof e!="object"||e===null)return!1;let t=e;return t.type==="a2a_message"&&typeof t.from=="string"&&typeof t.to=="string"&&typeof t.body=="string"&&typeof t.contentType=="string"&&typeof t.timestamp=="number"}function nt(e){if(typeof e!="object"||e===null)return!1;let t=e;if(typeof t.taskId!="string"||typeof t.timestamp!="number")return!1;switch(t.type){case"task_posted":return typeof t.posterDid=="string"&&typeof t.title=="string"&&typeof t.description=="string"&&typeof t.priceHbar=="number"&&Array.isArray(t.capabilities)&&t.capabilities.every(n=>typeof n=="string");case"task_claimed":return typeof t.claimerDid=="string";case"task_delivered":return(t.resultIpfs===void 0||typeof t.resultIpfs=="string")&&(t.resultBody===void 0||typeof t.resultBody=="string");case"task_completed":return typeof t.paymentTxId=="string";case"task_verification_failed":return typeof t.claimerDid=="string"&&typeof t.report=="string";case"task_escrow_created":return typeof t.scheduleId=="string"&&typeof t.amountHbar=="number";case"task_cancelled":return t.scheduleId===void 0||typeof t.scheduleId=="string";case"task_reward_increased":return typeof t.oldPriceHbar=="number"&&typeof t.newPriceHbar=="number"&&typeof t.newScheduleId=="string";default:return!1}}var En,F=g(()=>{"use strict";En={bronze:10,silver:50,gold:200,platinum:500}});var B={};S(B,{burnPassportNFT:()=>re,createScheduledTransfer:()=>_e,deleteScheduledTransaction:()=>Se,grantKyc:()=>ae,mintPassportNFT:()=>ne,prepareA2ATopicMessage:()=>pe,prepareTopicMessageTransaction:()=>ct,prepareTransferTransaction:()=>ye,signScheduledTransaction:()=>he,submitA2AMessage:()=>ce,submitAuditMessage:()=>oe,submitDirectoryMessage:()=>ie,submitSignedTopicMessage:()=>de,submitTaskMessage:()=>ue,transferHbar:()=>le,transferHbarWithKey:()=>ge,transferHbarWithSignature:()=>Te,transferNFTToAgent:()=>se,updateNftMetadata:()=>fe,wipeNFT:()=>me});import{Client as A,PrivateKey as O,PublicKey as rt,AccountId as m,TokenId as x,TopicId as M,Transaction as st,TokenMintTransaction as Jt,TokenBurnTransaction as Yt,TokenWipeTransaction as Vt,TransferTransaction as k,TopicMessageSubmitTransaction as R,TransactionId as zt,TokenUpdateNftsTransaction as Qt,TokenGrantKycTransaction as jt,ScheduleCreateTransaction as Xt,ScheduleSignTransaction as Zt,ScheduleDeleteTransaction as te,ScheduleId as at,Status as ot,Timestamp as ee,Hbar as l}from"@hashgraph/sdk";import it from"long";function d(){if(L)return L;let e=process.env.HEDERA_NETWORK??"testnet",t=process.env.HEDERA_OPERATOR_ID,n=process.env.HEDERA_OPERATOR_KEY;if(!t||!n)throw new Error("HEDERA_OPERATOR_ID and HEDERA_OPERATOR_KEY must be set");let r=e==="mainnet"?A.forMainnet():A.forTestnet();return r.setOperator(m.fromString(t),O.fromStringED25519(n)),r.setDefaultMaxTransactionFee(new l(50)),r.setDefaultMaxQueryPayment(new l(1)),L=r,r}function T(){let e=process.env.HEDERA_OPERATOR_KEY;if(!e)throw new Error("HEDERA_OPERATOR_KEY must be set");return O.fromStringED25519(e)}async function ne(e,t){let n=d(),r=T(),s=new TextEncoder().encode(t),o=await(await(await new Jt().setTokenId(x.fromString(e)).addMetadata(s).freezeWith(n).sign(r)).execute(n)).getReceipt(n);return{tokenId:e,serial:o.serials[0].toNumber()}}async function re(e,t){let n=d(),r=T();await(await(await new Yt().setTokenId(x.fromString(e)).setSerials([it.fromNumber(t)]).freezeWith(n).sign(r)).execute(n)).getReceipt(n)}async function se(e,t,n,r){let s=d(),a=T();await(await(await new k().addNftTransfer(x.fromString(e),t,m.fromString(n),m.fromString(r)).freezeWith(s).sign(a)).execute(s)).getReceipt(s)}async function ae(e,t){let n=d(),r=T();await(await(await new jt().setTokenId(x.fromString(e)).setAccountId(m.fromString(t)).freezeWith(n).sign(r)).execute(n)).getReceipt(n)}async function oe(e){let t=d(),n=process.env.AUDIT_TOPIC_ID;if(!n)throw new Error("AUDIT_TOPIC_ID must be set");let r=JSON.stringify(e),s=new R().setTopicId(M.fromString(n)).setMessage(r);r.length>1024&&s.setMaxChunks(10);let a=await s.execute(t);return await a.getReceipt(t),a.transactionId.toString()}async function ie(e){let t=d(),n=process.env.DIRECTORY_TOPIC_ID;if(!n)throw new Error("DIRECTORY_TOPIC_ID must be set");let r=JSON.stringify(e),s=new R().setTopicId(M.fromString(n)).setMessage(r);r.length>1024&&s.setMaxChunks(10);let a=await s.execute(t);return await a.getReceipt(t),a.transactionId.toString()}async function ce(e){let t=d(),n=process.env.A2A_TOPIC_ID;if(!n)throw new Error("A2A_TOPIC_ID must be set");let r=JSON.stringify(e),s=new R().setTopicId(M.fromString(n)).setMessage(r);r.length>1024&&s.setMaxChunks(10);let a=await s.execute(t);return await a.getReceipt(t),a.transactionId.toString()}async function ue(e){let t=d(),n=process.env.MARKET_TOPIC_ID;if(!n)throw new Error("MARKET_TOPIC_ID must be set");let r=JSON.stringify(e),s=new R().setTopicId(M.fromString(n)).setMessage(r);r.length>1024&&s.setMaxChunks(10);let a=await s.execute(t);return await a.getReceipt(t),a.transactionId.toString()}async function ct(e,t,n){let r=d(),s=n??process.env.MARKET_TOPIC_ID;if(!s)throw new Error("Topic ID must be set (pass topicIdOverride or set MARKET_TOPIC_ID)");let a=JSON.stringify(t),o=new R().setTopicId(M.fromString(s)).setMessage(a).setTransactionId(zt.generate(m.fromString(e)));a.length>1024&&o.setMaxChunks(10),o.freezeWith(r);let i=Buffer.from(o.toBytes()).toString("base64"),c=o.transactionId?.toString()??"";return{txBytes:i,txId:c}}async function pe(e,t){let n=process.env.A2A_TOPIC_ID;if(!n)throw new Error("A2A_TOPIC_ID must be set");return ct(e,t,n)}async function de(e,t,n){let r=d(),s=Buffer.from(e,"base64"),a=st.fromBytes(s),o=rt.fromString(t);a.addSignature(o,n);let i=await a.execute(r);return await i.getReceipt(r),i.transactionId.toString()}async function me(e,t,n){let r=d(),s=T();await(await(await new Vt().setTokenId(x.fromString(e)).setAccountId(m.fromString(t)).setSerials([n]).freezeWith(r).sign(s)).execute(r)).getReceipt(r)}async function fe(e,t,n){let r=d(),s=T(),a=new TextEncoder().encode(n);await(await(await new Qt().setTokenId(x.fromString(e)).setSerialNumbers([it.fromNumber(t)]).setMetadata(a).freezeWith(r).sign(s)).execute(r)).getReceipt(r)}async function le(e,t,n){let r=d(),a=await new k().addHbarTransfer(m.fromString(e),l.fromTinybars(-Math.round(n*1e8))).addHbarTransfer(m.fromString(t),l.fromTinybars(Math.round(n*1e8))).execute(r);return await a.getReceipt(r),a.transactionId.toString()}async function ge(e,t,n,r){let s=process.env.HEDERA_NETWORK??"testnet",a=m.fromString(e),o=O.fromStringDer(t),i=s==="mainnet"?A.forMainnet():A.forTestnet();i.setOperator(a,o);try{let u=await new k().addHbarTransfer(a,l.fromTinybars(-Math.round(r*1e8))).addHbarTransfer(m.fromString(n),l.fromTinybars(Math.round(r*1e8))).execute(i);return await u.getReceipt(i),u.transactionId.toString()}finally{i.close()}}async function ye(e,t,n){let r=d(),a=await new k().addHbarTransfer(m.fromString(e),l.fromTinybars(-Math.round(n*1e8))).addHbarTransfer(m.fromString(t),l.fromTinybars(Math.round(n*1e8))).freezeWith(r),o=Buffer.from(a.toBytes()).toString("base64"),i=a.transactionId?.toString();if(!i)throw new Error("Failed to generate transaction ID");return{txBytes:o,txId:i}}async function Te(e,t,n){let r=d(),s=Buffer.from(e,"base64"),a=st.fromBytes(s),o=rt.fromString(t),i=Array.isArray(n)?n:[n];a.addSignature(o,i);let c=await a.execute(r);return await c.getReceipt(r),c.transactionId.toString()}async function _e(e,t,n,r){let s=d(),a=Math.round(n*1e8),o=new k().addHbarTransfer(m.fromString(e),l.fromTinybars(-a)).addHbarTransfer(m.fromString(t),l.fromTinybars(a)),i=new Xt().setScheduledTransaction(o);r?.adminKey!==!1&&i.setAdminKey(T().publicKey);let c=r?.expirationSeconds??86400,u=new Date(Date.now()+c*1e3);i.setExpirationTime(ee.fromDate(u));let U=r?.memo??`escrow:${e}:${t}:${n}`;i.setScheduleMemo(U);let $=await i.execute(s),y=await $.getReceipt(s);if(!y.scheduleId)throw new Error("Failed to create scheduled transaction: no scheduleId in receipt");let et=y.scheduleId.toString(),h=y.scheduledTransactionId?.toString()??$.transactionId.toString();return{scheduleId:et,scheduleTxId:h}}async function he(e,t){if(!e||!e.trim())throw new Error("scheduleId must be a non-empty string");let n=process.env.HEDERA_NETWORK??"testnet",r=O.fromStringDer(t),s=m.fromString(process.env.HEDERA_OPERATOR_ID??"0.0.2"),a=n==="mainnet"?A.forMainnet():A.forTestnet();a.setOperator(s,r);try{let i=await new Zt().setScheduleId(at.fromString(e)).execute(a),u=(await i.getReceipt(a)).status===ot.Success;return{txId:i.transactionId.toString(),executed:u}}finally{a.close()}}async function Se(e){if(!e||!e.trim())throw new Error("scheduleId must be a non-empty string");let t=d(),a=(await(await new te().setScheduleId(at.fromString(e)).execute(t)).getReceipt(t)).status===ot.Success;return{scheduleId:e,deleted:a}}var L,ut=g(()=>{"use strict";L=null});var W={};S(W,{burnPassportNFT:()=>we,createScheduledTransfer:()=>He,deleteScheduledTransaction:()=>Fe,grantKyc:()=>Ie,mintPassportNFT:()=>Ae,nftStore:()=>f,prepareA2ATopicMessage:()=>Re,prepareTopicMessageTransaction:()=>pt,prepareTransferTransaction:()=>Pe,resetMockState:()=>Le,signScheduledTransaction:()=>Ue,submitA2AMessage:()=>Me,submitAuditMessage:()=>be,submitDirectoryMessage:()=>Ee,submitSignedTopicMessage:()=>De,submitTaskMessage:()=>ke,topicMessages:()=>_,transferHbar:()=>dt,transferHbarWithKey:()=>Oe,transferHbarWithSignature:()=>ve,transferNFTToAgent:()=>xe,updateNftMetadata:()=>$e,wipeNFT:()=>Ne});function D(e,t){return`${e}:${t}`}function P(){let e=process.env.HEDERA_OPERATOR_ID??"0.0.2",t=Math.floor(Date.now()/1e3),n=Math.floor(Math.random()*1e9);return`${e}@${t}.${n}`}function v(){let e=Math.floor(Date.now()/1e3),t=Math.floor(Math.random()*1e9);return`${e}.${String(t).padStart(9,"0")}`}async function Ae(e,t){let r=(K.get(e)??0)+1;K.set(e,r);let s=process.env.HEDERA_OPERATOR_ID??"0.0.2",a=D(e,r);return f.set(a,{token_id:e,serial_number:r,account_id:s,metadata:t,deleted:!1,created_timestamp:v()}),{tokenId:e,serial:r}}async function xe(e,t,n,r){let s=D(e,t),a=f.get(s);if(!a)throw new Error(`NFT not found: ${s}`);a.account_id=r}async function Ie(e,t){}async function we(e,t){let n=D(e,t);if(!f.has(n))throw new Error(`NFT not found: ${n}`);f.delete(n)}async function be(e){let t=process.env.AUDIT_TOPIC_ID??"0.0.555";return I(t,JSON.stringify(e))}async function Ee(e){let t=process.env.DIRECTORY_TOPIC_ID??"0.0.666";return I(t,JSON.stringify(e))}async function Me(e){let t=process.env.A2A_TOPIC_ID??"0.0.777";return I(t,JSON.stringify(e))}async function ke(e){let t=process.env.MARKET_TOPIC_ID??"0.0.888";return I(t,JSON.stringify(e))}async function pt(e,t,n){let r=n??process.env.MARKET_TOPIC_ID??"0.0.888",s=JSON.stringify(t),a=`${e}-${Date.now()}-0000000000`,o=JSON.stringify({topicId:r,messageStr:s,agentAccountId:e,txId:a});return{txBytes:Buffer.from(o).toString("base64"),txId:a}}async function Re(e,t){let n=process.env.A2A_TOPIC_ID??"0.0.777";return pt(e,t,n)}async function De(e,t,n){try{let r=JSON.parse(Buffer.from(e,"base64").toString("utf8")),s=r.topicId??process.env.MARKET_TOPIC_ID??"0.0.888";return I(s,r.messageStr??"{}")}catch{let r=process.env.MARKET_TOPIC_ID??"0.0.888";return I(r,"{}")}}function I(e,t){let n=(q.get(e)??0)+1;q.set(e,n);let r=P(),s=_.get(e)??[];return s.push({consensus_timestamp:v(),message:t,sequence_number:n,running_hash:`mock_hash_${n}`,transaction_id:r}),_.set(e,s),r}async function Ne(e,t,n){let r=D(e,n),s=f.get(r);if(!s)throw new Error(`NFT not found: ${r}`);s.deleted=!0}async function $e(e,t,n){let r=D(e,t),s=f.get(r);if(!s)throw new Error(`NFT not found: ${r}`);s.metadata=n}async function dt(e,t,n){return`0.0.${e.split(".")[2]}@${v()}`}async function Oe(e,t,n,r){return dt(e,n,r)}async function Pe(e,t,n){return{txBytes:"mock-tx-bytes-base64",txId:P()}}async function ve(e,t,n){let r=Array.isArray(n)?n:[n];if(!r.length||r.some(s=>!s||s.length===0))throw new Error("Invalid signature: signatureBytes must be non-empty");return P()}function Ce(){return G+=1,1e4+G}async function He(e,t,n,r){let s=`0.0.${Ce()}`,a=`${e}@${v()}`;return{scheduleId:s,scheduleTxId:a}}async function Ue(e,t){if(!e||!e.trim())throw new Error("scheduleId must be a non-empty string");return{txId:P(),executed:!0}}async function Fe(e){if(!e||!e.trim())throw new Error("scheduleId must be a non-empty string");return{scheduleId:e,deleted:!0}}function Le(){f.clear(),K.clear(),_.clear(),q.clear(),G=0}var f,K,_,q,G,C=g(()=>{"use strict";f=new Map,K=new Map,_=new Map,q=new Map;G=0});var J={};S(J,{getNftInfo:()=>Ke,getNftsForAccount:()=>Ge,getNftsForToken:()=>qe,getScheduleInfo:()=>Ye,getTopicMessages:()=>We,getTopicMessagesPaginated:()=>Je});function w(){let e=process.env.HEDERA_NETWORK??"testnet";return mt[e]??mt.testnet}function Be(){let e=process.env.MIRROR_NODE_TIMEOUT_MS;if(!e)return 1e4;let t=parseInt(e,10);return Number.isFinite(t)&&t>0?t:1e4}async function b(e){let t=new AbortController,n=Be(),r=setTimeout(()=>t.abort(),n);try{let s=await fetch(e,{signal:t.signal});if(!s.ok){if(s.status===404)return{};throw new Error(`Mirror Node error ${s.status}: ${e}`)}return s.json()}catch(s){throw s instanceof DOMException&&s.name==="AbortError"?new Error(`Mirror Node timeout after ${n}ms: ${e}`):s}finally{clearTimeout(r)}}async function Ke(e,t){let n=w(),r=await b(`${n}/tokens/${e}/nfts/${t}`);if(!r||!r.serial_number)return null;let s=r;return s.metadata&&(s.metadata=Buffer.from(s.metadata,"base64").toString("utf8")),s}async function qe(e,t){let n=w(),r=`${n}/tokens/${e}/nfts?limit=100`,s=[];for(;r;){let a=await b(r),o=a.nfts??[];for(let c of o)c.metadata&&(c.metadata=Buffer.from(c.metadata,"base64").toString("utf8"));if(s.push(...o),t?.maxResults&&s.length>=t.maxResults)return s.slice(0,t.maxResults);let i=a.links?.next;r=i?`${n}${i}`:null}return s}async function Ge(e,t){let n=w(),r=`${n}/accounts/${e}/nfts?limit=100`,s=[];for(;r;){let a=await b(r),o=a.nfts??[];for(let c of o)c.metadata&&(c.metadata=Buffer.from(c.metadata,"base64").toString("utf8"));if(s.push(...o),t?.maxResults&&s.length>=t.maxResults)return s.slice(0,t.maxResults);let i=a.links?.next;r=i?`${n}${i}`:null}return s}function ft(e){if(/^\d+\.\d+$/.test(e))return e;let t=new Date(e);if(isNaN(t.getTime()))return e;let n=Math.floor(t.getTime()/1e3),r=t.getTime()%1e3*1e6;return`${n}.${String(r).padStart(9,"0")}`}async function We(e,t){let n=w(),r=new URLSearchParams;r.set("limit",String(t?.limit??100)),r.set("order","desc"),t?.startTime&&r.set("timestamp",`gt:${ft(t.startTime)}`),t?.endTime&&r.set("timestamp",`lt:${ft(t.endTime)}`);let s=`${n}/topics/${e}/messages?${r.toString()}`,a=[];for(;s;){let o=await b(s),i=o.messages??[];for(let u of i){let U=u.message,$=Buffer.from(U,"base64").toString("utf8"),y=u.transaction_id;if(!y&&u.chunk_info){let h=u.chunk_info.initial_transaction_id;h?.account_id&&h?.transaction_valid_start&&(y=`${h.account_id}-${h.transaction_valid_start.replace(".","-")}`)}a.push({consensus_timestamp:u.consensus_timestamp,message:$,sequence_number:u.sequence_number,running_hash:u.running_hash,chunk_info:u.chunk_info,transaction_id:y})}if(t?.maxResults&&a.length>=t.maxResults)return a.slice(0,t.maxResults);let c=o.links?.next;s=c?`${n}${c}`:null}return a}async function Je(e,t){let n=w(),r=t?.pageUrl??(()=>{let u=new URLSearchParams;return u.set("limit",String(t?.limit??100)),u.set("order","desc"),t?.startTime&&u.set("timestamp",`gt:${t.startTime}`),t?.endTime&&u.set("timestamp",`lt:${t.endTime}`),`${n}/topics/${e}/messages?${u.toString()}`})(),s=await b(r),o=(s.messages??[]).map(u=>({consensus_timestamp:u.consensus_timestamp,message:Buffer.from(u.message,"base64").toString("utf8"),sequence_number:u.sequence_number,running_hash:u.running_hash,chunk_info:u.chunk_info})),i=s.links?.next,c=i?`${n}${i}`:null;return{messages:o,nextPageUrl:c}}async function Ye(e){let t=w(),n=await b(`${t}/schedules/${e}`);return!n||!n.schedule_id?null:{scheduleId:n.schedule_id,executed:!!n.executed,deleted:!!n.deleted,expirationTime:n.expiration_time?String(n.expiration_time):void 0,memo:n.memo?String(n.memo):void 0,signers:Array.isArray(n.signatures)?n.signatures.map(r=>String(r.public_key??"")):[],adminKey:n.admin_key?String(n.admin_key):void 0}}var mt,lt=g(()=>{"use strict";mt={testnet:"https://testnet.mirrornode.hedera.com/api/v1",mainnet:"https://mainnet.mirrornode.hedera.com/api/v1",previewnet:"https://previewnet.mirrornode.hedera.com/api/v1"}});var Y={};S(Y,{getNftInfo:()=>Ve,getNftsForAccount:()=>Qe,getNftsForToken:()=>ze,getScheduleInfo:()=>Ze,getTopicMessages:()=>je,getTopicMessagesPaginated:()=>Xe});async function Ve(e,t){let n=`${e}:${t}`,r=f.get(n);return r?{...r}:null}async function ze(e,t){let n=[];for(let r of f.values())r.token_id===e&&n.push({...r});return t?.maxResults?n.slice(0,t.maxResults):n}async function Qe(e,t){let n=[];for(let r of f.values())r.account_id===e&&n.push({...r});return t?.maxResults?n.slice(0,t.maxResults):n}async function je(e,t){let r=[..._.get(e)??[]];t?.startTime&&(r=r.filter(o=>o.consensus_timestamp>t.startTime)),t?.endTime&&(r=r.filter(o=>o.consensus_timestamp<t.endTime));let s=t?.limit??100;r.sort((o,i)=>i.sequence_number-o.sequence_number);let a=r.slice(0,s);return t?.maxResults?a.slice(0,t.maxResults):a}async function Xe(e,t){let r=[..._.get(e)??[]];t?.startTime&&(r=r.filter(o=>o.consensus_timestamp>t.startTime)),t?.endTime&&(r=r.filter(o=>o.consensus_timestamp<t.endTime));let s=t?.limit??100;return r.sort((o,i)=>i.sequence_number-o.sequence_number),{messages:r.slice(0,s),nextPageUrl:null}}async function Ze(e){return{scheduleId:e,executed:!1,deleted:!1,signers:[],memo:"mock-escrow"}}var V=g(()=>{"use strict";C()});import{Transaction as tn,PrivateKey as en}from"@hashgraph/sdk";function z(e,t){if(!e)throw new Error("txBytesBase64 is required");if(!t)throw new Error("privateKeyHex is required");let n=Buffer.from(e,"base64"),r=tn.fromBytes(n),s=en.fromString(t),a=s.signTransaction(r,!0),o=s.publicKey.toStringDer(),i=Array.isArray(a)?a:[a];return{publicKey:o,signature:JSON.stringify(i.map(c=>Buffer.from(c).toString("base64")))}}var gt=g(()=>{"use strict"});function rn(){let e=process.env.DATAHUB_TIMEOUT_MS;if(!e)return 3e4;let t=parseInt(e,10);return Number.isFinite(t)&&t>0?t:3e4}var nn,N,sn,an,on,cn,un,pn,dn,mn,fn,ln,gn,yt=g(()=>{"use strict";nn="http://localhost:8080",N=class{baseUrl;token;timeoutMs;mockMode;constructor(){this.baseUrl=(process.env.DATAHUB_GMS_URL??nn).replace(/\/$/,""),this.token=process.env.DATAHUB_TOKEN,this.timeoutMs=rn(),this.mockMode=!process.env.DATAHUB_ENABLED||process.env.DATAHUB_ENABLED==="false"}async graphql(t,n){let r=new AbortController,s=setTimeout(()=>r.abort(),this.timeoutMs);try{let a={"Content-Type":"application/json"};this.token&&(a.Authorization=`Bearer ${this.token}`);let o=await fetch(`${this.baseUrl}/api/graphql`,{method:"POST",headers:a,body:JSON.stringify({query:t,variables:n}),signal:r.signal});if(!o.ok){let c=await o.text().catch(()=>"");throw new Error(`DataHub HTTP ${o.status}: ${c||o.statusText}`)}let i=await o.json();if(i.errors&&i.errors.length>0)throw new Error(i.errors.map(c=>c.message).join("; "));if(!i.data)throw new Error("DataHub returned no data");return i.data}catch(a){throw a instanceof DOMException&&a.name==="AbortError"?new Error(`DataHub timeout after ${this.timeoutMs}ms`):a}finally{clearTimeout(s)}}async search(t,n,r){if(this.mockMode)return{entities:[],total:0};let s=await this.graphql(sn,{query:t,type:n,limit:r});return{total:s.search.total,entities:s.search.searchResults.map(a=>a.entity)}}async getEntity(t){return this.mockMode?null:(await this.graphql(an,{urn:t})).entity}async listSchemaFields(t){if(this.mockMode)return[];let n=await this.graphql(on,{urn:t});return n.dataset?.schemaMetadata?n.dataset.schemaMetadata.fields.map(r=>({fieldPath:r.fieldPath,type:r.type?.type??"UNKNOWN"})):[]}async getLineage(t){if(this.mockMode)return{upstreams:[],downstreams:[]};let n=await this.graphql(cn,{urn:t});return{upstreams:n.lineage.upstreams.map(r=>r.entity),downstreams:n.lineage.downstreams.map(r=>r.entity)}}async getDatasetAssertions(t){if(this.mockMode)return[];let n=await this.graphql(un,{urn:t});return n.dataset?.assertions?n.dataset.assertions.assertions.map(r=>r.entity):[]}async addTerms(t,n,r,s){return this.mockMode?{}:await this.graphql(pn,{termUrns:t,resourceUrn:n,subResourceType:r??null,subResource:s??null})}async createGlossaryTerm(t,n,r){return this.mockMode?null:(await this.graphql(dn,{name:t,description:n,parentNodeUrn:r})).createGlossaryTerm?.urn??null}async upsertDatasetSchemaAssertionMonitor(t,n,r,s){return this.mockMode?null:(await this.graphql(mn,{entityUrn:t,fields:n,compatibility:r,description:s})).upsertDatasetSchemaAssertionMonitor?.urn??null}async upsertDatasetFreshnessAssertionMonitor(t,n,r){return this.mockMode?null:(await this.graphql(fn,{entityUrn:t,schedule:n,description:r})).upsertDatasetFreshnessAssertionMonitor?.urn??null}async updateLineage(t,n){return this.mockMode?{}:await this.graphql(ln,{edgesToAdd:t,edgesToRemove:n})}async getAssertionResults(t){if(this.mockMode)return[];let n=await this.graphql(gn,{urn:t});return n.assertion?.runEvents?n.assertion.runEvents.map(r=>({status:r.status,timestamp:r.timestamp})):[]}};sn=`
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
`,an=`
  query GetEntity($urn: String!) {
    entity(urn: $urn) {
      urn
      type
    }
  }
`,on=`
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
`,cn=`
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
`,un=`
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
`,pn=`
  mutation AddTerms($termUrns: [String!]!, $resourceUrn: String!, $subResourceType: String, $subResource: String) {
    addTerms(termUrns: $termUrns, resourceUrn: $resourceUrn, subResourceType: $subResourceType, subResource: $subResource)
  }
`,dn=`
  mutation CreateGlossaryTerm($name: String!, $description: String!, $parentNodeUrn: String!) {
    createGlossaryTerm(input: { name: $name, description: $description, parentNodeUrn: $parentNodeUrn }) {
      urn
    }
  }
`,mn=`
  mutation UpsertSchemaAssertion($entityUrn: String!, $fields: [String!]!, $compatibility: String!, $description: String!) {
    upsertDatasetSchemaAssertionMonitor(entityUrn: $entityUrn, fields: $fields, compatibility: $compatibility, description: $description) {
      urn
    }
  }
`,fn=`
  mutation UpsertFreshnessAssertion($entityUrn: String!, $schedule: String!, $description: String!) {
    upsertDatasetFreshnessAssertionMonitor(entityUrn: $entityUrn, schedule: $schedule, description: $description) {
      urn
    }
  }
`,ln=`
  mutation UpdateLineage($edgesToAdd: [LineageEdgeInput!]!, $edgesToRemove: [LineageEdgeInput!]!) {
    updateLineage(edgesToAdd: $edgesToAdd, edgesToRemove: $edgesToRemove)
  }
`,gn=`
  query GetAssertionResults($urn: String!) {
    assertion(urn: $urn) {
      runEvents {
        status
        timestamp
      }
    }
  }
`});var St={};S(St,{didToAccountId:()=>_t,extractTokenAndSerial:()=>Q,getMessageDirection:()=>ht,isValidA2ADid:()=>Tt});function Tt(e){return yn.test(e)}function Q(e){let t=Tn.exec(e);return t?{tokenId:t[1],serial:parseInt(t[2],10)}:null}async function _t(e){let t=Q(e);if(!t)return null;try{let{getNftInfo:n}=await Promise.resolve().then(()=>(H(),At)),r=await n(t.tokenId,t.serial);return!r||r.deleted?null:r.account_id}catch{return null}}function ht(e,t,n,r){if(e===n&&t===r)return"A\u2192B";if(e===r&&t===n)return"B\u2192A";throw new Error("Invalid message direction")}var yn,Tn,j=g(()=>{"use strict";yn=/^did:hcs:\d+\.\d+\.\d+:\d+$/,Tn=/^did:hcs:(.+):(\d+)$/});var At={};S(At,{DataHubClient:()=>N,burnPassportNFT:()=>wt,createScheduledTransfer:()=>_n,deleteScheduledTransaction:()=>Sn,getNftInfo:()=>X,getNftsForAccount:()=>Bt,getNftsForToken:()=>Lt,getScheduleInfo:()=>An,getTaskMessages:()=>qt,getTopicMessages:()=>Z,getTopicMessagesPaginated:()=>Kt,grantKyc:()=>Et,mintPassportNFT:()=>It,prepareA2ATopicMessage:()=>$t,prepareTopicMessageTransaction:()=>Nt,prepareTransferTransaction:()=>Ut,signScheduledTransaction:()=>hn,signTransactionBytes:()=>z,submitA2AMessage:()=>Rt,submitAuditMessage:()=>Mt,submitDirectoryMessage:()=>kt,submitSignedTopicMessage:()=>Ot,submitTaskMessage:()=>Dt,transferHbar:()=>Ct,transferHbarWithKey:()=>Ht,transferHbarWithSignature:()=>Ft,transferNFTToAgent:()=>bt,updateNftMetadata:()=>vt,verifyA2ADid:()=>Gt,wipeNFT:()=>Pt});function xt(){return process.env.MOCK_HEDERA==="true"}function p(){return xt()?W:B}function E(){return xt()?Y:J}async function It(e,t){return p().mintPassportNFT(e,t)}async function wt(e,t){return p().burnPassportNFT(e,t)}async function bt(e,t,n,r){return p().transferNFTToAgent(e,t,n,r)}async function Et(e,t){return p().grantKyc(e,t)}async function Mt(e){return p().submitAuditMessage(e)}async function kt(e){return p().submitDirectoryMessage(e)}async function Rt(e){return p().submitA2AMessage(e)}async function Dt(e){return p().submitTaskMessage(e)}async function Nt(e,t,n){return p().prepareTopicMessageTransaction(e,t,n)}async function $t(e,t){return p().prepareA2ATopicMessage(e,t)}async function Ot(e,t,n){return p().submitSignedTopicMessage(e,t,n)}async function Pt(e,t,n){return p().wipeNFT(e,t,n)}async function vt(e,t,n){return p().updateNftMetadata(e,t,n)}async function Ct(e,t,n){return p().transferHbar(e,t,n)}async function Ht(e,t,n,r){return p().transferHbarWithKey(e,t,n,r)}async function Ut(e,t,n){return p().prepareTransferTransaction(e,t,n)}async function Ft(e,t,n){return p().transferHbarWithSignature(e,t,n)}async function _n(e,t,n,r){return p().createScheduledTransfer(e,t,n,r)}async function hn(e,t){return p().signScheduledTransaction(e,t)}async function Sn(e){return p().deleteScheduledTransaction(e)}async function An(e){return E().getScheduleInfo(e)}async function X(e,t){return E().getNftInfo(e,t)}async function Lt(e,t){return E().getNftsForToken(e,t)}async function Bt(e,t){return E().getNftsForAccount(e,t)}async function Z(e,t){return E().getTopicMessages(e,t)}async function Kt(e,t){return E().getTopicMessagesPaginated(e,t)}async function qt(e,t){let n=await Z(e,t),r=[];for(let s of n)try{let a=JSON.parse(s.message);nt(a)&&r.push({message:a,txId:s.transaction_id})}catch{}return r}async function Gt(e){let{extractTokenAndSerial:t}=await Promise.resolve().then(()=>(j(),St)),n=t(e);if(!n)return!1;try{let r=await X(n.tokenId,n.serial);return r!==null&&!r.deleted}catch{return!1}}var H=g(()=>{"use strict";F();ut();C();lt();V();gt();yt()});F();H();C();V();async function Un(e,t){let n=process.env.HEDERA_OPERATOR_ID??"0.0.2",r=Math.floor(Date.now()/1e3),s=Math.floor(Math.random()*1e9);return`${n}@${r}.${s}`}j();var xn=[{name:"bronze",price:10,capabilities:["api_call","payment"]},{name:"silver",price:50,capabilities:["api_call","payment","data_provide"]},{name:"gold",price:200,capabilities:["api_call","payment","data_provide","verified","marketplace"]},{name:"platinum",price:500,capabilities:["api_call","payment","data_provide","verified","marketplace","multi_agent","governance"]}];function In(){return xn.map(e=>({...e,capabilities:[...e.capabilities]}))}var tt=[{name:"request_passport",description:"Issue a new agent passport NFT (x402 payment)",category:"passport"},{name:"upload_image",description:"Upload image to IPFS, return ipfs:// URI",category:"passport"},{name:"verify_passport",description:"Verify passport on-chain status",category:"passport"},{name:"get_passport",description:"Get passport metadata",category:"passport"},{name:"list_passports",description:"List all issued passports",category:"passport"},{name:"upgrade_tier",description:"Upgrade passport tier",category:"passport"},{name:"revoke_passport",description:"Revoke passport (admin)",category:"passport"},{name:"get_audit_trail",description:"Get audit events for a passport",category:"audit"},{name:"get_tier_requirements",description:"Get tier catalog with pricing",category:"audit"},{name:"register_agent",description:"Register agent in HCS directory",category:"directory"},{name:"find_agents",description:"Find agents by capability",category:"directory"},{name:"send_message",description:"Send A2A message (server-key)",category:"a2a"},{name:"send_message_with_key",description:"Send agent-signed A2A message",category:"a2a"},{name:"get_inbox",description:"Get agent inbox messages",category:"a2a"},{name:"get_conversation",description:"Get conversation between two agents",category:"a2a"},{name:"post_task",description:"Post marketplace task",category:"market"},{name:"list_tasks",description:"List marketplace tasks",category:"market"},{name:"claim_task",description:"Claim a marketplace task",category:"market"},{name:"deliver_result",description:"Deliver task results",category:"market"},{name:"prepare_payment",description:"Prepare frozen payment for offline signing",category:"market"},{name:"complete_task",description:"Complete task with P2P HBAR payment",category:"market"},{name:"sign_transaction",description:"Sign frozen Hedera transaction bytes",category:"auth"},{name:"complete_task_with_key",description:"Complete task with agent key (convenience)",category:"market"},{name:"post_task_with_key",description:"Post task with agent-signed HCS",category:"market"},{name:"claim_task_with_key",description:"Claim task with agent-signed HCS",category:"market"},{name:"deliver_result_with_key",description:"Deliver result with agent-signed HCS",category:"market"},{name:"get_guide",description:"Fetch a skill guide as markdown",category:"guide"},{name:"list_guides",description:"List available skill guides",category:"guide"},{name:"get_agent_card",description:"Fetch server Agent Card",category:"discovery"},{name:"search_agents",description:"Search agents by query or capability",category:"discovery"},{name:"get_server_info",description:"Fetch llms.txt (server info for LLMs)",category:"discovery"},{name:"get_ai_sitemap",description:"Fetch AI sitemap",category:"discovery"}];function wn(){let e=process.env.BASE_URL&&process.env.BASE_URL.startsWith("http")?process.env.BASE_URL:"http://localhost:4021",t=process.env.x402_FACILITATOR_URL??process.env.FACILITATOR_URL??"https://api.testnet.blocky402.com",n=process.env.FEE_PAYER_ACCOUNT??"0.0.7162784",r=process.env.HEDERA_NETWORK??"testnet";return`# Agent Passport on Hedera

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

- [Agent Guide](/agent-guide) \u2014 How to get started as an AI agent
- [Market Guide](/market-guide) \u2014 Marketplace usage
- [Medical Guide](/medical-guide) \u2014 Medical data processing demo

## MCP Server

The server exposes an MCP (Model Context Protocol) endpoint at [/mcp](/mcp) with dual transport (stdio + HTTP).

### MCP Tools (${tt.length} total)

| Tool | Category | Description |
|------|----------|-------------|
${tt.map(s=>`| ${s.name} | ${s.category} | ${s.description} |`).join(`
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
`}H();export{N as DataHubClient,tt as MCP_TOOLS_INDEX,En as TIER_PRICES_HBAR,wt as burnPassportNFT,He as createScheduledTransfer,Fe as deleteScheduledTransaction,_t as didToAccountId,Q as extractTokenAndSerial,In as getCatalog,wn as getLlmsTxt,ht as getMessageDirection,X as getNftInfo,Bt as getNftsForAccount,Lt as getNftsForToken,Ze as getScheduleInfo,qt as getTaskMessages,Z as getTopicMessages,Kt as getTopicMessagesPaginated,Et as grantKyc,Tt as isValidA2ADid,Mn as isValidA2AMessage,nt as isValidTaskMessage,It as mintPassportNFT,Un as mockSettle,f as nftStore,$t as prepareA2ATopicMessage,Nt as prepareTopicMessageTransaction,Ut as prepareTransferTransaction,Le as resetMockState,Ue as signScheduledTransaction,z as signTransactionBytes,Rt as submitA2AMessage,Mt as submitAuditMessage,kt as submitDirectoryMessage,Ot as submitSignedTopicMessage,Dt as submitTaskMessage,_ as topicMessages,Ct as transferHbar,Ht as transferHbarWithKey,Ft as transferHbarWithSignature,bt as transferNFTToAgent,vt as updateNftMetadata,Gt as verifyA2ADid,Pt as wipeNFT};
