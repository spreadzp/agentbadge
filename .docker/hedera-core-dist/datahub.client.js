const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_GMS_URL = "http://localhost:8080";
export class DataHubClient {
    baseUrl;
    token;
    timeoutMs;
    mockMode;
    constructor() {
        this.baseUrl = (process.env.DATAHUB_GMS_URL ?? DEFAULT_GMS_URL).replace(/\/$/, "");
        this.token = process.env.DATAHUB_TOKEN;
        this.timeoutMs = parseTimeout();
        this.mockMode = !process.env.DATAHUB_ENABLED || process.env.DATAHUB_ENABLED === "false";
    }
    async graphql(query, variables) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
            const headers = {
                "Content-Type": "application/json",
            };
            if (this.token) {
                headers["Authorization"] = `Bearer ${this.token}`;
            }
            const res = await fetch(`${this.baseUrl}/api/graphql`, {
                method: "POST",
                headers,
                body: JSON.stringify({ query, variables }),
                signal: controller.signal,
            });
            if (!res.ok) {
                const body = await res.text().catch(() => "");
                throw new Error(`DataHub HTTP ${res.status}: ${body || res.statusText}`);
            }
            const json = (await res.json());
            if (json.errors && json.errors.length > 0) {
                throw new Error(json.errors.map((e) => e.message).join("; "));
            }
            if (!json.data) {
                throw new Error("DataHub returned no data");
            }
            return json.data;
        }
        catch (err) {
            if (err instanceof DOMException && err.name === "AbortError") {
                throw new Error(`DataHub timeout after ${this.timeoutMs}ms`);
            }
            throw err;
        }
        finally {
            clearTimeout(timer);
        }
    }
    async search(query, type, limit) {
        if (this.mockMode)
            return { entities: [], total: 0 };
        const data = await this.graphql(SEARCH_QUERY, { query, type, limit });
        return {
            total: data.search.total,
            entities: data.search.searchResults.map((r) => r.entity),
        };
    }
    async getEntity(urn) {
        if (this.mockMode)
            return null;
        const data = await this.graphql(GET_ENTITY_QUERY, { urn });
        return data.entity;
    }
    async listSchemaFields(datasetUrn) {
        if (this.mockMode)
            return [];
        const data = await this.graphql(DATASET_SCHEMA_QUERY, { urn: datasetUrn });
        if (!data.dataset?.schemaMetadata)
            return [];
        return data.dataset.schemaMetadata.fields.map((f) => ({
            fieldPath: f.fieldPath,
            type: f.type?.type ?? "UNKNOWN",
        }));
    }
    async getLineage(datasetUrn) {
        if (this.mockMode)
            return { upstreams: [], downstreams: [] };
        const data = await this.graphql(LINEAGE_QUERY, { urn: datasetUrn });
        return {
            upstreams: data.lineage.upstreams.map((u) => u.entity),
            downstreams: data.lineage.downstreams.map((d) => d.entity),
        };
    }
    async getDatasetAssertions(datasetUrn) {
        if (this.mockMode)
            return [];
        const data = await this.graphql(DATASET_ASSERTIONS_QUERY, { urn: datasetUrn });
        if (!data.dataset?.assertions)
            return [];
        return data.dataset.assertions.assertions.map((a) => a.entity);
    }
    async addTerms(termUrns, resourceUrn, subResourceType, subResource) {
        if (this.mockMode)
            return {};
        const data = await this.graphql(ADD_TERMS_MUTATION, {
            termUrns,
            resourceUrn,
            subResourceType: subResourceType ?? null,
            subResource: subResource ?? null,
        });
        return data;
    }
    async createGlossaryTerm(name, description, parentNodeUrn) {
        if (this.mockMode)
            return null;
        const data = await this.graphql(CREATE_GLOSSARY_TERM_MUTATION, { name, description, parentNodeUrn });
        return data.createGlossaryTerm?.urn ?? null;
    }
    async upsertDatasetSchemaAssertionMonitor(entityUrn, fields, compatibility, description) {
        if (this.mockMode)
            return null;
        const data = await this.graphql(UPSERT_SCHEMA_ASSERTION_MUTATION, {
            entityUrn,
            fields,
            compatibility,
            description,
        });
        return data.upsertDatasetSchemaAssertionMonitor?.urn ?? null;
    }
    async upsertDatasetFreshnessAssertionMonitor(entityUrn, schedule, description) {
        if (this.mockMode)
            return null;
        const data = await this.graphql(UPSERT_FRESHNESS_ASSERTION_MUTATION, {
            entityUrn,
            schedule,
            description,
        });
        return data.upsertDatasetFreshnessAssertionMonitor?.urn ?? null;
    }
    async updateLineage(edgesToAdd, edgesToRemove) {
        if (this.mockMode)
            return {};
        const data = await this.graphql(UPDATE_LINEAGE_MUTATION, {
            edgesToAdd,
            edgesToRemove,
        });
        return data;
    }
    async getAssertionResults(assertionUrn) {
        if (this.mockMode)
            return [];
        const data = await this.graphql(ASSERTION_RESULTS_QUERY, { urn: assertionUrn });
        if (!data.assertion?.runEvents)
            return [];
        return data.assertion.runEvents.map((e) => ({
            status: e.status,
            timestamp: e.timestamp,
        }));
    }
}
function parseTimeout() {
    const raw = process.env.DATAHUB_TIMEOUT_MS;
    if (!raw)
        return DEFAULT_TIMEOUT_MS;
    const parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}
