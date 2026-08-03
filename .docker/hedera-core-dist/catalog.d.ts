export interface TierEntry {
    name: string;
    price: number;
    capabilities: string[];
}
export declare function getCatalog(): TierEntry[];
export interface McpToolEntry {
    name: string;
    description: string;
    category: "passport" | "directory" | "market" | "a2a" | "auth" | "audit" | "discovery" | "guide";
}
export declare const MCP_TOOLS_INDEX: McpToolEntry[];
export declare function getLlmsTxt(): string;
