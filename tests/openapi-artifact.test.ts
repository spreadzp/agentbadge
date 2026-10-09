/**
 * SLICE-182-6: openapi.yaml artifact contract tests.
 *
 * - committed openapi/openapi.yaml parses and matches generator output
 *   (drift check reproducible locally — same code path as
 *   `bun run check:openapi` / CI);
 * - spec exposes the X402 402-contract components the buyer-side
 *   validateAccepts (packages/circle-payments) validates against;
 * - gated-route 402 shape contract: scheme enum, CAIP-2 network, atomic
 *   amount string, extra.decimals literal 6.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parse as parseYaml, stringify as yamlStringify } from "yaml";
import { createApp } from "../src/server/index";

const OUT = "openapi/openapi.yaml";

describe("openapi artifact", () => {
  it("committed openapi.yaml is valid YAML and matches generator output", async () => {
    const committed = readFileSync(OUT, "utf-8");
    const doc = parseYaml(committed);
    expect(doc.openapi).toBe("3.1.0");

    const app = createApp();
    const res = await app.request("/openapi.json");
    expect(res.status).toBe(200);
    const fresh = await res.json();
    // Compare parsed docs — header comment lines differ only in text.
    // servers[] is env-dependent (BASE_URL): pinned to the canonical URL
    // by gen-openapi.ts, so strip it before comparing.
    delete doc.servers;
    delete fresh.servers;
    expect(doc).toEqual(parseYaml(yamlStringify(fresh)));
  });

  it("exposes X402 contract components", () => {
    const doc = parseYaml(readFileSync(OUT, "utf-8"));
    const schemas = doc.components?.schemas ?? {};
    const req = schemas.X402PaymentRequired;
    const reqEntry = schemas.X402PaymentRequirement;
    const refusal = schemas.X402HonestRefusal;

    expect(req).toBeDefined();
    expect(req.properties.x402Version.const).toBe(2);
    // zod inlines the nested entry schema — contract: same fields inline.
    const items = req.properties.accepts.items;
    expect(items.properties.scheme.enum).toContain("exact");
    expect(items.properties.network).toBeDefined();
    expect(items.properties.extra.properties.decimals.const).toBe(6);

    expect(reqEntry).toBeDefined();
    const props = reqEntry.properties;
    for (const f of [
      "scheme",
      "network",
      "asset",
      "amount",
      "payTo",
    ]) {
      expect(props[f], `missing ${f}`).toBeDefined();
    }
    expect(props.scheme.enum).toEqual(
      expect.arrayContaining([
        "exact",
        "eip3009-client-broadcast",
        "gateway-batch",
      ]),
    );
    // decimals contract: literal 6 — clients refuse anything else.
    expect(props.extra.properties.decimals.const).toBe(6);

    expect(refusal).toBeDefined();
    expect(refusal.properties.charged.const).toBe(false);
  });
});
