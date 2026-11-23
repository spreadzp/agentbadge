import { it } from "vitest";
process.env.MOCK_HEDERA = "true";
const { createApp } = await import("../src/server/index");
it("probe", async () => {
  const app = createApp();
  const t = await (await app.request("/llms-full.txt")).text();
  console.log("--- bstock ctx ---", t.slice(81200, 81560).replace(/\n/g, "|"));
  console.log("--- faq ctx ---", t.slice(86300, 86700).replace(/\n/g, "|"));
  const lines = t.split("\n");
  const idx = lines.findIndex(l => l.includes("bstock"));
  console.log("bstock line:", idx, "| total lines:", lines.length);
  lines.slice(Math.max(0, idx - 6), idx + 2).forEach((l, i) => console.log(idx - 6 + i, l.slice(0, 80)));
});
