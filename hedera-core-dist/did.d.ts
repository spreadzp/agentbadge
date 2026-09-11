export declare function isValidA2ADid(did: string): boolean;
export declare function extractTokenAndSerial(did: string): {
    tokenId: string;
    serial: number;
} | null;
export declare function didToAccountId(did: string): Promise<string | null>;
export declare function getMessageDirection(from: string, to: string, didA: string, didB: string): "A→B" | "B→A";
