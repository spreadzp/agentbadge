/**
 * SLICE-178-7 (MYPROJ-2587): did:web platform identity + signed DID
 * Configuration (DIF) + real JWKS — Arc-era replacement for the broken
 * unsigned did.json / stub jwks / did:hcs-only resolver.
 *
 * Key role: DID_SIGNING_KEY (Ed25519 PKCS8 base64) — distinct from
 * money/verdict keys (authority-split, EPIC-173).
 */
import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import {
  generateKeyPair,
  exportPKCS8,
  exportJWK,
  jwtVerify,
  createLocalJWKSet,
  decodeJwt,
} from "jose";
import { createDiscoveryRoutes } from "../src/server/routes/discovery";
import { identityRoutes } from "../src/server/routes/well-known/identity";
import { metaRoutes } from "../src/server/routes/meta";
import { didRoutes } from "../src/server/routes/did";
import { collectSources } from "../src/server/lib/agent-discovery";

const DID = "did:web:agentbadge.xyz";
const VM_ID = `${DID}#key-1`;

async function makeKey(): Promise<string> {
  const { privateKey } = await generateKeyPair("Ed25519", {
    extractable: true,
  });
  return await exportPKCS8(privateKey); // PEM
}

/** App slice carrying the DID surface: manifests + identity + meta + resolver. */
function makeDidApp(): Hono {
  const app = new Hono();
  app.route("/", createDiscoveryRoutes(() => collectSources()));
  app.route("/", identityRoutes);
  app.route("/", metaRoutes);
  app.route("/", didRoutes);
  return app;
}

