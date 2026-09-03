import type { AgentReadinessRule } from "../rule.schema";

export const AB160: AgentReadinessRule = {
  rule_id: "AB-160",
  version: "1.0.0",
  name: "Support path declared",
  category: "documentation",
  severity: "low",
  counted_in_score: true,
  check: {
    type: "semantic_validation",
    sources: ["guide", "llms", "security_txt"],
    semantic: "support_path_declared",
  },
  fix: {
    eligible: false,
    type: "assisted",
    note: "Add a dedicated support contact (email/URL) in your guide, llms.txt, or .well-known/security.txt (RFC 9116)",
  },
  display_question: "Where do I get help if something goes wrong?",
};
