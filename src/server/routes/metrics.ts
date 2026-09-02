import { Hono } from "hono";
import { timingSafeEqual } from "node:crypto";
import { registry } from "../metrics/metrics";

const metricsApp = new Hono();

function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

metricsApp.get("/metrics", async (c) => {
  const token = process.env.METRICS_BEARER_TOKEN;
  if (!token) {
    return c.json({ error: "METRICS_BEARER_TOKEN not configured" }, 500);
  }
  const authHeader = c.req.header("Authorization");
  const bearer = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!bearer || !safeCompare(bearer, token)) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const text = await registry.metrics();
  return new Response(text, {
    headers: {
      "Content-Type": registry.contentType,
    },
  });
});

export { metricsApp };
