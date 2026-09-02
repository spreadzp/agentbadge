import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@agentbadge/passport", async (importOriginal) => ({
  ...(await importOriginal()),
  marketUpsert: vi.fn(),
  marketGet: vi.fn(),
  listTasks: vi.fn(),
}));

vi.mock("@agentbadge/hedera-core", async (importOriginal) => ({
  ...(await importOriginal()),
}));

import { marketUpsert as upsert, marketGet as getTask, listTasks } from "@agentbadge/passport";
import demo from "../src/server/routes/demo";

describe("SLICE-11-4: Marketplace Task Setup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("POST /marketplace/seed creates medical analysis task in marketplace cache", async () => {
    const res = await demo.request("/marketplace/seed", { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.taskId).toMatch(/^task-medical-\d+$/);
    expect(body.task.title).toBe("Medical Data Analysis Service");
    expect(body.task.capabilities).toEqual(["medical-analysis"]);
    expect(body.task.priceHbar).toBe(100);
    expect(body.task.status).toBe("posted");
    expect(body.task.posterDid).toBe("did:hcs:0.0.0:3");
    expect(upsert).toHaveBeenCalledOnce();
  });

  it("GET /marketplace/tasks returns medical tasks filtered by capability", async () => {
    const mockTasks = [
      { taskId: "task-medical-1", capabilities: ["medical-analysis"], title: "Medical Data Analysis Service", status: "posted" },
      { taskId: "task-other-1", capabilities: ["other"], title: "Other Task", status: "posted" },
    ];
    vi.mocked(listTasks).mockReturnValue({ tasks: mockTasks as any, total: 2 });

    const res = await demo.request("/marketplace/tasks?capability=medical-analysis");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tasks).toHaveLength(1);
    expect(body.tasks[0].taskId).toBe("task-medical-1");
    expect(body.total).toBe(1);
  });

  it("GET /marketplace/tasks returns all medical tasks without filter", async () => {
    const mockTasks = [
      { taskId: "task-medical-1", capabilities: ["medical-analysis"], title: "Medical Data Analysis Service", status: "posted" },
      { taskId: "task-medical-2", capabilities: ["medical-analysis"], title: "Another Medical Task", status: "posted" },
    ];
    vi.mocked(listTasks).mockReturnValue({ tasks: mockTasks as any, total: 2 });

    const res = await demo.request("/marketplace/tasks");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tasks).toHaveLength(2);
    expect(body.total).toBe(2);
  });

  it("GET /marketplace/tasks/:taskId returns task by ID", async () => {
    const mockTask = {
      taskId: "task-medical-123",
      title: "Medical Data Analysis Service",
      capabilities: ["medical-analysis"],
      status: "posted",
      priceHbar: 100,
    };
    vi.mocked(getTask).mockReturnValue(mockTask as any);

    const res = await demo.request("/marketplace/tasks/task-medical-123");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.taskId).toBe("task-medical-123");
    expect(body.title).toBe("Medical Data Analysis Service");
  });

  it("GET /marketplace/tasks/:taskId returns 404 for unknown task", async () => {
    vi.mocked(getTask).mockReturnValue(undefined);

    const res = await demo.request("/marketplace/tasks/nonexistent");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Task not found");
  });

  it("seeded task has correct metadata matching SLICE-11-4 spec", async () => {
    const res = await demo.request("/marketplace/seed", { method: "POST" });
    const body = await res.json();
    expect(body.task.title).toBe("Medical Data Analysis Service");
    expect(body.task.description).toContain("vital signs");
    expect(body.task.description).toContain("lab results");
    expect(body.task.description).toContain("risk assessment");
    expect(body.task.priceHbar).toBe(100);
    expect(body.task.capabilities).toEqual(["medical-analysis"]);
  });
});
