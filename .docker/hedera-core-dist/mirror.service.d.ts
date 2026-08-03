import type { NftInfo, TopicMessage } from "./types";
export declare function getNftInfo(tokenId: string, serial: number): Promise<NftInfo | null>;
export declare function getNftsForToken(tokenId: string, opts?: {
    maxResults?: number;
}): Promise<NftInfo[]>;
export declare function getNftsForAccount(accountId: string, opts?: {
    maxResults?: number;
}): Promise<NftInfo[]>;
export declare function getTopicMessages(topicId: string, opts?: {
    startTime?: string;
    endTime?: string;
    limit?: number;
    maxResults?: number;
}): Promise<TopicMessage[]>;
export interface PaginatedMessages {
    messages: TopicMessage[];
    nextPageUrl: string | null;
}
export declare function getTopicMessagesPaginated(topicId: string, opts?: {
    startTime?: string;
    endTime?: string;
    limit?: number;
    pageUrl?: string;
}): Promise<PaginatedMessages>;
export interface ScheduleInfo {
    scheduleId: string;
    executed: boolean;
    deleted: boolean;
    expirationTime?: string;
    memo?: string;
    signers: string[];
    adminKey?: string;
}
export declare function getScheduleInfo(scheduleId: string): Promise<ScheduleInfo | null>;
