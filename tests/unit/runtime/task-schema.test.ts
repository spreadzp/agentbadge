import { describe, it, expect } from "vitest";
import {
  validateTaskDefinition,
  type TaskDefinition,
  type TaskCategory,
} from "../../../src/agent-readiness/runtime/task-schema";

describe("SLICE-98-2: TaskDefinition schema", () => {
  it("accepts a valid task definition", () => {
    const task: TaskDefinition = {
      task_id: "RT-01",
      name: "Discover agent entry points",
      category: "discover",
      steps: [{ action: "GET /llms.txt", phase: "discover" }],
      preconditions: [],
      safety: { mode: "read_only", auth_required: false },
      budget: { max_requests: 5, max_steps: 10, timeout_ms: 15000 },
    };
    expect(() => validateTaskDefinition(task)).not.toThrow();
  });

  it("rejects unknown category", () => {
    const task = {
      task_id: "RT-X",
      name: "Bad",
      category: "explore",
      steps: [],
      safety: { mode: "read_only", auth_required: false },
      budget: { max_requests: 1, max_steps: 1, timeout_ms: 1000 },
    };
    expect(() => validateTaskDefinition(task as unknown as TaskDefinition)).toThrow(
      /category/i,
    );
  });

  it("rejects missing task_id", () => {
    const task = {
      name: "No ID",
      category: "discover",
      steps: [],
      safety: { mode: "read_only", auth_required: false },
      budget: { max_requests: 1, max_steps: 1, timeout_ms: 1000 },
    };
    expect(() => validateTaskDefinition(task as unknown as TaskDefinition)).toThrow(
      /task_id/i,
    );
  });

  it("rejects invalid safety mode", () => {
    const task = {
      task_id: "RT-X",
      name: "Bad mode",
      category: "discover",
      steps: [],
      safety: { mode: "dangerous", auth_required: false },
      budget: { max_requests: 1, max_steps: 1, timeout_ms: 1000 },
    };
    expect(() => validateTaskDefinition(task as unknown as TaskDefinition)).toThrow(
      /mode/i,
    );
  });

  it("rejects budget with max_requests <= 0", () => {
    const task: TaskDefinition = {
      task_id: "RT-X",
      name: "Bad budget",
      category: "discover",
      steps: [],
      safety: { mode: "read_only", auth_required: false },
      budget: { max_requests: 0, max_steps: 1, timeout_ms: 1000 },
    };
    expect(() => validateTaskDefinition(task)).toThrow(/max_requests/i);
  });

  it("rejects budget with max_steps <= 0", () => {
    const task: TaskDefinition = {
      task_id: "RT-X",
      name: "Bad budget",
      category: "discover",
      steps: [],
      safety: { mode: "read_only", auth_required: false },
      budget: { max_requests: 1, max_steps: 0, timeout_ms: 1000 },
    };
    expect(() => validateTaskDefinition(task)).toThrow(/max_steps/i);
  });

  it("rejects budget with timeout_ms <= 0", () => {
    const task: TaskDefinition = {
      task_id: "RT-X",
      name: "Bad budget",
      category: "discover",
      steps: [],
      safety: { mode: "read_only", auth_required: false },
      budget: { max_requests: 1, max_steps: 1, timeout_ms: 0 },
    };
    expect(() => validateTaskDefinition(task)).toThrow(/timeout_ms/i);
  });

  it("accepts all 8 valid categories", () => {
    const categories: TaskCategory[] = [
      "discover",
      "docs",
      "auth",
      "construct",
      "call",
      "handle",
      "observe",
      "version",
    ];
    for (const category of categories) {
      const task: TaskDefinition = {
        task_id: `RT-${category}`,
        name: `Test ${category}`,
        category,
        steps: [],
        safety: { mode: "read_only", auth_required: false },
        budget: { max_requests: 1, max_steps: 1, timeout_ms: 1000 },
      };
      expect(() => validateTaskDefinition(task), `category ${category}`).not.toThrow();
    }
  });
});
