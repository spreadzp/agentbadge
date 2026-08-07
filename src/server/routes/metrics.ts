import { Hono } from "hono";
import { registry } from "../metrics/metrics";

const metricsApp = new Hono();

metricsApp.get("/metrics", async (c) => {
  const text = await registry.metrics();
  return new Response(text, {
    headers: {
      "Content-Type": registry.contentType,
    },
  });
});

export { metricsApp };
