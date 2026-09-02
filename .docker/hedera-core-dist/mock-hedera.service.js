const nftStore = new Map();
const serialCounters = new Map();
const topicMessages = new Map();
const messageCounters = new Map();
function nftKey(tokenId, serial) {
    return `${tokenId}:${serial}`;
}
function fakeTxId() {
    const accountId = process.env.HEDERA_OPERATOR_ID ?? "0.0.2";
    const seconds = Math.floor(Date.now() / 1000);
    const nanos = Math.floor(Math.random() * 1_000_000_000);
    return `${accountId}@${seconds}.${nanos}`;
}
function fakeTimestamp() {
    const seconds = Math.floor(Date.now() / 1000);
    const nanos = Math.floor(Math.random() * 1_000_000_000);
    return `${seconds}.${String(nanos).padStart(9, "0")}`;
}
export async function mintPassportNFT(tokenId, ipfsUri) {
    const current = serialCounters.get(tokenId) ?? 0;
    const serial = current + 1;
    serialCounters.set(tokenId, serial);
    const treasury = process.env.HEDERA_OPERATOR_ID ?? "0.0.2";
    const key = nftKey(tokenId, serial);
    nftStore.set(key, {
        token_id: tokenId,
        serial_number: serial,
        account_id: treasury,
        metadata: ipfsUri,
        deleted: false,
        created_timestamp: fakeTimestamp(),
    });
    return { tokenId, serial };
}
export async function transferNFTToAgent(tokenId, serial, _fromAccountId, toAccountId) {
    const key = nftKey(tokenId, serial);
    const nft = nftStore.get(key);
    if (!nft)
        throw new Error(`NFT not found: ${key}`);
    nft.account_id = toAccountId;
}
export async function grantKyc(_tokenId, _accountId) {
}
export async function burnPassportNFT(tokenId, serial) {
    const key = nftKey(tokenId, serial);
    if (!nftStore.has(key))
        throw new Error(`NFT not found: ${key}`);
    nftStore.delete(key);
}
export async function submitAuditMessage(message) {
    const topicId = process.env.AUDIT_TOPIC_ID ?? "0.0.555";
    return pushTopicMessage(topicId, JSON.stringify(message));
}
export async function submitDirectoryMessage(message) {
    const topicId = process.env.DIRECTORY_TOPIC_ID ?? "0.0.666";
    return pushTopicMessage(topicId, JSON.stringify(message));
}
export async function submitA2AMessage(message) {
    const topicId = process.env.A2A_TOPIC_ID ?? "0.0.777";
    return pushTopicMessage(topicId, JSON.stringify(message));
}
export async function submitTaskMessage(message) {
    const topicId = process.env.MARKET_TOPIC_ID ?? "0.0.888";
    return pushTopicMessage(topicId, JSON.stringify(message));
}
export async function prepareTopicMessageTransaction(agentAccountId, message, topicIdOverride) {
    const topicId = topicIdOverride ?? process.env.MARKET_TOPIC_ID ?? "0.0.888";
    const messageStr = JSON.stringify(message);
    const txId = `${agentAccountId}-${Date.now()}-0000000000`;
    const mockData = JSON.stringify({ topicId, messageStr, agentAccountId, txId });
    return { txBytes: Buffer.from(mockData).toString("base64"), txId };
}
export async function prepareA2ATopicMessage(agentAccountId, message) {
    const topicId = process.env.A2A_TOPIC_ID ?? "0.0.777";
    return prepareTopicMessageTransaction(agentAccountId, message, topicId);
}
export async function submitSignedTopicMessage(_txBytesBase64, _publicKeyDer, _signatureBytes) {
    try {
        const data = JSON.parse(Buffer.from(_txBytesBase64, "base64").toString("utf8"));
        const topicId = data.topicId ?? process.env.MARKET_TOPIC_ID ?? "0.0.888";
        return pushTopicMessage(topicId, data.messageStr ?? "{}");
    }
    catch {
        const topicId = process.env.MARKET_TOPIC_ID ?? "0.0.888";
        return pushTopicMessage(topicId, "{}");
    }
}
function pushTopicMessage(topicId, messageStr) {
    const seq = (messageCounters.get(topicId) ?? 0) + 1;
    messageCounters.set(topicId, seq);
    const txId = fakeTxId();
    const msgs = topicMessages.get(topicId) ?? [];
    msgs.push({
        consensus_timestamp: fakeTimestamp(),
        message: messageStr,
        sequence_number: seq,
        running_hash: `mock_hash_${seq}`,
        transaction_id: txId,
    });
    topicMessages.set(topicId, msgs);
    return txId;
}
export async function wipeNFT(tokenId, _accountId, serial) {
    const key = nftKey(tokenId, serial);
    const nft = nftStore.get(key);
    if (!nft)
        throw new Error(`NFT not found: ${key}`);
    nft.deleted = true;
}
export async function updateNftMetadata(tokenId, serial, newUri) {
    const key = nftKey(tokenId, serial);
    const nft = nftStore.get(key);
    if (!nft)
        throw new Error(`NFT not found: ${key}`);
    nft.metadata = newUri;
}
export async function transferHbar(fromAccountId, toAccountId, amountHbar) {
    const txId = `0.0.${fromAccountId.split(".")[2]}@${fakeTimestamp()}`;
    return txId;
}
export async function transferHbarWithKey(fromAccountId, _fromPrivateKey, toAccountId, amountHbar) {
    return transferHbar(fromAccountId, toAccountId, amountHbar);
}
export async function prepareTransferTransaction(_fromAccountId, _toAccountId, _amountHbar) {
    return {
        txBytes: "mock-tx-bytes-base64",
        txId: fakeTxId(),
    };
}
export async function transferHbarWithSignature(_txBytesBase64, _publicKeyStr, signatureBytes) {
    const sigs = Array.isArray(signatureBytes) ? signatureBytes : [signatureBytes];
    if (!sigs.length || sigs.some((s) => !s || s.length === 0)) {
        throw new Error("Invalid signature: signatureBytes must be non-empty");
    }
    return fakeTxId();
}
let scheduleCounter = 0;
function fakeScheduleNum() {
    scheduleCounter += 1;
    return 10_000 + scheduleCounter;
}
export async function createScheduledTransfer(fromAccountId, toAccountId, amountHbar, options) {
    const scheduleId = `0.0.${fakeScheduleNum()}`;
    const scheduleTxId = `${fromAccountId}@${fakeTimestamp()}`;
    return { scheduleId, scheduleTxId };
}
export async function signScheduledTransaction(scheduleId, _signerPrivateKey) {
    if (!scheduleId || !scheduleId.trim()) {
        throw new Error("scheduleId must be a non-empty string");
    }
    return { txId: fakeTxId(), executed: true };
}
export async function signScheduledTransactionWithSignature(scheduleId, _txBytesBase64, _publicKeyStr, _signatureBytes) {
    if (!scheduleId || !scheduleId.trim()) {
        throw new Error("scheduleId must be a non-empty string");
    }
    return { txId: fakeTxId(), executed: true };
}
export async function deleteScheduledTransaction(scheduleId) {
    if (!scheduleId || !scheduleId.trim()) {
        throw new Error("scheduleId must be a non-empty string");
    }
    return { scheduleId, deleted: true };
}
const fileStore = new Map();
let fileCounter = 0;
const HFS_MAX_SIZE_BYTES = 1024 * 1024;
export async function uploadFileToHFS(contents, _fileMemo) {
    if (contents.length > HFS_MAX_SIZE_BYTES) {
        throw new Error(`File too large: ${contents.length} bytes exceeds max size of ${HFS_MAX_SIZE_BYTES} bytes (1024 KB)`);
    }
    fileCounter += 1;
    const fileId = `0.0.${fileCounter}`;
    fileStore.set(fileId, Buffer.from(contents));
    return { fileId, txId: fakeTxId() };
}
export async function downloadFileFromHFS(fileId) {
    const data = fileStore.get(fileId);
    if (!data) {
        throw new Error(`File not found: ${fileId} (404)`);
    }
    return Buffer.from(data);
}
export function resetMockState() {
    nftStore.clear();
    serialCounters.clear();
    topicMessages.clear();
    messageCounters.clear();
    scheduleCounter = 0;
    fileStore.clear();
    fileCounter = 0;
}
export { nftStore, topicMessages };
