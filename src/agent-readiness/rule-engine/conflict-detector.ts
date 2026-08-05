import type { Evidence, CrossEvidence, HttpEvidence, OpenApiEvidence, RobotsEvidence, SitemapEvidence } from "./evidence.types";

class ConflictDetectorClass {
  /**
   * Detect conflicts between multiple evidence sources.
   * Returns CrossEvidence if conflict found, null otherwise.
   */
  detect(evidence: Evidence[]): CrossEvidence | null {
    if (evidence.length <= 1) return null;

    // Group evidence by type for comparison
    const byType = this.groupByType(evidence);

    // Compare HTTP evidence (same URL, different status)
    const httpConflict = this.detectHttpConflict(byType.http);
    if (httpConflict) return httpConflict;

    // Compare OpenAPI evidence (same URL, different paths)
    const openApiConflict = this.detectOpenApiConflict(byType.openapi);
    if (openApiConflict) return openApiConflict;

    // Compare robots evidence (same URL, different allows_all)
    const robotsConflict = this.detectRobotsConflict(byType.robots);
    if (robotsConflict) return robotsConflict;

    // Compare sitemap evidence (same URL, different url_count)
    const sitemapConflict = this.detectSitemapConflict(byType.sitemap);
    if (sitemapConflict) return sitemapConflict;

    return null;
  }

  private groupByType(evidence: Evidence[]): {
    http: HttpEvidence[];
    openapi: OpenApiEvidence[];
    robots: RobotsEvidence[];
    sitemap: SitemapEvidence[];
  } {
    return {
      http: evidence.filter((e): e is HttpEvidence => e.type === "http"),
      openapi: evidence.filter((e): e is OpenApiEvidence => e.type === "openapi"),
      robots: evidence.filter((e): e is RobotsEvidence => e.type === "robots"),
      sitemap: evidence.filter((e): e is SitemapEvidence => e.type === "sitemap"),
    };
  }

  private detectHttpConflict(evidence: HttpEvidence[]): CrossEvidence | null {
    if (evidence.length < 2) return null;

    for (let i = 0; i < evidence.length; i++) {
      for (let j = i + 1; j < evidence.length; j++) {
        if (evidence[i].url === evidence[j].url && evidence[i].status !== evidence[j].status) {
          return {
            type: "cross",
            sources: [evidence[i], evidence[j]],
            match_keys: ["url", "status"],
            conflict_reason: `URL ${evidence[i].url} returned status ${evidence[i].status} and ${evidence[j].status}`,
          };
        }
      }
    }

    return null;
  }

  private detectOpenApiConflict(evidence: OpenApiEvidence[]): CrossEvidence | null {
    if (evidence.length < 2) return null;

    for (let i = 0; i < evidence.length; i++) {
      for (let j = i + 1; j < evidence.length; j++) {
        if (evidence[i].url === evidence[j].url) {
          const pathsDiff = this.arrayDiff(evidence[i].paths, evidence[j].paths);
          if (pathsDiff.length > 0) {
            return {
              type: "cross",
              sources: [evidence[i], evidence[j]],
              match_keys: ["url", "paths"],
              conflict_reason: `OpenAPI ${evidence[i].url} has different paths: ${pathsDiff.join(", ")}`,
            };
          }
        }
      }
    }

    return null;
  }

  private detectRobotsConflict(evidence: RobotsEvidence[]): CrossEvidence | null {
    if (evidence.length < 2) return null;

    for (let i = 0; i < evidence.length; i++) {
      for (let j = i + 1; j < evidence.length; j++) {
        if (evidence[i].url === evidence[j].url && evidence[i].allows_all !== evidence[j].allows_all) {
          return {
            type: "cross",
            sources: [evidence[i], evidence[j]],
            match_keys: ["url", "allows_all"],
            conflict_reason: `robots.txt ${evidence[i].url} has conflicting allows_all: ${evidence[i].allows_all} vs ${evidence[j].allows_all}`,
          };
        }
      }
    }

    return null;
  }

  private detectSitemapConflict(evidence: SitemapEvidence[]): CrossEvidence | null {
    if (evidence.length < 2) return null;

    for (let i = 0; i < evidence.length; i++) {
      for (let j = i + 1; j < evidence.length; j++) {
        if (evidence[i].url === evidence[j].url && evidence[i].url_count !== evidence[j].url_count) {
          return {
            type: "cross",
            sources: [evidence[i], evidence[j]],
            match_keys: ["url", "url_count"],
            conflict_reason: `sitemap.xml ${evidence[i].url} has different url_count: ${evidence[i].url_count} vs ${evidence[j].url_count}`,
          };
        }
      }
    }

    return null;
  }

  private arrayDiff<T>(a: T[], b: T[]): T[] {
    const setB = new Set(b);
    return a.filter((x) => !setB.has(x));
  }
}

export const ConflictDetector = new ConflictDetectorClass();
export { ConflictDetectorClass };
