/**
 * SLICE-255-4: crypto/evidence track — credential.json (6) +
 * evidence.json (3) against our §5.6/§7 canonicalizer + Ed25519.
 *
 * Honesty rule (slice §2): PASS means "our test-lib canonicalizer
 * reproduces the spec byte-for-byte" — prod Ed25519/evidence-chain
 * mechanism does not exist (production_path = test-lib, dims None).
 */
import { describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadCorpus, corpusSha256 } from "./lib/corpus";
import {
  field,
  canonAmount,
  canonNumber,
  evidencePayload,
  boundsPayload,
  credentialPayload,
  GENESIS,
} from "./lib/mmf-canon";
import {
  runCredentialVector,
  runEvidenceVector,
  verifyCredential,
} from "./lib/crypto-harness";
import {
  writeTrackResults,
  summarize,
  RESULT_SCHEMA_VERSION,
  type VectorResult,
} from "./lib/result";

const corpus = loadCorpus();
const sha = corpusSha256();

/* ------------------------- canonicalizer units -------------------------- */

describe("§5.6 canonical fields", () => {
  it("field(): utf8-byte-length prefix, empty→0:", () => {
    expect(field("t1")).toBe("2:t1");
    expect(field("café.example")).toBe("13:café.example"); // é = 2 bytes
    expect(field("")).toBe("0:");
    expect(field(null)).toBe("0:");
    expect(field(undefined)).toBe("0:");
  });

  it("canonNumber / canonAmount edge cases", () => {
    expect(canonNumber(1700000000)).toBe("1700000000");
    expect(canonAmount(4999)).toBe("4999");
    expect(canonAmount(0)).toBe("invalid");
    expect(canonAmount(-7)).toBe("invalid");
    expect(canonAmount(null)).toBe("invalid"); // E02: null → invalid
    expect(canonAmount(49.99)).toBe("invalid");
    expect(canonAmount(2 ** 53)).toBe("invalid");
    expect(canonAmount(2 ** 53 - 1)).toBe(String(2 ** 53 - 1));
    expect(canonAmount("10")).toBe("invalid");
  });

  it("timestamp → epoch ms (floor(t×1000+0.5))", () => {
    const r = (t: number) =>
      evidencePayload({ timestamp: t }, GENESIS).split("|")[11];
    expect(r(1000)).toBe("7:1000000");
    expect(r(1730000000.25)).toBe("13:1730000000250");
    expect(r(1000.5)).toBe("7:1000500");
  });
});

describe("§7 payloads", () => {
  const inputs = corpus.credential[0].inputs as never;
  it("bounds payload matches C01 pinned hex", () => {
    const hex = Buffer.from(boundsPayload(inputs)).toString("hex");
    expect(hex).toBe(
      (corpus.credential[0].expected as { bounds_payload_hex: string })
        .bounds_payload_hex,
    );
  });
  it("signed payload matches C01 pinned hex", () => {
    const b = boundsPayload(inputs);
    const hex = Buffer.from(
      credentialPayload(inputs, "e36b67c582352d6e1244eed5fa0f783a019959154f0cb15aca976cde9c6de2c1"),
    ).toString("hex");
    expect(b).toContain("10:alice@corp|10:1700000000|0:|5:50000|3:GBP|22:amazon.co.uk,tesco.com");
    expect(hex).toBe(
      (corpus.credential[0].expected as { payload_hex: string }).payload_hex,
    );
  });
});

describe("verifyCredential check coverage", () => {
  const c01 = corpus.credential[0];
  const good = {
    mandate_id: "m-root",
    agent: "procurement-bot",
    bounds_hash: "e36b67c582352d6e1244eed5fa0f783a019959154f0cb15aca976cde9c6de2c1",
    expires_at: 1702592000,
    signature:
      "18d1eb221edf899c17e10a219d6f9e83c57fc18b4e4478bc9936413f77414828f5749c0d0af1da30069957dd62c28d42e7252b38fd1e583ed19a985676b8fd08",
    public_key: c01.public_key_hex!,
  };
  it("accepts the pinned valid credential", () => {
    const r = verifyCredential(good, c01.inputs as never, c01.public_key_hex!);
    expect(r).toEqual({ ok: true, failed: [] });
  });
  it("flags each broken binding separately", () => {
    const r = verifyCredential(
      { ...good, agent: "other-bot" },
      c01.inputs as never,
      c01.public_key_hex!,
    );
    expect(r.failed).toContain("signature");
    expect(r.failed).toContain("agent_binding");
  });
});

/* ------------------------------- vectors -------------------------------- */

describe("crypto/evidence track run", () => {
  it("6 credential vectors produce unified results", async () => {
    const results: VectorResult[] = corpus.credential.map((v) =>
      runCredentialVector(v, sha.credential),
    );
    expect(results).toHaveLength(6);
    for (const r of results) {
      expect(r.schema_version).toBe(RESULT_SCHEMA_VERSION);
      expect(r.corpus_sha256).toBe(sha.credential);
      expect(r.track).toBe("crypto");
      expect(r.production_path).toContain("mmf-canon");
    }
    const byId = Object.fromEntries(results.map((r) => [r.vector_id, r]));
    expect(byId["C01"].result).toBe("PASS"); // byte-exact repro incl. signature
    for (const id of ["C02", "C03", "C04", "C05", "C06"]) {
      expect(byId[id].result).toBe("PASS");
      expect(byId[id].actual.valid).toBe(false);
    }
  });

  it("3 evidence vectors: payloads + hashes + chain head byte-exact", async () => {
    const results: VectorResult[] = corpus.evidence.vectors.map((v) =>
      runEvidenceVector(v, sha.evidence),
    );
    expect(results).toHaveLength(3);
    for (const r of results) {
      expect(r.result).toBe("PASS");
      expect((r.actual as { head: string }).head).toBe(
        (r.expected as { head: string }).head,
      );
    }
  });

  it("writes results/crypto.json (metric separate from spend)", async () => {
    const results: VectorResult[] = [
      ...corpus.credential.map((v) => runCredentialVector(v, sha.credential)),
      ...corpus.evidence.vectors.map((v) =>
        runEvidenceVector(v, sha.evidence),
      ),
    ];
    const out = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "results",
      "crypto.json",
    );
    writeTrackResults(results, out);
    const sums = summarize(results);
    expect(Object.values(sums).reduce((a, b) => a + b, 0)).toBe(9);
    expect(results.filter((r) => r.result === "HARNESS_ERROR")).toHaveLength(0);
  });
});
