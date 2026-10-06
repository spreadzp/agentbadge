import { Hono } from "hono";
import { registry } from "../metrics/metrics";
import { opsBearerAuth } from "../middleware/ops-auth";

const metricsApp = new Hono();

metricsApp.get("/metrics", opsBearerAuth(), async () => {
  const text = await registry.metrics();
  return new Response(text, {
    headers: {
      "Content-Type": registry.contentType,
    },
  });
});

export { metricsApp };
