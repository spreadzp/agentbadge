// EPIC-140 (SLICE-140-18): rule-engine.ts split — cross-evidence collection
// extracted from RuleEngineClass (pure move).
import type { AgentReadinessRule } from "../rule.schema";
import type { ResponseSnapshot } from "../scanner/snapshot";
import type { Evidence } from "./evidence.types";
import { OpenApiParser } from "./openapi-parser";

/**
 * Collect cross-evidence from multiple sources and compare them.
 * Used for cross_evidence check type (e.g., AB-007: Guide ↔ OpenAPI consistency).
 */
export function collectCrossEvidence(
  rule: AgentReadinessRule,
  snapshots: Record<string, ResponseSnapshot | null>,
): Evidence[] {
  const sourceKeys = rule.check.sources ?? [];
  const subEvidence: Evidence[] = [];

  // Collect evidence from each source
  for (const srcKey of sourceKeys) {
    const snap = snapshots[srcKey];
    if (!snap) continue;

    if (srcKey === "openapi") {
      const body = snap.body;
      if (body) {
        const facts = OpenApiParser.parse(body);
        subEvidence.push({
          type: "openapi",
          url: snap.url,
          paths: facts.paths,
          methods: facts.methods,
          captured_at: snap.fetchedAt,
        });
      }
    } else if (srcKey === "guide") {
      // Parse guide body for endpoint mentions
      const body = snap.body ?? "";
      const paths: string[] = [];
      const methods: string[] = [];

      // Try parsing as JSON first — agent-guide.json has api_endpoints array
      try {
        const guideJson = JSON.parse(body);
        if (guideJson.api_endpoints && Array.isArray(guideJson.api_endpoints)) {
          for (const ep of guideJson.api_endpoints) {
            const parts = String(ep).split(/\s+/);
            if (parts.length >= 2) {
              methods.push(parts[0].toUpperCase());
              paths.push(parts[1]);
            }
          }
        }
      } catch {
        // Not JSON, fall through to regex parsing
      }

      // Also extract endpoint-like patterns from text (e.g., "GET /api/foo", "POST /bar")
      if (paths.length === 0) {
        const endpointPattern = /(?:^|\s)(GET|POST|PUT|DELETE|PATCH)\s+(\/[^\s]+)/gmi;
        let m: RegExpExecArray | null;
        while ((m = endpointPattern.exec(body)) !== null) {
          methods.push(m[1].toUpperCase());
          paths.push(m[2]);
        }
      }
      subEvidence.push({
        type: "openapi",
        url: snap.url,
        paths,
        methods,
        captured_at: snap.fetchedAt,
      });
    } else {
      // Generic HTTP evidence for other sources
      subEvidence.push({
        type: "http",
        url: snap.url,
        status: snap.status,
        headers: snap.headers ?? {},
        content_hash: snap.bodyHash,
        content_type: snap.contentType,
        resolved_ip: snap.resolvedIp,
        captured_at: snap.fetchedAt,
      });
    }
  }

  if (subEvidence.length < 2) {
    return subEvidence;
  }

  // Compare endpoints across OpenAPI-type evidence
  const openApiEvidence = subEvidence.filter((e) => e.type === "openapi") as Extract<Evidence, { type: "openapi" }>[];
  if (openApiEvidence.length >= 2) {
    const matchKeys = rule.check.match_keys ?? [];
    let hasConflict = false;
    let conflictReason = "";

    if (matchKeys.includes("path")) {
      // Compare paths between sources
      const paths1 = new Set(openApiEvidence[0].paths);
      const paths2 = new Set(openApiEvidence[1].paths);
      const onlyIn1 = [...paths1].filter((p) => !paths2.has(p));
      const onlyIn2 = [...paths2].filter((p) => !paths1.has(p));

      // Fuzzy matching: if one source is a subset (guide ⊂ openapi), treat as verified
      // Guide is expected to be a subset of OpenAPI, not a 1:1 match
      const maxLen = Math.max(paths1.size, paths2.size);
      const overlap = maxLen - onlyIn1.length - onlyIn2.length;
      const coverage = maxLen > 0 ? overlap / maxLen : 1;

      // If coverage >= 80%, no conflict (guide covers most OpenAPI paths)
      if (coverage < 0.8 && (onlyIn1.length > 0 || onlyIn2.length > 0)) {
        hasConflict = true;
        conflictReason = `Paths differ: only in ${openApiEvidence[0].url}: [${onlyIn1.join(", ")}], only in ${openApiEvidence[1].url}: [${onlyIn2.join(", ")}]`;
      }
    }

    if (!hasConflict && matchKeys.includes("method")) {
      // Compare methods for matching paths
      const ev1 = openApiEvidence[0];
      const ev2 = openApiEvidence[1];
      const methods1 = new Set(ev1.methods);
      const methods2 = new Set(ev2.methods);
      const onlyIn1 = [...methods1].filter((m) => !methods2.has(m));
      const onlyIn2 = [...methods2].filter((m) => !methods1.has(m));
      if (onlyIn1.length > 0 || onlyIn2.length > 0) {
        hasConflict = true;
        conflictReason = `Methods differ: only in ${ev1.url}: [${onlyIn1.join(", ")}], only in ${ev2.url}: [${onlyIn2.join(", ")}]`;
      }
    }

    if (hasConflict) {
      return [{
        type: "cross",
        sources: subEvidence,
        match_keys: matchKeys,
        conflict_reason: conflictReason || rule.check.conflict_when || "sources disagree",
      }];
    }

    // No conflict — return cross evidence with no conflict
    return [{
      type: "cross",
      sources: subEvidence,
      match_keys: matchKeys,
      conflict_reason: "",
    }];
  }

  return subEvidence;
}
