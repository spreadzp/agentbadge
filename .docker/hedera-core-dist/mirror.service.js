const MIRROR_BASES = {
    testnet: "https://testnet.mirrornode.hedera.com/api/v1",
    mainnet: "https://mainnet.mirrornode.hedera.com/api/v1",
    previewnet: "https://previewnet.mirrornode.hedera.com/api/v1",
};
function getMirrorBase() {
    const network = process.env.HEDERA_NETWORK ?? "testnet";
    return MIRROR_BASES[network] ?? MIRROR_BASES.testnet;
}
function getMirrorTimeoutMs() {
    const raw = process.env.MIRROR_NODE_TIMEOUT_MS;
    if (!raw)
        return 10_000;
    const parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 10_000;
}
async function fetchMirrorNode(url) {
    const controller = new AbortController();
    const timeoutMs = getMirrorTimeoutMs();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) {
            if (res.status === 404)
                return {};
            throw new Error(`Mirror Node error ${res.status}: ${url}`);
        }
        return res.json();
    }
    catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
            throw new Error(`Mirror Node timeout after ${timeoutMs}ms: ${url}`);
        }
        throw err;
    }
    finally {
        clearTimeout(timer);
    }
}
export async function getNftInfo(tokenId, serial) {
    const base = getMirrorBase();
    const data = await fetchMirrorNode(`${base}/tokens/${tokenId}/nfts/${serial}`);
    if (!data || !data.serial_number)
        return null;
    const nft = data;
    if (nft.metadata) {
        nft.metadata = Buffer.from(nft.metadata, "base64").toString("utf8");
    }
    return nft;
}
export async function getNftsForToken(tokenId, opts) {
    const base = getMirrorBase();
    let url = `${base}/tokens/${tokenId}/nfts?limit=100`;
    const allNfts = [];
    while (url) {
        const data = await fetchMirrorNode(url);
        const nfts = data.nfts ?? [];
        for (const nft of nfts) {
            if (nft.metadata) {
                nft.metadata = Buffer.from(nft.metadata, "base64").toString("utf8");
            }
        }
        allNfts.push(...nfts);
        if (opts?.maxResults && allNfts.length >= opts.maxResults) {
            return allNfts.slice(0, opts.maxResults);
        }
        const next = data.links?.next;
        url = next ? `${base}${next}` : null;
    }
    return allNfts;
}
export async function getNftsForAccount(accountId, opts) {
    const base = getMirrorBase();
    let url = `${base}/accounts/${accountId}/nfts?limit=100`;
    const allNfts = [];
    while (url) {
        const data = await fetchMirrorNode(url);
        const nfts = data.nfts ?? [];
        for (const nft of nfts) {
            if (nft.metadata) {
                nft.metadata = Buffer.from(nft.metadata, "base64").toString("utf8");
            }
        }
        allNfts.push(...nfts);
        if (opts?.maxResults && allNfts.length >= opts.maxResults) {
            return allNfts.slice(0, opts.maxResults);
        }
        const next = data.links?.next;
        url = next ? `${base}${next}` : null;
    }
    return allNfts;
}
function toMirrorTimestamp(ts) {
    if (/^\d+\.\d+$/.test(ts))
        return ts;
    const d = new Date(ts);
    if (isNaN(d.getTime()))
        return ts;
    const seconds = Math.floor(d.getTime() / 1000);
    const nanos = (d.getTime() % 1000) * 1_000_000;
    return `${seconds}.${String(nanos).padStart(9, "0")}`;
}
export async function getTopicMessages(topicId, opts) {
    const base = getMirrorBase();
    const params = new URLSearchParams();
    params.set("limit", String(opts?.limit ?? 100));
    params.set("order", "desc");
    if (opts?.startTime)
        params.set("timestamp", `gt:${toMirrorTimestamp(opts.startTime)}`);
    if (opts?.endTime)
        params.set("timestamp", `lt:${toMirrorTimestamp(opts.endTime)}`);
    let url = `${base}/topics/${topicId}/messages?${params.toString()}`;
    const allMessages = [];
    while (url) {
        const data = await fetchMirrorNode(url);
        const messages = data.messages ?? [];
        for (const msg of messages) {
            const rawMessage = msg.message;
            const decoded = Buffer.from(rawMessage, "base64").toString("utf8");
            let txId = msg.transaction_id;
            if (!txId && msg.chunk_info) {
                const chunk = msg.chunk_info;
                const init = chunk.initial_transaction_id;
                if (init?.account_id && init?.transaction_valid_start) {
                    txId = `${init.account_id}-${init.transaction_valid_start.replace(".", "-")}`;
                }
            }
            allMessages.push({
                consensus_timestamp: msg.consensus_timestamp,
                message: decoded,
                sequence_number: msg.sequence_number,
                running_hash: msg.running_hash,
                chunk_info: msg.chunk_info,
                transaction_id: txId,
            });
        }
        if (opts?.maxResults && allMessages.length >= opts.maxResults) {
            return allMessages.slice(0, opts.maxResults);
        }
        const next = data.links?.next;
        url = next ? `${base}${next}` : null;
    }
    return allMessages;
}
export async function getTopicMessagesPaginated(topicId, opts) {
    const base = getMirrorBase();
    const url = opts?.pageUrl ??
        (() => {
            const params = new URLSearchParams();
            params.set("limit", String(opts?.limit ?? 100));
            params.set("order", "desc");
            if (opts?.startTime)
                params.set("timestamp", `gt:${opts.startTime}`);
            if (opts?.endTime)
                params.set("timestamp", `lt:${opts.endTime}`);
            return `${base}/topics/${topicId}/messages?${params.toString()}`;
        })();
    const data = await fetchMirrorNode(url);
    const messages = data.messages ?? [];
    const decoded = messages.map((msg) => ({
        consensus_timestamp: msg.consensus_timestamp,
        message: Buffer.from(msg.message, "base64").toString("utf8"),
        sequence_number: msg.sequence_number,
        running_hash: msg.running_hash,
        chunk_info: msg.chunk_info,
    }));
    const next = data.links?.next;
    const nextPageUrl = next ? `${base}${next}` : null;
    return { messages: decoded, nextPageUrl };
}
export async function getScheduleInfo(scheduleId) {
    const base = getMirrorBase();
    const data = await fetchMirrorNode(`${base}/schedules/${scheduleId}`);
    if (!data || !data.schedule_id)
        return null;
    return {
        scheduleId: data.schedule_id,
        executed: Boolean(data.executed),
        deleted: Boolean(data.deleted),
        expirationTime: data.expiration_time ? String(data.expiration_time) : undefined,
        memo: data.memo ? String(data.memo) : undefined,
        signers: Array.isArray(data.signatures)
            ? data.signatures.map((s) => String(s.public_key ?? ""))
            : [],
        adminKey: data.admin_key ? String(data.admin_key) : undefined,
    };
}
