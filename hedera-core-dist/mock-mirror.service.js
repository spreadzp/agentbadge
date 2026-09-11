import { nftStore, topicMessages } from "./mock-hedera.service";
export async function getNftInfo(tokenId, serial) {
    const key = `${tokenId}:${serial}`;
    const nft = nftStore.get(key);
    if (!nft)
        return null;
    return { ...nft };
}
export async function getNftsForToken(tokenId, opts) {
    const result = [];
    for (const nft of nftStore.values()) {
        if (nft.token_id === tokenId) {
            result.push({ ...nft });
        }
    }
    if (opts?.maxResults)
        return result.slice(0, opts.maxResults);
    return result;
}
export async function getNftsForAccount(accountId, opts) {
    const result = [];
    for (const nft of nftStore.values()) {
        if (nft.account_id === accountId) {
            result.push({ ...nft });
        }
    }
    if (opts?.maxResults)
        return result.slice(0, opts.maxResults);
    return result;
}
export async function getTopicMessages(topicId, opts) {
    const msgs = topicMessages.get(topicId) ?? [];
    let result = [...msgs];
    if (opts?.startTime) {
        result = result.filter((m) => m.consensus_timestamp > opts.startTime);
    }
    if (opts?.endTime) {
        result = result.filter((m) => m.consensus_timestamp < opts.endTime);
    }
    const limit = opts?.limit ?? 100;
    result.sort((a, b) => b.sequence_number - a.sequence_number);
    const sliced = result.slice(0, limit);
    if (opts?.maxResults)
        return sliced.slice(0, opts.maxResults);
    return sliced;
}
export async function getTopicMessagesPaginated(topicId, opts) {
    const msgs = topicMessages.get(topicId) ?? [];
    let result = [...msgs];
    if (opts?.startTime) {
        result = result.filter((m) => m.consensus_timestamp > opts.startTime);
    }
    if (opts?.endTime) {
        result = result.filter((m) => m.consensus_timestamp < opts.endTime);
    }
    const limit = opts?.limit ?? 100;
    result.sort((a, b) => b.sequence_number - a.sequence_number);
    const sliced = result.slice(0, limit);
    return {
        messages: sliced,
        nextPageUrl: null,
    };
}
export async function getScheduleInfo(scheduleId) {
    return {
        scheduleId,
        executed: false,
        deleted: false,
        signers: [],
        memo: "mock-escrow",
    };
}
