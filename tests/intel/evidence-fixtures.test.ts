// EPIC-262 (SLICE-262-1): committed contract artifacts under spec/ —
// positive fixtures for all 4 provenance classes verify end-to-end,
// negative fixtures reject with the expected error class, and both JSON
// Schemas stay in sync with the zod source of truth.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import {
  canonicalEnvelopeSchema,
  collectorSubmissionSchema,
  verifyEnvelope,
} from "../../src/server/lib/intel/evidence";
import {
  buildPositiveFixtures,
  buildNegativeFixtures,
  FIXTURE_KEY,
} from "../../src/scripts/intel-fixture-builder";

const SPEC = join(
  __dirname,
  "../../docs/EPICS/262-agent-surface-intelligence/spec",
);
const readJson = (rel: string) => JSON.parse(readFileSync(join(SPEC, rel), "utf8"));

describe("committed envelope fixtures — all 4 provenance classes (AC #4)", () => {
  const files = readdirSync(join(SPEC, "fixtures/envelopes")).filter((f) =>
    f.endsWith(".json"),
  );

  it("covers every provenance class", () => {
    const provenances = files.map((f) => readJson(`fixtures/envelopes/${f}`).provenance);
    for (const p of [
      "EXTERNAL_OBSERVED",
      "PLUGIN_SELF_REPORTED",
      "BACKEND_VERIFIED",
      "DERIVED",
    ]) {
      expect(provenances).toContain(p);
    }
  });

  it.each(files)("%s passes schema + signature verification", (file) => {
    const env = readJson(`fixtures/envelopes/${file}`);
    expect(canonicalEnvelopeSchema.safeParse(env).success).toBe(true);
    expect(verifyEnvelope(env, [FIXTURE_KEY]).ok).toBe(true);
  });

  it("fixtures are byte-identical to fresh generation (deterministic)", () => {
    for (const f of buildPositiveFixtures()) {
      expect(readJson(`fixtures/envelopes/${f.file}`)).toEqual(f.envelope);
    }
  });
});

describe("committed negative fixtures reject as declared (AC #5)", () => {
  const files = readdirSync(join(SPEC, "fixtures/negative")).filter((f) =>
    f.endsWith(".json"),
  );
  const expected = new Map(buildNegativeFixtures().map((f) => [f.file, f]));

  it("covers the required negative classes", () => {
    const names = files.join(" ");
    for (const needle of [
      "spoofed-provenance",
      "unknown-payload-type",
      "invalid-refs",
      "invalid-signature",
      "unknown-key-id",
      "unknown-schema-version",
      "derived-without-from",
    ]) {
      expect(names).toContain(needle);
    }
  });

  it.each(files)("%s rejects with its declared error class", (file) => {
    const { expected_error, document } = readJson(`fixtures/negative/${file}`);
    const fixture = expected.get(file);
    expect(fixture).toBeDefined();
    expect(fixture!.expected_error).toBe(expected_error);

    if (fixture!.kind === "submission") {
      expect(collectorSubmissionSchema.safeParse(document).success).toBe(false);
    } else {
      const res = verifyEnvelope(document, [FIXTURE_KEY]);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toBe(expected_error);
    }
  });

  it("negative fixtures are byte-identical to fresh generation", () => {
    for (const f of buildNegativeFixtures()) {
      expect(readJson(`fixtures/negative/${f.file}`)).toEqual({
        expected_error: f.expected_error,
        document: f.document,
      });
    }
  });
});

describe("committed JSON Schemas match the zod source of truth", () => {
  it.each(["collector-submission", "canonical-envelope"])("%s", (name) => {
    const committed = readJson(`schemas/${name}.schema.json`);
    const zodSchema =
      name === "collector-submission" ? collectorSubmissionSchema : canonicalEnvelopeSchema;
    expect(committed).toEqual({
      $id: `https://agentbadge.xyz/schemas/intel/${name}/v1`,
      title: committed.title,
      ...z.toJSONSchema(zodSchema, { target: "draft-2020-12" }),
    });
  });
});
