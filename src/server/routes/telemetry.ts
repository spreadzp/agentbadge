import { Hono } from "hono";

const telemetryApp = new Hono();

telemetryApp.post("/api/telemetry/cli", async (c) => {
  try {
    const body = await c.req.json();
    if (!body || typeof body !== "object") {
      return c.json({ error: "Invalid body" }, 400);
    }
    return c.json({ ok: true }, 200);
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }
});

export { telemetryApp };