const SEARCH_QUERY = `
  query Search($query: String!, $type: EntityType!, $limit: Int!) {
    search(query: $query, type: $type, limit: $limit) {
      total
      searchResults {
        entity {
          urn
          type
        }
      }
    }
  }
`;
const GET_ENTITY_QUERY = `
  query GetEntity($urn: String!) {
    entity(urn: $urn) {
      urn
      type
    }
  }
`;
const DATASET_SCHEMA_QUERY = `
  query GetDatasetSchema($urn: String!) {
    dataset(urn: $urn) {
      urn
      schemaMetadata {
        fields {
          fieldPath
          type {
            type
          }
        }
      }
    }
  }
`;
const LINEAGE_QUERY = `
  query GetLineage($urn: String!) {
    lineage(urn: $urn) {
      upstreams {
        entity {
          urn
          type
        }
      }
      downstreams {
        entity {
          urn
          type
        }
      }
    }
  }
`;
const DATASET_ASSERTIONS_QUERY = `
  query GetDatasetAssertions($urn: String!) {
    dataset(urn: $urn) {
      assertions {
        total
        assertions {
          entity {
            urn
            type
          }
        }
      }
    }
  }
`;
const ADD_TERMS_MUTATION = `
  mutation AddTerms($termUrns: [String!]!, $resourceUrn: String!, $subResourceType: String, $subResource: String) {
    addTerms(termUrns: $termUrns, resourceUrn: $resourceUrn, subResourceType: $subResourceType, subResource: $subResource)
  }
`;
const CREATE_GLOSSARY_TERM_MUTATION = `
  mutation CreateGlossaryTerm($name: String!, $description: String!, $parentNodeUrn: String!) {
    createGlossaryTerm(input: { name: $name, description: $description, parentNodeUrn: $parentNodeUrn }) {
      urn
    }
  }
`;
const UPSERT_SCHEMA_ASSERTION_MUTATION = `
  mutation UpsertSchemaAssertion($entityUrn: String!, $fields: [String!]!, $compatibility: String!, $description: String!) {
    upsertDatasetSchemaAssertionMonitor(entityUrn: $entityUrn, fields: $fields, compatibility: $compatibility, description: $description) {
      urn
    }
  }
`;
const UPSERT_FRESHNESS_ASSERTION_MUTATION = `
  mutation UpsertFreshnessAssertion($entityUrn: String!, $schedule: String!, $description: String!) {
    upsertDatasetFreshnessAssertionMonitor(entityUrn: $entityUrn, schedule: $schedule, description: $description) {
      urn
    }
  }
`;
const UPDATE_LINEAGE_MUTATION = `
  mutation UpdateLineage($edgesToAdd: [LineageEdgeInput!]!, $edgesToRemove: [LineageEdgeInput!]!) {
    updateLineage(edgesToAdd: $edgesToAdd, edgesToRemove: $edgesToRemove)
  }
`;
const ASSERTION_RESULTS_QUERY = `
  query GetAssertionResults($urn: String!) {
    assertion(urn: $urn) {
      runEvents {
        status
        timestamp
      }
    }
  }
`;
