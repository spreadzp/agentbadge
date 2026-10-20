import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { hackathonRoutes } from "../../src/server/routes/hackathon";

function makeApp() {
  const app = new Hono();
  app.route("/", hackathonRoutes);
  return app;
}

describe("FX Delta hackathon page", () => {
  it("GET /hackathon/fxdelta returns 200", async () => {
    const res = await makeApp().request("/hackathon/fxdelta");
    expect(res.status).toBe(200);
  });

  it("page contains hero, architecture, how it works and FAQ", async () => {
    const html = await (await makeApp().request("/hackathon/fxdelta")).text();
    expect(html).toContain("FX Delta");
    expect(html).toContain("Architecture");
    expect(html).toContain("How it works");
    expect(html).toContain("FAQ");
  });

  it("page renders the animated SVG architecture diagram", async () => {
    const html = await (await makeApp().request("/hackathon/fxdelta")).text();
    expect(html).toContain("dash-flow");
    expect(html).toContain('viewBox="0 0 900 400"');
  });

  it("page lists the fx-delta API endpoints", async () => {
    const html = await (await makeApp().request("/hackathon/fxdelta")).text();
    expect(html).toContain("/api/fx-delta/premium");
    expect(html).toContain("/api/fx-delta/health");
  });

  it("page links the verified Celo mainnet settle transaction", async () => {
    const html = await (await makeApp().request("/hackathon/fxdelta")).text();
    expect(html).toContain(
      "celo.blockscout.com/tx/0x7f292710b92b0684b272872d9829899c3a5dcf83819df98908b1bd391355b6b2",
    );
    expect(html).toContain("42220");
  });

  it("page does not mention Celo Sepolia", async () => {
    const html = await (await makeApp().request("/hackathon/fxdelta")).text();
    expect(html.toLowerCase()).not.toContain("sepolia");
  });

  it("unknown hackathon still returns 404", async () => {
    const res = await makeApp().request("/hackathon/no-such-page");
    expect(res.status).toBe(404);
  });
});
