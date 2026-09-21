// EPIC-140 (SLICE-140-17): semantic-checkers.ts split — one file per checker.
// Shared types + helpers for all semantic checkers.
import type { ResponseSnapshot } from "../../scanner/snapshot";

export type Snapshots = Record<string, ResponseSnapshot | null>;

export interface SemanticCheckResult {
  outcome: "found" | "partial" | "absent" | "no_source";
  detail: string;
}

export type SemanticChecker = (sources: Snapshots) => SemanticCheckResult;

export function parseJsonBody(snapshot: ResponseSnapshot): unknown | null {
  if (!snapshot.body) return null;
  try {
    return JSON.parse(snapshot.body);
  } catch {
    return null;
  }
}

export interface OpenApiMediaType {
  example?: unknown;
  examples?: Record<string, unknown>;
  schema?: unknown;
}

export interface OpenApiResponse {
  description?: string;
  content?: Record<string, OpenApiMediaType>;
}

export interface OpenApiOperation {
  description?: string;
  parameters?: Array<{
    name?: string;
    in?: string;
    description?: string;
    required?: boolean;
    schema?: unknown;
  }>;
  requestBody?: {
    content?: Record<string, OpenApiMediaType>;
  };
  responses?: Record<string, OpenApiResponse>;
}

export interface OpenApiPathItem {
  [method: string]: OpenApiOperation | string | unknown;
}

export interface OpenApiSpec {
  paths?: Record<string, OpenApiPathItem>;
}

export const HTTP_METHODS = ["get", "post", "put", "delete", "patch", "head", "options", "trace"];

export function isHttpMethod(key: string): boolean {
  return HTTP_METHODS.includes(key.toLowerCase());
}

export function getOperations(spec: OpenApiSpec): Array<{ path: string; method: string; op: OpenApiOperation }> {
  const operations: Array<{ path: string; method: string; op: OpenApiOperation }> = [];
  if (!spec.paths) return operations;
  for (const [path, pathItem] of Object.entries(spec.paths)) {
    if (typeof pathItem !== "object" || pathItem === null) continue;
    for (const [method, op] of Object.entries(pathItem)) {
      if (!isHttpMethod(method)) continue;
      if (typeof op === "object" && op !== null) {
        operations.push({ path, method: method.toUpperCase(), op: op as OpenApiOperation });
      }
    }
  }
  return operations;
}

export interface HomepageMetaData {
  aiAgentDiscovery?: string | null;
  aiAgentOnboarding?: string | null;
  aiAgentDiscoveryReachable?: boolean;
  aiAgentOnboardingReachable?: boolean;
}

export function isValidHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}
