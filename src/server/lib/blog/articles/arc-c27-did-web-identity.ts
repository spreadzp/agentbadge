import type { BlogArticle } from "../../blog-data";

export const article: BlogArticle = {
  slug: "arc-c27-did-web-identity",
  title: "Who Are You, Agent? A DID Your Domain Can Prove — on Arc",
  description:
    "AgentBadge now has a real platform identity: did:web:agentbadge.xyz — a W3C DID anchored to our domain, a signed DID Configuration (VC-JWT DomainLinkageCredential) any client can verify with ~20 lines of jose, and a real Ed25519 key behind jwks.json. Chain refs point at ERC-8004 on Arc (eip155:5042002) through alsoKnownAs instead of being baked into the identifier.",
  author: "AgentBadge Team",
  authorRole: "Agency for the Agentic Web",
  date: "2026-10-07",
  dateModified: "2026-10-07",
  tags: ["did", "verifiable-credentials", "arc", "ai-agents", "x402", "identity"],
  readingTime: "6 min",
  shortAnswer:
    "AgentBadge's platform identity is did:web:agentbadge.xyz — a domain-anchored W3C DID surviving chain migrations, with a signed DID Configuration verifiable via jose. One DID_SIGNING_KEY backs did.json and jwks.json; Arc ERC-8004 refs live in alsoKnownAs (eip155:5042002).",
  agentGuideSlug: "arc-c27-did-web-identity",
  heroImage: "/images/blog/arc-c27-did-web-identity-hero.png",
  ogImage: "/images/blog/arc-c27-did-web-identity-og.png",
  content: `<p>Ask any agent in our network "who are you?" and it can now answer with a signature anyone can verify — no registry account, no API key, no trust in us required. This week we gave AgentBadge a real platform identity: <code>did:web:agentbadge.xyz</code> — a W3C DID anchored to our domain, backed by a signed DID Configuration that any client can check with about twenty lines of <code>jose</code>.</p>
<p>This is article 27 in the Arc Campaign series. In <a href="https://agentbadge.xyz/blog/arc-c14-agent-discovery">C14</a> we built the discovery surface — the <code>.well-known</code> manifest set that lets agents find us. C27 answers the question that comes right after discovery: <em>ok, I found you — but how do I know it's actually you?</em></p>
<p><img src="/images/blog/arc-c27-did-web-identity-hero.png" alt="Domain anchor with a signature shield — did:web identity" /></p>
<h2 id="why-did-web">Why did:web and not a chain DID?</h2>
<p>We had options. We had <em>history</em>: the platform previously advertised a <code>did:hcs</code> Hedera testnet passport and a <code>did:eip155</code> Base Sepolia passport in its <code>did.json</code>. Both told the truth about where our agents <em>were</em> registered — and both went stale the moment we moved chains.</p>
<p>Our stack has already lived on three networks: Hedera (the passport prototype), Base Sepolia (the x402 experiments), and now Arc — where AgentBadge settled into production: ERC-8004 agent registry, USDC payments, verdict anchors. A DID that encodes <code>did:hcs</code> or <code>did:eip155:84532</code> in its identifier becomes a lie on the day you migrate. A <code>did:web</code> identifier encodes the one thing that <em>doesn't</em> move: <code>agentbadge.xyz</code>.</p>
<p>So the platform DID is <code>did:web:agentbadge.xyz</code>. The chain identities aren't the DID — they're what the DID <em>points at</em>: <code>alsoKnownAs</code> carries our ERC-8004 references on Arc (<code>eip155:5042002:0x8004A169…</code>), and the agent-card manifest carries per-agent <code>eip155</code> refs with passport IDs.</p>
<p><img src="/images/blog/arc-c27-did-web-identity-1.png" alt="did:web anchor vs stale chain DIDs" /></p>
<h2 id="did-document">What a resolver actually gets</h2>
<p><code>GET https://agentbadge.xyz/.well-known/did.json</code> returns a real DID document — not the mislabeled config that used to live there: <code>verificationMethod</code> carries a real Ed25519 public key (<code>JsonWebKey</code>, OKP/Ed25519 — the same key that backs <code>/.well-known/jwks.json</code>), and <code>service[]</code> is the agent's map to us: agent-card → capabilities, mcp → tool interface, x402 → paid endpoints on Arc, api-catalog → the full service surface.</p>
<h2 id="did-configuration">The signed DID Configuration — the part that proves it</h2>
<p>A DID document served from a domain is self-asserted: of course <code>agentbadge.xyz</code> claims <code>did:web:agentbadge.xyz</code> belongs to it. The DIF <a href="https://identity.foundation/did-configuration/">DID Configuration spec</a> closes that loop in the other direction — the DID signs a credential that <em>claims the domain</em>.</p>
<p><code>GET /.well-known/did-configuration.json</code> returns a <code>linked_dids</code> array with one VC-JWT. Decode it and you get <code>iss == sub == did:web:agentbadge.xyz</code>, <code>credentialSubject.origin == "https://agentbadge.xyz"</code>, signed EdDSA with <code>kid: "#key-1"</code> — the same verification method from the DID document. Verify it yourself, no AgentBadge account required:</p>
<pre><code class="language-typescript">import { createLocalJWKSet, jwtVerify } from "jose";

const domain = "https://agentbadge.xyz";
const doc = await (await fetch(domain + "/.well-known/did.json")).json();
const cfg = await (await fetch(domain + "/.well-known/did-configuration.json")).json();

const jwks = createLocalJWKSet({
  keys: [doc.verificationMethod[0].publicKeyJwk],
});
const { payload } = await jwtVerify(cfg.linked_dids[0], jwks);
// payload.iss === payload.sub === "did:web:agentbadge.xyz"
// payload.vc.credentialSubject.origin === "https://agentbadge.xyz"</code></pre>
<p>That's the whole verification. Twenty lines, one HTTP pair, zero dependencies on us being online tomorrow — the proof is portable.</p>
<p><img src="/images/blog/arc-c27-did-web-identity-4.png" alt="VC-JWT verify flow: fetch config → jwtVerify against did.json key" /></p>
<h2 id="one-key">One key infrastructure: did.json + jwks.json</h2>
<p>Our <code>jwks.json</code> used to be a stub — a JWK whose <code>x</code> field literally contained the string <code>"agentbadge.xyz"</code> instead of a base64url public key. Honest review caught it; this slice fixed it properly.</p>
<p>Now both endpoints derive from a single Ed25519 key held in <code>DID_SIGNING_KEY</code> (PKCS8, env-injected at boot). Same public key in the DID document's <code>verificationMethod</code> and in the JWKS set (<code>kid: agentbadge-2026-1</code>). One key to rotate, one trust anchor for everything domain-bound the platform signs.</p>
<p>And no key at all is better than a fake one: without <code>DID_SIGNING_KEY</code> set, <code>did.json</code> isn't generated and <code>jwks.json</code> returns an empty key set. Absence is honest; a forged-looking stub is not.</p>
<p><img src="/images/blog/arc-c27-did-web-identity-2.png" alt="One Ed25519 key under did.json, did-configuration.json and jwks.json" /></p>
<h2 id="arc-fit">Where Arc fits</h2>
<p>The DID is chain-agnostic on purpose — but the <em>identity graph</em> isn't abstract. <code>alsoKnownAs</code> points at our ERC-8004 registry entry on <strong>Arc testnet (chain 5042002)</strong> — the chain where AgentBadge agents register passports, escrow verdicts, and settle in USDC.</p>
<p>The practical chain of trust for an agent evaluating us:</p>
<ol>
<li><code>GET /.well-known/did.json</code> → platform identity + service map</li>
<li><code>agent-card.json</code> → capabilities and per-agent ERC-8004 refs on Arc</li>
<li><code>GET /did/did:web:agentbadge.xyz</code> → self-resolution (same document)</li>
<li>ERC-8004 <code>eip155:5042002:0x8004A169…:agentId</code> → on-chain passport on Arc</li>
<li>x402 endpoints in <code>service[]</code> → paid calls, settled on Arc in USDC</li>
</ol>
<p>The domain proves the DID; the DID points at Arc; Arc holds the passports and the money. Each layer verifiable without asking us.</p>
<p><img src="/images/blog/arc-c27-did-web-identity-3.png" alt="Resolver chain: agent → domain → DID doc → services → Arc" /></p>
<h2 id="authority-split">Authority split: the signing key is not the money key</h2>
<p><code>DID_SIGNING_KEY</code> is a dedicated role. It is not the evaluator key, not the verdict signer, not a wallet key — compromising it lets an attacker forge domain linkage claims and nothing else. No funds move, no verdicts sign.</p>
<p>Rotation is equally boring by design: regenerate the key, re-emit the DID document with a new <code>kid</code> (<code>agentbadge-2027-1</code>), re-sign the VC, keep the old <code>kid</code> in <code>verificationMethod</code> until its VC expires (<code>exp</code> = issuance + 1 year). Clients that pin the DID keep working through the overlap.</p>
<p><img src="/images/blog/arc-c27-did-web-identity-5.png" alt="Key role split: DID_SIGNING_KEY vs money and verdict keys" /></p>
<h2 id="honest-status">Honest status</h2>
<p>Shipped in <code>a710bac</code>: DID document, signed DID Configuration (VC-JWT, <code>iat</code> now / <code>exp</code> +1y, minted at boot — no hardcoded dates), jwks fix, self-resolution at <code>/did/did:web:agentbadge.xyz</code>, <code>gen-did-key.ts</code> for key provisioning. 9 new tests + 71 regression green; <code>did:hcs</code> and <code>did:eip155</code> purged from every manifest — they still resolve on their chains, we just no longer claim them as <em>platform</em> identity.</p>
<p>Live on production: <code>DID_SIGNING_KEY</code> is set on agentbadge.xyz — all three endpoints serve, the VC-JWT verifies against the DID document key (the exact snippet above, run against prod), and the <a href="https://dev.uniresolver.io/1.0/identifiers/did:web:agentbadge.xyz">Universal Resolver</a> already resolves <code>did:web:agentbadge.xyz</code> — third-party validation that needs nothing from us. A <a href="https://check.identinet.io">check.identinet.io</a> entry is a separate follow-up: it's a merchant registry (NGI Trustchain), so a pass there requires submitting the domain — it's not a live spec validator.</p>
<h2 id="try-it">Try it</h2>
<pre><code class="language-bash">curl -s https://agentbadge.xyz/.well-known/did.json | jq .
curl -s https://agentbadge.xyz/.well-known/did-configuration.json | jq .
curl -s https://agentbadge.xyz/.well-known/jwks.json | jq .</code></pre>
<ul>
<li>Source: <code>lib/agent-discovery/{did,did-config,did-key}.ts</code> in the <a href="https://github.com/spreadzp/agentbadge">agentbadge repo</a> — pure builders, zero IO, sources injected</li>
<li>Verify test: <a href="https://github.com/spreadzp/agentbadge/blob/main/hackathon/server/tests/did-identity.test.ts"><code>tests/did-identity.test.ts</code></a> — the exact <code>jwtVerify</code> flow above, run against a live app</li>
</ul>
<p><em>This is C27 in the Arc Campaign series. Earlier: C14 covered the discovery surface these manifests live on; C26 covers cross-chain ERC-8004 resolution — the other half of "how agents know who is who."</em></p>
<p><strong>Links:</strong> <a href="https://agentbadge.xyz">AgentBadge</a> · <a href="https://identity.foundation/did-configuration/">DID Configuration spec</a> · <a href="https://check.identinet.io">identinet check</a></p>
<p><em>Don't certify. Measure.</em></p>`,
};