describe("SLICE-178-7: did:web identity", () => {
  it("no DID_SIGNING_KEY → honest 404 on did.json + did-configuration.json", async () => {
    delete process.env.DID_SIGNING_KEY;
    const app = makeDidApp();
    expect((await app.request("/.well-known/did.json")).status).toBe(404);
    expect(
      (await app.request("/.well-known/did-configuration.json")).status,
    ).toBe(404);
  });

  it("did.json → valid did:web document (vm OKP/Ed25519, service[], Arc alsoKnownAs)", async () => {
    process.env.DID_SIGNING_KEY = await makeKey();
    const res = await makeDidApp().request("/.well-known/did.json");
    expect(res.status).toBe(200);
    const doc = (await res.json()) as {
      id: string;
      verificationMethod?: Array<{
        id: string;
        type: string;
        controller: string;
        publicKeyJwk: { kty: string; crv: string; x: string; kid?: string };
      }>;
      assertionMethod?: string[];
      authentication?: string[];
      alsoKnownAs?: string[];
      service?: Array<{ id: string; type: string; serviceEndpoint: string }>;
    };
    expect(doc.id).toBe(DID);

    const vm = doc.verificationMethod?.[0];
    expect(vm?.type).toBe("JsonWebKey");
    expect(vm?.controller).toBe(DID);
    expect(vm?.publicKeyJwk.kty).toBe("OKP");
    expect(vm?.publicKeyJwk.crv).toBe("Ed25519");
    expect(vm?.publicKeyJwk.x).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(doc.assertionMethod).toContain(VM_ID);
    expect(doc.authentication).toContain(VM_ID);

    // Arc ERC-8004 reference — chain-agnostic anchor is the domain itself.
    // EPIC-194-1: follows ERC8004_CHAIN_ID, decoupled from ARC_CHAIN_ID
    // (payments chain may legitimately be testnet — prod bug: did.json
    // served eip155:5042002).
    const chainId = process.env.ERC8004_CHAIN_ID ?? "5042";
    expect(
      doc.alsoKnownAs?.some((u) => u.startsWith(`eip155:${chainId}:`)),
    ).toBe(true);

    // service[] must expose agent-facing endpoints
    const types = (doc.service ?? []).map((s) => s.type);
    expect(types).toContain("A2A");
    expect(types).toContain("MCP");

    // AC5: no legacy non-Arc DIDs anywhere in the document
    const raw = JSON.stringify(doc);
    expect(raw).not.toContain("did:hcs");
    expect(raw).not.toContain("did:eip155");
  });

  it("did.json → ERC-8004 anchor ignores ARC_CHAIN_ID (testnet payments chain)", async () => {
    // EPIC-194-1 regression: prod had ARC_CHAIN_ID=5042002 (testnet
    // payments chain) and did.json served eip155:5042002 — wrong anchor.
    process.env.DID_SIGNING_KEY = await makeKey();
    const prevArc = process.env.ARC_CHAIN_ID;
    const prev8004 = process.env.ERC8004_CHAIN_ID;
    process.env.ARC_CHAIN_ID = "5042002";
    delete process.env.ERC8004_CHAIN_ID;
    try {
      const doc = (await (
        await makeDidApp().request("/.well-known/did.json")
      ).json()) as { alsoKnownAs?: string[] };
      expect(
        doc.alsoKnownAs?.some((u) => u.startsWith("eip155:5042:")),
      ).toBe(true);
      expect(
        doc.alsoKnownAs?.some((u) => u.startsWith("eip155:5042002:")),
      ).toBe(false);
    } finally {
      if (prevArc === undefined) delete process.env.ARC_CHAIN_ID;
      else process.env.ARC_CHAIN_ID = prevArc;
      if (prev8004 === undefined) delete process.env.ERC8004_CHAIN_ID;
      else process.env.ERC8004_CHAIN_ID = prev8004;
    }
  });

  it("did-configuration.json → VC-JWT verifies against the DID document key", async () => {
    process.env.DID_SIGNING_KEY = await makeKey();
    const app = makeDidApp();

    const doc = (await (
      await app.request("/.well-known/did.json")
    ).json()) as {
      verificationMethod: Array<{ publicKeyJwk: JsonWebKey }>;
    };
    const cfg = (await (
      await app.request("/.well-known/did-configuration.json")
    ).json()) as { linked_dids: string[] };

    expect(cfg.linked_dids).toHaveLength(1);
    const jwt = cfg.linked_dids[0];

    // AC6: verify via jose createLocalJWKSet keyed by the DID document's key —
    // served publicKeyJwk already carries kid = vmId, no injection needed
    const jwks = createLocalJWKSet({
      keys: [doc.verificationMethod[0].publicKeyJwk],
    });
    const { payload } = await jwtVerify(jwt, jwks);
    expect(payload.iss).toBe(DID);
    expect(payload.sub).toBe(DID);
    const vc = payload.vc as {
      type: string[];
      credentialSubject: { id: string; origin: string };
    };
    expect(vc.type).toContain("DomainLinkageCredential");
    expect(vc.credentialSubject.id).toBe(DID);
    expect(vc.credentialSubject.origin).toBe("https://agentbadge.xyz");

    // iss/sub/origin also visible without verification (decode path)
    expect(decodeJwt(jwt).iss).toBe(DID);
  });

  it("did-configuration.json works with raw base64 DID_SIGNING_KEY (gen-did-key output format)", async () => {
    // Regression: gen-did-key.ts emits single-line base64, not PEM —
    // importPKCS8 must still get valid armor (prod 500ed on this).
    const pem = await makeKey();
    process.env.DID_SIGNING_KEY = pem
      .replace(/-----[A-Z ]+-----/g, "")
      .replace(/\s+/g, "");
    const app = makeDidApp();

    const res = await app.request("/.well-known/did-configuration.json");
    expect(res.status).toBe(200);
    const cfg = (await res.json()) as { linked_dids: string[] };
    expect(cfg.linked_dids).toHaveLength(1);
    expect(decodeJwt(cfg.linked_dids[0]).iss).toBe(DID);
  });

  it("GET /did/did:web:agentbadge.xyz → self-resolution (same document)", async () => {
    process.env.DID_SIGNING_KEY = await makeKey();
    const app = makeDidApp();
    const res = await app.request(`/did/${DID}`);
    expect(res.status).toBe(200);
    const doc = (await res.json()) as { id: string };
    expect(doc.id).toBe(DID);
  });

  it("GET /did/<unknown> → 400 invalid format (legacy did:hcs path preserved)", async () => {
    const res = await makeDidApp().request("/did/did:example:nope");
    expect(res.status).toBe(400);
  });

  it("jwks.json → real Ed25519 pubkey identical to the DID document", async () => {
    process.env.DID_SIGNING_KEY = await makeKey();
    const app = makeDidApp();
    const [jwksRes, didRes] = await Promise.all([
      app.request("/.well-known/jwks.json"),
      app.request("/.well-known/did.json"),
    ]);
    expect(jwksRes.status).toBe(200);
    const jwks = (await jwksRes.json()) as {
      keys: Array<{ kty: string; crv: string; x: string; kid: string }>;
    };
    const key = jwks.keys[0];
    expect(key.kty).toBe("OKP");
    expect(key.crv).toBe("Ed25519");
    expect(key.x).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const doc = (await didRes.json()) as {
      verificationMethod: Array<{ publicKeyJwk: { x: string } }>;
    };
    expect(doc.verificationMethod[0].publicKeyJwk.x).toBe(key.x);
  });

  it("jwks.json without DID_SIGNING_KEY → empty key set (honest absence)", async () => {
    delete process.env.DID_SIGNING_KEY;
    const jwks = (await (
      await makeDidApp().request("/.well-known/jwks.json")
    ).json()) as { keys: unknown[] };
    expect(jwks.keys).toEqual([]);
  });
});

