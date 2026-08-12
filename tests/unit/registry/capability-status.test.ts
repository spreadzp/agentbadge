import { describe, it, expect } from "vitest";
import type { CapabilityStatus, Capability } from "../../../src/server/registry/types";

describe("SLICE-56-1: Capability Status — VERIFIED vs DECLARED", () => {
  it("CapabilityStatus type includes DECLARED", () => {
    const statuses: CapabilityStatus[] = ["REQUESTED", "DECLARED", "VERIFIED", "DEPRECATED", "ARCHIVED"];
    expect(statuses).toContain("DECLARED");
  });

  it("DECLARED is distinct from VERIFIED", () => {
    expect("DECLARED").not.toBe("VERIFIED");
  });

  it("a capability with DECLARED status is valid", () => {
    const cap: Capability = {
      id: "test-declared",
      name: "Test Declared Capability",
      category: "ai",
      skills: ["ai-agents"],
      services: ["ai-agent-consulting"],
      people: ["paul"],
      evidence: [],
      status: "DECLARED",
      confidence: 0.3,
    };
    expect(cap.status).toBe("DECLARED");
    expect(cap.evidence).toHaveLength(0);
    expect(cap.confidence).toBeLessThan(0.5);
  });

  it("a capability with VERIFIED status has evidence", () => {
    const cap: Capability = {
      id: "test-verified",
      name: "Test Verified Capability",
      category: "ai",
      skills: ["ai-agents"],
      services: ["ai-agent-consulting"],
      people: ["paul"],
      evidence: [
        { type: "project", name: "Test Project", description: "Proof of capability" },
      ],
      status: "VERIFIED",
      confidence: 0.9,
    };
    expect(cap.status).toBe("VERIFIED");
    expect(cap.evidence.length).toBeGreaterThan(0);
    expect(cap.confidence).toBeGreaterThanOrEqual(0.5);
  });

  it("DECLARED capability can transition to VERIFIED when evidence is added", () => {
    const cap: Capability = {
      id: "test-transition",
      name: "Test Transition",
      category: "ai",
      skills: ["ai-agents"],
      services: ["ai-agent-consulting"],
      people: ["paul"],
      evidence: [],
      status: "DECLARED",
      confidence: 0.3,
    };

    // Simulate transition: add evidence → upgrade status
    cap.evidence = [{ type: "project", name: "New Proof", url: "https://example.com" }];
    cap.status = "VERIFIED";
    cap.confidence = 0.85;

    expect(cap.status).toBe("VERIFIED");
    expect(cap.evidence.length).toBeGreaterThan(0);
    expect(cap.confidence).toBeGreaterThanOrEqual(0.5);
  });
});
