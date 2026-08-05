import type { OpenApiEvidence, Evidence } from "./evidence.types";

export interface OpenApiFacts {
  valid: boolean;
  version: string | null;
  paths: string[];
  methods: string[];
  securitySchemes: SecurityScheme[];
  servers: string[];
}

export interface SecurityScheme {
  type: string;
  name: string;
  scheme?: string;
}

class OpenApiParserClass {
  /**
   * Parse OpenAPI 3.x spec content into typed facts.
   * Handles missing/invalid specs gracefully — returns empty facts, never throws.
   */
  parse(specContent: string): OpenApiFacts {
    const empty: OpenApiFacts = {
      valid: false,
      version: null,
      paths: [],
      methods: [],
      securitySchemes: [],
      servers: [],
    };

    if (!specContent || specContent.trim().length === 0) {
      return empty;
    }

    let spec: any;
    try {
      spec = JSON.parse(specContent);
    } catch {
      // Not valid JSON — could be YAML, but we don't parse YAML here
      return empty;
    }

    if (!spec || typeof spec !== "object") {
      return empty;
    }

    // Check for OpenAPI version
    const openapiVersion = spec.openapi;
    if (!openapiVersion || typeof openapiVersion !== "string") {
      return empty;
    }

    if (!openapiVersion.startsWith("3.")) {
      return empty;
    }

    const facts: OpenApiFacts = {
      valid: true,
      version: openapiVersion,
      paths: this.extractPaths(spec.paths),
      methods: this.extractMethods(spec.paths),
      securitySchemes: this.extractSecuritySchemes(spec.components?.securitySchemes),
      servers: this.extractServers(spec.servers),
    };

    return facts;
  }

  /**
   * Convert parsed facts into OpenApiEvidence.
   */
  toEvidence(facts: OpenApiFacts, url: string): OpenApiEvidence {
    return {
      type: "openapi",
      url,
      paths: facts.paths,
      methods: facts.methods,
    };
  }

  /**
   * Parse spec and return Evidence object directly.
   */
  parseToEvidence(specContent: string, url: string): Evidence {
    const facts = this.parse(specContent);
    return this.toEvidence(facts, url);
  }

  private extractPaths(paths: any): string[] {
    if (!paths || typeof paths !== "object") return [];
    return Object.keys(paths);
  }

  private extractMethods(paths: any): string[] {
    if (!paths || typeof paths !== "object") return [];
    const methodSet = new Set<string>();
    const validMethods = ["get", "post", "put", "delete", "patch", "head", "options"];

    for (const pathObj of Object.values(paths)) {
      if (pathObj && typeof pathObj === "object") {
        for (const key of Object.keys(pathObj)) {
          if (validMethods.includes(key.toLowerCase())) {
            methodSet.add(key.toUpperCase());
          }
        }
      }
    }

    return [...methodSet];
  }

  private extractSecuritySchemes(schemes: any): SecurityScheme[] {
    if (!schemes || typeof schemes !== "object") return [];
    const result: SecurityScheme[] = [];

    for (const [name, scheme] of Object.entries(schemes)) {
      const s = scheme as any;
      if (s && typeof s === "object" && s.type) {
        result.push({
          type: s.type,
          name,
          scheme: s.scheme,
        });
      }
    }

    return result;
  }

  private extractServers(servers: any): string[] {
    if (!Array.isArray(servers)) return [];
    return servers
      .filter((s) => s && typeof s === "object" && typeof s.url === "string")
      .map((s) => s.url);
  }
}

export const OpenApiParser = new OpenApiParserClass();
export { OpenApiParserClass };
