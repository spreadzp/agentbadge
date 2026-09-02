import { describe, it, expect } from "vitest";
import { renderFunnelAscii } from "../../../src/agent-readiness/cli/formatters/funnel-output";
import { computeFunnel } from "../../../src/agent-readiness/scoring/funnel-computer";

describe("funnel-output", () => {
  it("renders ASCII funnel with bars and percentages", () => {
    const funnel = computeFunnel({
      discovery: 80,
      agents_txt: 80,
      ai_sitemap: 80,
      openapi: 55,
      machine_readable: 55,
      bot_auth: 35,
      identity: 35,
      documentation: 15,
      actionability: 15,
      verification: 0,
    });
    const output = renderFunnelAscii(funnel);
    expect(output).toContain("Discovery");
    expect(output).toContain("80%");
    expect(output).toContain("Spec Parsed");
    expect(output).toContain("55%");
    expect(output).toContain("↓");
  });

  it("includes drop-off indicators between stages", () => {
    const funnel = computeFunnel({
      discovery: 100,
      agents_txt: 100,
      ai_sitemap: 100,
      openapi: 50,
      machine_readable: 50,
      bot_auth: 0,
      identity: 0,
      documentation: 0,
      actionability: 0,
      verification: 0,
    });
    const output = renderFunnelAscii(funnel);
    expect(output).toContain("↓50%");
  });
});
