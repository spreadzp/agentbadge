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
import { AB030 } from "./rules/AB030";
import { AB031 } from "./rules/AB031";
import { AB032 } from "./rules/AB032";
import { AB033 } from "./rules/AB033";
import { AB034 } from "./rules/AB034";
import { AB035 } from "./rules/AB035";
import { AB036 } from "./rules/AB036";
import { AB037 } from "./rules/AB037";
import { AB038 } from "./rules/AB038";
import { AB039 } from "./rules/AB039";
import { AB040 } from "./rules/AB040";
import { AB041 } from "./rules/AB041";
import { AB042 } from "./rules/AB042";
import { AB043 } from "./rules/AB043";
import { AB044 } from "./rules/AB044";
import { AB045 } from "./rules/AB045";
import { AB046 } from "./rules/AB046";
import { AB047 } from "./rules/AB047";
import { AB048 } from "./rules/AB048";
import { AB049 } from "./rules/AB049";
import { AB050 } from "./rules/AB050";
import { AB051 } from "./rules/AB051";
import { AB052 } from "./rules/AB052";
import { AB053 } from "./rules/AB053";
import { AB054 } from "./rules/AB054";
import { AB055 } from "./rules/AB055";

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
    AB030,
    AB031,
    AB032,
    AB033,
    AB034,
    AB035,
    AB036,
    AB037,
    AB038,
    AB039,
    AB040,
    AB041,
    AB042,
    AB043,
    AB044,
    AB045,
    AB046,
    AB047,
    AB048,
    AB049,
    AB050,
    AB051,
    AB052,
    AB053,
    AB054,
    AB055,
  ] as AgentReadinessRule[],
} as const;

export type AgentReadinessRuleset = typeof AGENT_READINESS_RULESET;
