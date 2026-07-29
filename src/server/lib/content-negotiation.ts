import type { Context } from "hono";

export type AcceptedFormat = "html" | "json" | "markdown";

export function getAcceptedFormat(c: Context): AcceptedFormat {
  const accept = c.req.header("Accept") ?? "";
  if (accept.includes("application/json")) return "json";
  if (accept.includes("text/markdown")) return "markdown";
  return "html";
}
