import type { NftInfo, TopicMessage } from "./types";
import type { PaginatedMessages, ScheduleInfo } from "./mirror.service";
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
export declare function getTopicMessagesPaginated(topicId: string, opts?: {
    startTime?: string;
    endTime?: string;
    limit?: number;
    pageUrl?: string;
}): Promise<PaginatedMessages>;
export declare function getScheduleInfo(scheduleId: string): Promise<ScheduleInfo | null>;
