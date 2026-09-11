import { mintPassportNFT, burnPassportNFT, getNftInfo, getTopicMessages, transferHbar, transferHbarWithKey, createScheduledTransfer, signScheduledTransaction, deleteScheduledTransaction, } from "./services-index";
import { extractTokenAndSerial } from "./did";
const HEDERA_CHAIN_METADATA = {
    id: 295,
    name: "Hedera Testnet",
    currency: "HBAR",
    symbol: "HBAR",
    decimals: 8,
};
function getMirrorBase() {
    const network = process.env.HEDERA_NETWORK ?? "testnet";
    return `https://${network}.mirrornode.hedera.com`;
}
function hashscanBase() {
    const network = process.env.HEDERA_NETWORK ?? "testnet";
    return `https://hashscan.io/${network}`;
}
export class HederaChainAdapter {
    chain = HEDERA_CHAIN_METADATA;
    explorer = {
        tx(txHash) {
            return `${hashscanBase()}/transaction/${txHash}`;
        },
        nft(tokenAddress, tokenId) {
            return `${hashscanBase()}/token/${tokenAddress}/${tokenId}`;
        },
        account(address) {
            return `${hashscanBase()}/account/${address}`;
        },
    };
    async mintPassport(tokenAddress, metadataUri) {
        return mintPassportNFT(tokenAddress, metadataUri);
    }
    async revokePassport(tokenAddress, tokenId) {
        return burnPassportNFT(tokenAddress, tokenId);
    }
    async getPassportInfo(tokenAddress, tokenId) {
        return getNftInfo(tokenAddress, tokenId);
    }
    buildDid(tokenAddress, tokenId) {
        return `did:hcs:${tokenAddress}:${tokenId}`;
    }
    async resolveDid(did) {
        const parsed = extractTokenAndSerial(did);
        if (!parsed)
            return null;
        try {
            const nft = await getNftInfo(parsed.tokenId, parsed.serial);
            if (!nft || nft.deleted)
                return null;
            return nft.account_id;
        }
        catch {
            return null;
        }
    }
    async verifyOwnershipSignature(did, _signature, _message) {
        const accountId = await this.resolveDid(did);
        return accountId !== null;
    }
    async createEscrowHold(params) {
        const amountHbar = Number(params.amount) / 1e8;
        const result = await createScheduledTransfer(params.from, params.to, amountHbar, {
            expirationSeconds: params.deadline
                ? Math.max(0, params.deadline - Math.floor(Date.now() / 1000))
                : undefined,
            memo: params.memo,
        });
        return {
            escrowId: result.scheduleId,
            txHash: result.scheduleTxId,
        };
    }
    async releaseEscrow(escrowId) {
        const operatorKey = process.env.HEDERA_OPERATOR_KEY;
        if (operatorKey) {
            await signScheduledTransaction(escrowId, operatorKey);
        }
        else {
            await signScheduledTransaction(escrowId, "mock-key");
        }
    }
    async reclaimEscrow(escrowId) {
        await deleteScheduledTransaction(escrowId);
    }
    async getBalance(address) {
        try {
            const url = `${getMirrorBase()}/api/v1/accounts/${address}/balance`;
            const resp = await fetch(url);
            if (!resp.ok)
                return 0;
            const data = (await resp.json());
            return data.balance ?? 0;
        }
        catch {
            return 0;
        }
    }
    async transferToken(params) {
        if (params.tokenAddress === "native") {
            const amountHbar = Number(params.amount) / 1e8;
            if (params.privateKey) {
                return transferHbarWithKey(params.from ?? "", params.privateKey, params.to, amountHbar);
            }
            return transferHbar(params.from ?? "", params.to, amountHbar);
        }
        throw new Error(`HTS token transfer not yet supported: ${params.tokenAddress}`);
    }
    async getEvents(query) {
        const messages = await getTopicMessages(query.contractAddress, {
            limit: query.limit,
        });
        return messages.map((msg, index) => ({
            blockNumber: msg.sequence_number,
            txHash: msg.transaction_id ?? "",
            eventName: "HCSMessage",
            args: { message: msg.message },
            logIndex: index,
        }));
    }
}
