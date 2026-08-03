const DID_REGEX = /^did:hcs:\d+\.\d+\.\d+:\d+$/;
const DID_EXTRACT_REGEX = /^did:hcs:(.+):(\d+)$/;
export function isValidA2ADid(did) {
    return DID_REGEX.test(did);
}
export function extractTokenAndSerial(did) {
    const match = DID_EXTRACT_REGEX.exec(did);
    if (!match)
        return null;
    return { tokenId: match[1], serial: parseInt(match[2], 10) };
}
export async function didToAccountId(did) {
    const parsed = extractTokenAndSerial(did);
    if (!parsed)
        return null;
    try {
        const { getNftInfo } = await import("./services-index");
        const nft = await getNftInfo(parsed.tokenId, parsed.serial);
        if (!nft || nft.deleted)
            return null;
        return nft.account_id;
    }
    catch {
        return null;
    }
}
export function getMessageDirection(from, to, didA, didB) {
    if (from === didA && to === didB)
        return "A→B";
    if (from === didB && to === didA)
        return "B→A";
    throw new Error("Invalid message direction");
}
