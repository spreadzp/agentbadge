import { describe, it, expect, beforeAll } from "vitest";
import { Hono } from "hono";
import { wellKnownRoutes } from "../src/server/routes/well-known";

describe("skill.md", () => {
  let app: Hono;

  beforeAll(() => {
    app = new Hono();
    app.route("/", wellKnownRoutes);
  });

  it("serves /skill.md with 200", async () => {
    const res = await app.request("/skill.md");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/markdown");
    const body = await res.text();
    expect(body).toContain("---"); // YAML frontmatter
  });

  it("has valid YAML frontmatter with name and description", async () => {
    const res = await app.request("/skill.md");
    const body = await res.text();

    expect(body).toMatch(/^---/);
    expect(body).toMatch(/name:\s+\S+/);
    expect(body).toMatch(/description:\s+.+/);
  });
});
