import { isValidTaskMessage } from "./types";
import * as realHedera from "./hedera.service";
import * as mockHedera from "./mock-hedera.service";
import * as realMirror from "./mirror.service";
import * as mockMirror from "./mock-mirror.service";
function isMockMode() {
    return process.env.MOCK_HEDERA === "true";
}
function hedera() {
    return isMockMode() ? mockHedera : realHedera;
}
function mirror() {
    return isMockMode() ? mockMirror : realMirror;
}
export async function mintPassportNFT(tokenId, ipfsUri) {
    return hedera().mintPassportNFT(tokenId, ipfsUri);
}
export async function burnPassportNFT(tokenId, serial) {
    return hedera().burnPassportNFT(tokenId, serial);
}
export async function transferNFTToAgent(tokenId, serial, fromAccountId, toAccountId) {
    return hedera().transferNFTToAgent(tokenId, serial, fromAccountId, toAccountId);
}
export async function grantKyc(tokenId, accountId) {
    return hedera().grantKyc(tokenId, accountId);
}
export async function submitAuditMessage(message) {
    return hedera().submitAuditMessage(message);
}
export async function submitDirectoryMessage(message) {
    return hedera().submitDirectoryMessage(message);
}
export async function submitA2AMessage(message) {
    return hedera().submitA2AMessage(message);
}
export async function submitTaskMessage(message) {
    return hedera().submitTaskMessage(message);
}
export async function prepareTopicMessageTransaction(agentAccountId, message, topicIdOverride) {
    return hedera().prepareTopicMessageTransaction(agentAccountId, message, topicIdOverride);
}
export async function prepareA2ATopicMessage(agentAccountId, message) {
    return hedera().prepareA2ATopicMessage(agentAccountId, message);
}
export async function submitSignedTopicMessage(txBytesBase64, publicKeyDer, signatureBytes) {
    return hedera().submitSignedTopicMessage(txBytesBase64, publicKeyDer, signatureBytes);
}
export async function wipeNFT(tokenId, accountId, serial) {
    return hedera().wipeNFT(tokenId, accountId, serial);
}
export async function updateNftMetadata(tokenId, serial, newUri) {
    return hedera().updateNftMetadata(tokenId, serial, newUri);
}
export async function transferHbar(fromAccountId, toAccountId, amountHbar) {
    return hedera().transferHbar(fromAccountId, toAccountId, amountHbar);
}
export async function transferHbarWithKey(fromAccountId, fromPrivateKey, toAccountId, amountHbar) {
    return hedera().transferHbarWithKey(fromAccountId, fromPrivateKey, toAccountId, amountHbar);
}
export async function prepareTransferTransaction(fromAccountId, toAccountId, amountHbar) {
    return hedera().prepareTransferTransaction(fromAccountId, toAccountId, amountHbar);
}
export async function transferHbarWithSignature(txBytesBase64, publicKeyStr, signatureBytes) {
    return hedera().transferHbarWithSignature(txBytesBase64, publicKeyStr, signatureBytes);
}
export async function createScheduledTransfer(fromAccountId, toAccountId, amountHbar, options) {
    return hedera().createScheduledTransfer(fromAccountId, toAccountId, amountHbar, options);
}
export async function signScheduledTransaction(scheduleId, signerPrivateKey) {
    return hedera().signScheduledTransaction(scheduleId, signerPrivateKey);
}
export async function signScheduledTransactionWithSignature(scheduleId, txBytesBase64, publicKeyStr, signatureBytes) {
    return hedera().signScheduledTransactionWithSignature(scheduleId, txBytesBase64, publicKeyStr, signatureBytes);
}
export async function deleteScheduledTransaction(scheduleId) {
    return hedera().deleteScheduledTransaction(scheduleId);
}
export async function uploadFileToHFS(contents, fileMemo) {
    return hedera().uploadFileToHFS(contents, fileMemo);
}
export async function downloadFileFromHFS(fileId) {
    return hedera().downloadFileFromHFS(fileId);
}
export async function getScheduleInfo(scheduleId) {
    return mirror().getScheduleInfo(scheduleId);
}
export { signTransactionBytes } from "./signing";
export async function getNftInfo(tokenId, serial) {
    return mirror().getNftInfo(tokenId, serial);
}
export async function getNftsForToken(tokenId, opts) {
    return mirror().getNftsForToken(tokenId, opts);
}
export async function getNftsForAccount(accountId, opts) {
    return mirror().getNftsForAccount(accountId, opts);
}
export async function getTopicMessages(topicId, opts) {
    return mirror().getTopicMessages(topicId, opts);
}
export async function getTopicMessagesPaginated(topicId, opts) {
    return mirror().getTopicMessagesPaginated(topicId, opts);
}
export async function getTaskMessages(topicId, opts) {
    const messages = await getTopicMessages(topicId, opts);
    const result = [];
    for (const msg of messages) {
        try {
            const parsed = JSON.parse(msg.message);
            if (isValidTaskMessage(parsed)) {
                result.push({ message: parsed, txId: msg.transaction_id });
            }
        }
        catch {
        }
    }
    return result;
}
export { DataHubClient } from "./datahub.client";
export async function verifyA2ADid(did) {
    const { extractTokenAndSerial } = await import("./did");
    const parsed = extractTokenAndSerial(did);
    if (!parsed)
        return false;
    try {
        const nft = await getNftInfo(parsed.tokenId, parsed.serial);
        return nft !== null && !nft.deleted;
    }
    catch {
        return false;
    }
}
