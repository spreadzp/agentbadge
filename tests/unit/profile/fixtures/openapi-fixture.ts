import type { Evidence } from "../../../../src/agent-readiness/rule-engine/evidence.types";

/**
 * SLICE-101-3: OpenAPI fixture evidence for path parser tests.
 */

export function makeOpenApiEvidence(paths: string[], methods: string[]): Evidence {
  return {
    type: "openapi",
    url: "https://api.example.com/openapi.json",
    paths,
    methods,
    captured_at: "2026-09-01T10:00:00Z",
    source_class: "machine_readable_spec",
  };
}

export function makeOpenApiEvidenceWithDetail(specJson: string): Evidence {
  return {
    type: "openapi",
    url: "https://api.example.com/openapi.json",
    paths: [],
    methods: [],
    captured_at: "2026-09-01T10:00:00Z",
    source_class: "machine_readable_spec",
    semantic_detail: specJson,
  } as any;
}

export const sampleOpenApiSpec = {
  openapi: "3.1.0",
  info: { title: "Example API", version: "1.0.0" },
  paths: {
    "/api/v1/tasks": {
      get: { summary: "List all tasks", operationId: "listTasks" },
      post: { summary: "Create a task", operationId: "createTask" },
    },
    "/api/v1/tasks/{id}": {
      get: { summary: "Get task by ID", operationId: "getTask" },
      delete: { summary: "Delete task", operationId: "deleteTask" },
    },
    "/api/v1/health": {
      get: { summary: "Health check", operationId: "healthCheck" },
    },
  },
};

export function makeHttpEvidence(url: string): Evidence {
  return {
    type: "http",
    url,
    status: 200,
    headers: { "content-type": "text/html" },
    content_hash: "abc123",
    content_type: "text/html",
    resolved_ip: null,
    source_class: "website_content",
  };
}

export function makeMcpEvidence(): Evidence {
  return {
    type: "http",
    url: "https://api.example.com/.well-known/mcp.json",
    status: 200,
    headers: { "content-type": "application/json" },
    content_hash: "mcp456",
    content_type: "application/json",
    resolved_ip: null,
    source_class: "machine_readable_spec",
    semantic_detail: '{"protocol":"mcp","capabilities":["tools","resources"]}',
  };
}
