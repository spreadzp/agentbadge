import type { AgentReadinessRule } from "./rule.schema";
import { AB001 } from "../../tests/fixtures/agent-readiness-rules/AB-001";
import { AB002 } from "../../tests/fixtures/agent-readiness-rules/AB-002";
import { AB003 } from "../../tests/fixtures/agent-readiness-rules/AB-003";
import { AB004 } from "../../tests/fixtures/agent-readiness-rules/AB-004";
import { AB005 } from "../../tests/fixtures/agent-readiness-rules/AB-005";
import { AB006 } from "../../tests/fixtures/agent-readiness-rules/AB-006";
import { AB007 } from "../../tests/fixtures/agent-readiness-rules/AB-007";
import { AB008 } from "../../tests/fixtures/agent-readiness-rules/AB-008";
import { AB009 } from "../../tests/fixtures/agent-readiness-rules/AB-009";
import { AB010 } from "../../tests/fixtures/agent-readiness-rules/AB-010";
import { AB011 } from "../../tests/fixtures/agent-readiness-rules/AB-011";
import { AB012 } from "../../tests/fixtures/agent-readiness-rules/AB-012";
import { AB013 } from "../../tests/fixtures/agent-readiness-rules/AB-013";

export const AGENT_READINESS_RULESET = {
  name: "agent-readiness",
  version: "1.2.0",
  rules: [
    AB001,
    AB002,
    AB003,
    AB004,
    AB005,
    AB006,
    AB007,
    AB008,
    AB009,
    AB010,
    AB011,
    AB012,
    AB013,
  ] as AgentReadinessRule[],
} as const;

export type AgentReadinessRuleset = typeof AGENT_READINESS_RULESET;
