import { statSync } from "node:fs";
import { agentReadinessRuleSchema, type AgentReadinessRule } from "../rule.schema";
import { AGENT_READINESS_RULESET } from "../ruleset";

export interface LoadedRules {
  rules: AgentReadinessRule[];
  loadedAt: string;
  manifestVersion: string;
}

interface CacheEntry {
  rules: AgentReadinessRule[];
  mtime: number;
  loadedAt: string;
  manifestVersion: string;
}

class RuleLoaderClass {
  private cache = new Map<string, CacheEntry>();

  /**
   * Load and validate all rules from the ruleset manifest.
   * Results are cached by (dir, mtime) — re-loads only if directory changed.
   */
  loadFromManifest(manifestPath?: string): LoadedRules {
    const dir = manifestPath ?? this.getDefaultDir();
    const mtime = this.getDirMtime(dir);

    const cached = this.cache.get(dir);
    if (cached && cached.mtime === mtime) {
      return {
        rules: cached.rules,
        loadedAt: cached.loadedAt,
        manifestVersion: cached.manifestVersion,
      };
    }

    const rules = this.validateRules(AGENT_READINESS_RULESET.rules);
    const loadedAt = new Date().toISOString();

    this.cache.set(dir, {
      rules,
      mtime,
      loadedAt,
      manifestVersion: AGENT_READINESS_RULESET.version,
    });

    return { rules, loadedAt, manifestVersion: AGENT_READINESS_RULESET.version };
  }

  /**
   * Validate an array of rules against the Zod schema.
   * Throws with rule_id on invalid rules.
   */
  private validateRules(rules: readonly AgentReadinessRule[]): AgentReadinessRule[] {
    const validated: AgentReadinessRule[] = [];

    for (const rule of rules) {
      const result = agentReadinessRuleSchema.safeParse(rule);
      if (!result.success) {
        const issues = result.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ");
        throw new Error(
          `Invalid rule ${rule.rule_id ?? "unknown"}: ${issues}`,
        );
      }
      validated.push(result.data);
    }

    return validated;
  }

  /**
   * Validate a single rule. Returns the rule if valid, throws otherwise.
   */
  validateRule(rule: unknown): AgentReadinessRule {
    const result = agentReadinessRuleSchema.safeParse(rule);
    if (!result.success) {
      const issues = result.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      throw new Error(`Invalid rule: ${issues}`);
    }
    return result.data;
  }

  /**
   * Get all rule IDs from the loaded ruleset.
   */
  getRuleIds(): string[] {
    return AGENT_READINESS_RULESET.rules.map((r) => r.rule_id);
  }

  /**
   * Find a rule by ID.
   */
  findRule(ruleId: string): AgentReadinessRule | undefined {
    return AGENT_READINESS_RULESET.rules.find((r) => r.rule_id === ruleId);
  }

  /**
   * Clear the cache. Useful for testing.
   */
  clearCache(): void {
    this.cache.clear();
  }

  private getDefaultDir(): string {
    return "src/agent-readiness";
  }

  private getDirMtime(dir: string): number {
    try {
      return statSync(dir).mtimeMs;
    } catch {
      return 0;
    }
  }
}

export const RuleLoader = new RuleLoaderClass();
export { RuleLoaderClass };
