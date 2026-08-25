import { describe, it, expect } from "vitest";
import { webSiteLd } from "../../src/server/lib/json-ld";

describe("SLICE-81-2: SearchAction target consistent with robots.txt", () => {
  it("webSiteLd does not declare potentialAction pointing at Disallow path", () => {
    const schema = webSiteLd() as Record<string, unknown>;
    const action = schema.potentialAction as
      | { target?: { urlTemplate?: string } }
      | undefined;

    if (action && action.target?.urlTemplate) {
      const url = action.target.urlTemplate;
      // Extract path from URL
      const path = new URL(url).pathname;
      // robots.txt disallows /ui/, /a2a/, /agents, /market/tasks/, /admin
      const disallowed = ["/ui/", "/a2a/", "/agents", "/market/tasks/", "/admin"];
      for (const dis of disallowed) {
        expect(path.startsWith(dis)).toBe(false);
      }
    }
  });

  it("webSiteLd has no potentialAction (Option B: removed until public /search exists)", () => {
    const schema = webSiteLd() as Record<string, unknown>;
    expect(schema.potentialAction).toBeUndefined();
  });
});
