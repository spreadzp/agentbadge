import { Client, PrivateKey, PublicKey, AccountId, TokenId, TopicId, Transaction, TokenMintTransaction, TokenBurnTransaction, TokenWipeTransaction, TransferTransaction, TopicMessageSubmitTransaction, TransactionId, TokenUpdateNftsTransaction, TokenGrantKycTransaction, ScheduleCreateTransaction, ScheduleSignTransaction, ScheduleDeleteTransaction, ScheduleId, Status, Timestamp, Hbar, FileCreateTransaction, FileAppendTransaction, FileId, } from "@hashgraph/sdk";
import Long from "long";
export function normalizePrivateKey(keyStr) {
    const trimmed = keyStr.trim();
    if (trimmed.startsWith("0x") || trimmed.startsWith("0X")) {
        const hex = trimmed.slice(2);
        if (hex.length === 64) {
            try {
                return PrivateKey.fromStringECDSA(trimmed);
            }
            catch {
                return PrivateKey.fromStringED25519(trimmed);
            }
        }
        return PrivateKey.fromStringED25519(trimmed);
    }
    if (trimmed.startsWith("30")) {
        return PrivateKey.fromStringDer(trimmed);
    }
    if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
        try {
            return PrivateKey.fromStringECDSA(trimmed);
        }
        catch {
            return PrivateKey.fromStringED25519(trimmed);
        }
    }
    return PrivateKey.fromString(trimmed);
}
let clientInstance = null;
function getClient() {
    if (clientInstance)
        return clientInstance;
    const network = process.env.HEDERA_NETWORK ?? "testnet";
    const operatorId = process.env.HEDERA_OPERATOR_ID;
    const operatorKey = process.env.HEDERA_OPERATOR_KEY;
    if (!operatorId || !operatorKey) {
        throw new Error("HEDERA_OPERATOR_ID and HEDERA_OPERATOR_KEY must be set");
    }
    const client = network === "mainnet" ? Client.forMainnet() : Client.forTestnet();
    client.setOperator(AccountId.fromString(operatorId), PrivateKey.fromStringED25519(operatorKey));
    client.setDefaultMaxTransactionFee(new Hbar(50));
    client.setDefaultMaxQueryPayment(new Hbar(1));
    clientInstance = client;
    return client;
}
function getSupplyKey() {
    const key = process.env.HEDERA_OPERATOR_KEY;
    if (!key)
        throw new Error("HEDERA_OPERATOR_KEY must be set");
    return PrivateKey.fromStringED25519(key);
}
export async function mintPassportNFT(tokenId, ipfsUri) {
    const client = getClient();
    const supplyKey = getSupplyKey();
    const metadata = new TextEncoder().encode(ipfsUri);
    const tx = await new TokenMintTransaction()
        .setTokenId(TokenId.fromString(tokenId))
        .addMetadata(metadata)
        .freezeWith(client)
        .sign(supplyKey);
    const receipt = await (await tx.execute(client)).getReceipt(client);
    return {
        tokenId,
        serial: receipt.serials[0].toNumber(),
    };
}
export async function burnPassportNFT(tokenId, serial) {
    const client = getClient();
    const supplyKey = getSupplyKey();
    const tx = await new TokenBurnTransaction()
        .setTokenId(TokenId.fromString(tokenId))
        .setSerials([Long.fromNumber(serial)])
        .freezeWith(client)
        .sign(supplyKey);
    await (await tx.execute(client)).getReceipt(client);
}
export async function transferNFTToAgent(tokenId, serial, fromAccountId, toAccountId) {
    const client = getClient();
    const treasuryKey = getSupplyKey();
    const tx = await new TransferTransaction()
        .addNftTransfer(TokenId.fromString(tokenId), serial, AccountId.fromString(fromAccountId), AccountId.fromString(toAccountId))
        .freezeWith(client)
        .sign(treasuryKey);
    const result = await tx.execute(client);
    await result.getReceipt(client);
}
export async function grantKyc(tokenId, accountId) {
    const client = getClient();
    const kycKey = getSupplyKey();
    const tx = await new TokenGrantKycTransaction()
        .setTokenId(TokenId.fromString(tokenId))
        .setAccountId(AccountId.fromString(accountId))
        .freezeWith(client)
        .sign(kycKey);
    const result = await tx.execute(client);
    await result.getReceipt(client);
}
export async function submitAuditMessage(message) {
    const client = getClient();
    const topicId = process.env.AUDIT_TOPIC_ID;
    if (!topicId)
        throw new Error("AUDIT_TOPIC_ID must be set");
    const messageStr = JSON.stringify(message);
    const tx = new TopicMessageSubmitTransaction()
        .setTopicId(TopicId.fromString(topicId))
        .setMessage(messageStr);
    if (messageStr.length > 1024) {
        tx.setMaxChunks(10);
    }
    const result = await tx.execute(client);
    await result.getReceipt(client);
    return result.transactionId.toString();
}
export async function submitDirectoryMessage(message) {
    const client = getClient();
    const topicId = process.env.DIRECTORY_TOPIC_ID;
    if (!topicId)
        throw new Error("DIRECTORY_TOPIC_ID must be set");
    const messageStr = JSON.stringify(message);
    const tx = new TopicMessageSubmitTransaction()
        .setTopicId(TopicId.fromString(topicId))
        .setMessage(messageStr);
    if (messageStr.length > 1024) {
        tx.setMaxChunks(10);
    }
    const result = await tx.execute(client);
    await result.getReceipt(client);
    return result.transactionId.toString();
}
export async function submitA2AMessage(message) {
    const client = getClient();
    const topicId = process.env.A2A_TOPIC_ID;
    if (!topicId)
        throw new Error("A2A_TOPIC_ID must be set");
    const messageStr = JSON.stringify(message);
    const tx = new TopicMessageSubmitTransaction()
        .setTopicId(TopicId.fromString(topicId))
        .setMessage(messageStr);
    if (messageStr.length > 1024) {
        tx.setMaxChunks(10);
    }
    const result = await tx.execute(client);
    await result.getReceipt(client);
    return result.transactionId.toString();
}
export async function submitTaskMessage(message) {
    const client = getClient();
    const topicId = process.env.MARKET_TOPIC_ID;
    if (!topicId)
        throw new Error("MARKET_TOPIC_ID must be set");
    const messageStr = JSON.stringify(message);
    const tx = new TopicMessageSubmitTransaction()
        .setTopicId(TopicId.fromString(topicId))
        .setMessage(messageStr);
    if (messageStr.length > 1024) {
        tx.setMaxChunks(10);
    }
    const result = await tx.execute(client);
    await result.getReceipt(client);
    return result.transactionId.toString();
}
export async function prepareTopicMessageTransaction(agentAccountId, message, topicIdOverride) {
    const client = getClient();
    const topicId = topicIdOverride ?? process.env.MARKET_TOPIC_ID;
    if (!topicId)
        throw new Error("Topic ID must be set (pass topicIdOverride or set MARKET_TOPIC_ID)");
    const messageStr = JSON.stringify(message);
    const tx = new TopicMessageSubmitTransaction()
        .setTopicId(TopicId.fromString(topicId))
        .setMessage(messageStr)
        .setTransactionId(TransactionId.generate(AccountId.fromString(agentAccountId)));
    if (messageStr.length > 1024) {
        tx.setMaxChunks(10);
    }
    tx.freezeWith(client);
    const txBytes = Buffer.from(tx.toBytes()).toString("base64");
    const txId = tx.transactionId?.toString() ?? "";
    return { txBytes, txId };
}
export async function prepareA2ATopicMessage(agentAccountId, message) {
    const topicId = process.env.A2A_TOPIC_ID;
    if (!topicId)
        throw new Error("A2A_TOPIC_ID must be set");
    return prepareTopicMessageTransaction(agentAccountId, message, topicId);
}
export async function submitSignedTopicMessage(txBytesBase64, publicKeyDer, signatureBytes) {
    const client = getClient();
    const txBytes = Buffer.from(txBytesBase64, "base64");
    const tx = Transaction.fromBytes(txBytes);
    const publicKey = PublicKey.fromString(publicKeyDer);
    tx.addSignature(publicKey, signatureBytes);
    const result = await tx.execute(client);
    await result.getReceipt(client);
    return result.transactionId.toString();
}
export async function wipeNFT(tokenId, accountId, serial) {
    const client = getClient();
    const wipeKey = getSupplyKey();
    const tx = await new TokenWipeTransaction()
        .setTokenId(TokenId.fromString(tokenId))
        .setAccountId(AccountId.fromString(accountId))
        .setSerials([serial])
        .freezeWith(client)
        .sign(wipeKey);
    await (await tx.execute(client)).getReceipt(client);
}
export async function updateNftMetadata(tokenId, serial, newUri) {
    const client = getClient();
    const metadataKey = getSupplyKey();
    const metadata = new TextEncoder().encode(newUri);
    const tx = await new TokenUpdateNftsTransaction()
        .setTokenId(TokenId.fromString(tokenId))
        .setSerialNumbers([Long.fromNumber(serial)])
        .setMetadata(metadata)
        .freezeWith(client)
        .sign(metadataKey);
    await (await tx.execute(client)).getReceipt(client);
}
export async function transferHbar(fromAccountId, toAccountId, amountHbar) {
    const client = getClient();
    const tx = new TransferTransaction()
        .addHbarTransfer(AccountId.fromString(fromAccountId), Hbar.fromTinybars(-Math.round(amountHbar * 100_000_000)))
        .addHbarTransfer(AccountId.fromString(toAccountId), Hbar.fromTinybars(Math.round(amountHbar * 100_000_000)));
    const result = await tx.execute(client);
    await result.getReceipt(client);
    return result.transactionId.toString();
}
export async function transferHbarWithKey(fromAccountId, fromPrivateKey, toAccountId, amountHbar) {
    const network = process.env.HEDERA_NETWORK ?? "testnet";
    const aid = AccountId.fromString(fromAccountId);
    const pk = normalizePrivateKey(fromPrivateKey);
    const client = network === "mainnet" ? Client.forMainnet() : Client.forTestnet();
    client.setOperator(aid, pk);
    try {
        const tx = new TransferTransaction()
            .addHbarTransfer(aid, Hbar.fromTinybars(-Math.round(amountHbar * 100_000_000)))
            .addHbarTransfer(AccountId.fromString(toAccountId), Hbar.fromTinybars(Math.round(amountHbar * 100_000_000)));
        const result = await tx.execute(client);
        await result.getReceipt(client);
        return result.transactionId.toString();
    }
    finally {
        client.close();
    }
}
export async function prepareTransferTransaction(fromAccountId, toAccountId, amountHbar) {
    const client = getClient();
    const tx = new TransferTransaction()
        .addHbarTransfer(AccountId.fromString(fromAccountId), Hbar.fromTinybars(-Math.round(amountHbar * 100_000_000)))
        .addHbarTransfer(AccountId.fromString(toAccountId), Hbar.fromTinybars(Math.round(amountHbar * 100_000_000)));
    const frozenTx = await tx.freezeWith(client);
    const txBytes = Buffer.from(frozenTx.toBytes()).toString("base64");
    const txId = frozenTx.transactionId?.toString();
    if (!txId)
        throw new Error("Failed to generate transaction ID");
    return { txBytes, txId };
}
export async function transferHbarWithSignature(txBytesBase64, publicKeyStr, signatureBytes) {
    const client = getClient();
    const txBytes = Buffer.from(txBytesBase64, "base64");
    const tx = Transaction.fromBytes(txBytes);
    const publicKey = PublicKey.fromString(publicKeyStr);
    const sigArray = Array.isArray(signatureBytes) ? signatureBytes : [signatureBytes];
    tx.addSignature(publicKey, sigArray);
    const result = await tx.execute(client);
    await result.getReceipt(client);
    return result.transactionId.toString();
}
export async function createScheduledTransfer(fromAccountId, toAccountId, amountHbar, options) {
    const client = getClient();
    const tinybars = Math.round(amountHbar * 100_000_000);
    const transferTx = new TransferTransaction()
        .addHbarTransfer(AccountId.fromString(fromAccountId), Hbar.fromTinybars(-tinybars))
        .addHbarTransfer(AccountId.fromString(toAccountId), Hbar.fromTinybars(tinybars));
    const scheduleTx = new ScheduleCreateTransaction()
        .setScheduledTransaction(transferTx);
    if (options?.adminKey !== false) {
        scheduleTx.setAdminKey(getSupplyKey().publicKey);
    }
    const expirationSeconds = options?.expirationSeconds ?? 86_400;
    const expirationDate = new Date(Date.now() + expirationSeconds * 1_000);
    scheduleTx.setExpirationTime(Timestamp.fromDate(expirationDate));
    const memo = options?.memo ?? `escrow:${fromAccountId}:${toAccountId}:${amountHbar}`;
    scheduleTx.setScheduleMemo(memo);
    const result = await scheduleTx.execute(client);
    const receipt = await result.getReceipt(client);
    if (!receipt.scheduleId) {
        throw new Error("Failed to create scheduled transaction: no scheduleId in receipt");
    }
    const scheduleId = receipt.scheduleId.toString();
    const scheduleTxId = receipt.scheduledTransactionId?.toString() ?? result.transactionId.toString();
    return { scheduleId, scheduleTxId };
}
export async function signScheduledTransaction(scheduleId, signerPrivateKey) {
    if (!scheduleId || !scheduleId.trim()) {
        throw new Error("scheduleId must be a non-empty string");
    }
    const client = getClient();
    const pk = normalizePrivateKey(signerPrivateKey);
    const tx = await new ScheduleSignTransaction()
        .setScheduleId(ScheduleId.fromString(scheduleId))
        .freezeWith(client)
        .sign(pk);
    const result = await tx.execute(client);
    const receipt = await result.getReceipt(client);
    const executed = receipt.status === Status.Success;
    if (!executed) {
        throw new Error(`ScheduleSign failed: receipt status ${receipt.status.toString()}`);
    }
    const paymentTxId = receipt.scheduledTransactionId?.toString() ?? result.transactionId.toString();
    return { txId: paymentTxId, executed };
}
export async function signScheduledTransactionWithSignature(scheduleId, txBytesBase64, publicKeyStr, signatureBytes) {
    if (!scheduleId || !scheduleId.trim()) {
        throw new Error("scheduleId must be a non-empty string");
    }
    const client = getClient();
    const txBytes = Buffer.from(txBytesBase64, "base64");
    const tx = Transaction.fromBytes(txBytes);
    const publicKey = PublicKey.fromString(publicKeyStr);
    const sigArray = Array.isArray(signatureBytes) ? signatureBytes : [signatureBytes];
    tx.addSignature(publicKey, sigArray);
    const result = await tx.execute(client);
    const receipt = await result.getReceipt(client);
    const executed = receipt.status === Status.Success;
    if (!executed) {
        throw new Error(`ScheduleSign failed: receipt status ${receipt.status.toString()}`);
    }
    const paymentTxId = receipt.scheduledTransactionId?.toString() ?? result.transactionId.toString();
    return { txId: paymentTxId, executed };
}
export async function deleteScheduledTransaction(scheduleId) {
    if (!scheduleId || !scheduleId.trim()) {
        throw new Error("scheduleId must be a non-empty string");
    }
    const client = getClient();
    const tx = new ScheduleDeleteTransaction().setScheduleId(ScheduleId.fromString(scheduleId));
    const result = await tx.execute(client);
    const receipt = await result.getReceipt(client);
    const deleted = receipt.status === Status.Success;
    return { scheduleId, deleted };
}
const HFS_MAX_SIZE_BYTES = 1024 * 1024;
const HFS_CHUNK_SIZE = 4095;
export async function uploadFileToHFS(contents, fileMemo) {
    if (contents.length > HFS_MAX_SIZE_BYTES) {
        throw new Error(`File too large: ${contents.length} bytes exceeds max size of ${HFS_MAX_SIZE_BYTES} bytes (1024 KB)`);
    }
    const client = getClient();
    const fileKey = getSupplyKey();
    const firstChunk = contents.subarray(0, HFS_CHUNK_SIZE);
    const remaining = contents.subarray(HFS_CHUNK_SIZE);
    const createTx = await new FileCreateTransaction()
        .setKeys([fileKey.publicKey])
        .setContents(firstChunk)
        .setMaxTransactionFee(new Hbar(5));
    if (fileMemo) {
        createTx.setFileMemo(fileMemo);
    }
    createTx.freezeWith(client);
    const signedCreate = await createTx.sign(fileKey);
    const createResult = await signedCreate.execute(client);
    const createReceipt = await createResult.getReceipt(client);
    if (!createReceipt.fileId) {
        throw new Error("Failed to create file: no fileId in receipt");
    }
    const fileId = createReceipt.fileId.toString();
    const txId = createResult.transactionId.toString();
    if (remaining.length > 0) {
        for (let offset = 0; offset < remaining.length; offset += HFS_CHUNK_SIZE) {
            const chunk = remaining.subarray(offset, offset + HFS_CHUNK_SIZE);
            const appendTx = await new FileAppendTransaction()
                .setFileId(FileId.fromString(fileId))
                .setContents(chunk)
                .setMaxTransactionFee(new Hbar(5))
                .freezeWith(client)
                .sign(fileKey);
            await (await appendTx.execute(client)).getReceipt(client);
        }
    }
    return { fileId, txId };
}
export async function downloadFileFromHFS(fileId) {
    const network = process.env.HEDERA_NETWORK ?? "testnet";
    const mirrorBases = {
        testnet: "https://testnet.mirrornode.hedera.com/api/v1",
        mainnet: "https://mainnet.mirrornode.hedera.com/api/v1",
        previewnet: "https://previewnet.mirrornode.hedera.com/api/v1",
    };
    const base = mirrorBases[network] ?? mirrorBases.testnet;
    const url = `${base}/files/${fileId}/content`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) {
            if (res.status === 404) {
                throw new Error(`File not found: ${fileId} (404)`);
            }
            throw new Error(`Mirror Node error ${res.status}: ${url}`);
        }
        const arrayBuffer = await res.arrayBuffer();
        return Buffer.from(arrayBuffer);
    }
    catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
            throw new Error(`Mirror Node timeout after 10000ms: ${url}`);
        }
        throw err;
    }
    finally {
        clearTimeout(timer);
    }
}
