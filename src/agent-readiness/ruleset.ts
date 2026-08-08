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
import { AB014 } from "../../tests/fixtures/agent-readiness-rules/AB-014";
import { AB015 } from "./rules/AB015";
import { AB016 } from "./rules/AB016";
import { AB017 } from "./rules/AB017";
import { AB018 } from "./rules/AB018";
import { AB019 } from "./rules/AB019";
import { AB020 } from "./rules/AB020";
import { AB021 } from "./rules/AB021";
import { AB022 } from "./rules/AB022";
import { AB023 } from "./rules/AB023";
import { AB024 } from "./rules/AB024";
import { AB025 } from "./rules/AB025";
import { AB026 } from "./rules/AB026";
import { AB027 } from "./rules/AB027";
import { AB028 } from "./rules/AB028";
import { AB029 } from "./rules/AB029";

export const AGENT_READINESS_RULESET = {
  name: "agent-readiness",
  version: "1.3.0",
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
    AB014,
    AB015,
    AB016,
    AB017,
    AB018,
    AB019,
    AB020,
    AB021,
    AB022,
    AB023,
    AB024,
    AB025,
    AB026,
    AB027,
    AB028,
    AB029,
  ] as AgentReadinessRule[],
} as const;

export type AgentReadinessRuleset = typeof AGENT_READINESS_RULESET;