describe("SLICE-178-7: key plumbing", () => {
  it("collectSources derives publicKeyJwk + enables did flag from DID_SIGNING_KEY", async () => {
    const { privateKey } = await generateKeyPair("Ed25519", {
      extractable: true,
    });
    const pem = await exportPKCS8(privateKey);
    process.env.DID_SIGNING_KEY = pem;
    const src = collectSources();
    expect(src.didEnabled).toBe(true);
    const jwk = src.didKey?.publicJwk;
    expect(jwk?.kty).toBe("OKP");
    expect(jwk?.crv).toBe("Ed25519");
    // Cross-check against jose's own export — same pubkey
    const imported = await import("jose").then((m) =>
      m.importPKCS8(pem, "EdDSA", { extractable: true }),
    );
    const expected = await exportJWK(imported);
    expect(jwk?.x).toBe(expected.x);
  });

  it("garbage DID_SIGNING_KEY → didEnabled false, no throw", () => {
    process.env.DID_SIGNING_KEY = "not-a-pkcs8";
    const src = collectSources();
    expect(src.didEnabled).toBe(false);
    expect(src.didKey).toBeUndefined();
    delete process.env.DID_SIGNING_KEY;
  });
});

describe("SLICE-194-7 audit regressions", () => {
  // C-1: WebFinger must not reflect arbitrary ?resource= as subject under our
  // domain authority. Only our own did:web, HCS agent DIDs, our baseUrl, or
  // acct:agentbadge@<host> resolve; everything else is a clean 404.
  it("webfinger: foreign DID / arbitrary subject → 404", async () => {
    const app = makeDidApp();
    for (const r of [
      "did:ion:EiCsiAttacker",
      "did:web:evil.example.com",
      "did:pkh:eip155:1:0x000000000000000000000000000000000000dead",
      "https://evil.example.com/steal",
      "acct:victim@bank.example",
      "../../etc/passwd",
    ]) {
      const res = await app.request(
        `/.well-known/webfinger?resource=${encodeURIComponent(r)}`,
      );
      expect(res.status, `resource=${r}`).toBe(404);
    }
  });

  it("webfinger: own did:web + did:hcs + acct + baseUrl → 200 JRD", async () => {
    const app = makeDidApp();
    for (const r of [
      "did:web:agentbadge.xyz",
      "did:hcs:testnet_0.0.1234",
      "acct:agentbadge@agentbadge.xyz",
      "https://agentbadge.xyz",
      "https://agentbadge.xyz/",
    ]) {
      const res = await app.request(
        `/.well-known/webfinger?resource=${encodeURIComponent(r)}`,
      );
      expect(res.status, `resource=${r}`).toBe(200);
      const jrd = (await res.json()) as { subject: string };
      expect(jrd.subject).toBe(r);
    }
  });

  // H-1/H-2: ERC-8004 env normalization at the impure edge.
  it("collectSources: junk ERC8004_CHAIN_ID → 5042 fallback", () => {
    const prev = process.env.ERC8004_CHAIN_ID;
    process.env.ERC8004_CHAIN_ID = "garbage";
    try {
      const src = collectSources();
      expect(src.wellKnownEnv?.erc8004.chainId).toBe(5042);
    } finally {
      if (prev === undefined) delete process.env.ERC8004_CHAIN_ID;
      else process.env.ERC8004_CHAIN_ID = prev;
    }
  });

  it("collectSources: ' 0' / '00' / junk ERC8004_AGENT_ID → '' (honest absence)", () => {
    const prev = process.env.ERC8004_AGENT_ID;
    try {
      for (const bad of [" 0", "00", "0\n", "abc", "0x0"]) {
        process.env.ERC8004_AGENT_ID = bad;
        const src = collectSources();
        expect(src.wellKnownEnv?.erc8004.agentId, `agentId="${bad}"`).toBe("");
      }
      process.env.ERC8004_AGENT_ID = "007";
      expect(collectSources().wellKnownEnv?.erc8004.agentId).toBe("7");
    } finally {
      if (prev === undefined) delete process.env.ERC8004_AGENT_ID;
      else process.env.ERC8004_AGENT_ID = prev;
    }
  });

  // H-3: did.json never claims agentId 0 — agent-scoped eip155 ref only
  // appears when a real registration exists.
  it("did.json: absent agentId → alsoKnownAs has registry only, no ':0' tail", async () => {
    process.env.DID_SIGNING_KEY = await makeKey();
    const prev = process.env.ERC8004_AGENT_ID;
    delete process.env.ERC8004_AGENT_ID;
    try {
      const doc = (await (
        await makeDidApp().request("/.well-known/did.json")
      ).json()) as { alsoKnownAs?: string[] };
      const aka = doc.alsoKnownAs ?? [];
      expect(aka.some((u) => /eip155:\d+:0x[0-9a-fA-F]+$/.test(u))).toBe(true);
      expect(aka.some((u) => /eip155:\d+:0x[0-9a-fA-F]+:\d+$/.test(u))).toBe(
        false,
      );
      expect(JSON.stringify(aka)).not.toContain(":0\"");
    } finally {
      if (prev === undefined) delete process.env.ERC8004_AGENT_ID;
      else process.env.ERC8004_AGENT_ID = prev;
    }
  });
});
