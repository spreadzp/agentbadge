export interface DataHubSearchResult {
    entities: DataHubEntity[];
    total: number;
}
export interface DataHubEntity {
    urn: string;
    type: string;
    [key: string]: unknown;
}
export interface DataHubSchemaField {
    fieldPath: string;
    type: string;
    nullable?: boolean;
    description?: string;
}
export interface DataHubLineage {
    upstreams: DataHubEntity[];
    downstreams: DataHubEntity[];
}
export interface DataHubAssertion {
    urn: string;
    type?: string;
    [key: string]: unknown;
}
export interface DataHubAssertionResult {
    status: string;
    timestamp: number;
    [key: string]: unknown;
}
export interface LineageEdge {
    sourceUrn: string;
    targetUrn: string;
}
export declare class DataHubClient {
    private readonly baseUrl;
    private readonly staticToken;
    private readonly actorId;
    private readonly timeoutMs;
    private readonly mockMode;
    private cachedToken;
    constructor();
    generateToken(): Promise<string>;
    ensureToken(): Promise<string>;
    private rawGraphQL;
    private graphql;
    private doGraphQL;
    search(query: string, type: string, limit: number): Promise<DataHubSearchResult>;
    getEntity(urn: string): Promise<DataHubEntity | null>;
    listSchemaFields(datasetUrn: string): Promise<DataHubSchemaField[]>;
    getLineage(datasetUrn: string): Promise<DataHubLineage>;
    getDatasetAssertions(datasetUrn: string): Promise<DataHubAssertion[]>;
    addTerms(termUrns: string[], resourceUrn: string, subResourceType?: string, subResource?: string): Promise<Record<string, unknown>>;
    createGlossaryTerm(name: string, description: string, parentNodeUrn: string): Promise<string | null>;
    upsertDatasetSchemaAssertionMonitor(entityUrn: string, fields: string[], compatibility: string, description: string): Promise<string | null>;
    upsertDatasetFreshnessAssertionMonitor(entityUrn: string, schedule: string, description: string): Promise<string | null>;
    updateLineage(edgesToAdd: LineageEdge[], edgesToRemove: LineageEdge[]): Promise<Record<string, unknown>>;
    getAssertionResults(assertionUrn: string): Promise<DataHubAssertionResult[]>;
}
