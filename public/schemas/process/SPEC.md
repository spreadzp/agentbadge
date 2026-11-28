# Universal Process Semantics — Specification v0.2

**Status:** current implementation spec — describes the schemas AS IMPLEMENTED in
`@agentbadge/process-contracts` (SLICE-235-3..11). A divergence between this spec and the
emitted schemas is a bug in the SPEC, not a design intent. Supersedes spec v0.1
(`docs/EPICS/235/info/` — historical input, kept unedited).

**Philosophical basis:** the Bedrij Principle (D-235-13) — a system earns trust by proving
transitions, not by asserting them. This spec is the vocabulary layer; the verification
machinery lives in later epics (236–241).

**Package:** `@agentbadge/process-contracts` — contract + fixtures only. No runtime, no
identity tables, no hashing code. Emission: `bun run emit:schema` → `schemas/v1/*.schema.json`
(JSON Schema draft 2020-12, canonical `$id`
`https://agentbadge.xyz/schemas/process/v1/{Name}.schema.json`, cross-contract references as
absolute `$ref` URLs — D-235-41). Drift guard: `tests/schema-drift.test.ts`.

---

## 1. Purpose and layer boundary

Six domain models inside our codebase invented their own words for the same four ideas:
**actor, object, evidence, transition**. This package is the shared dictionary those six
translate into — plus one new capability no single domain had: a cryptographically anchored,
immutable record that a transition was *verified*.

The layer is deliberately thin:

- **No UUIDs in contracts** — UUIDs are internal persistence keys (D-235-4). Outside, identity
  is a typed `ExternalReference`.
- **No facts, only references and artifacts** — an `EvidenceRef` is a link; a
  `MeasurementObservation`/`DocumentArtifact` is a typed signed artifact; a
  `ProcessEventProjection` is an interpretation, not truth; a `StateTransitionCommitment` is
  the only artifact that asserts verification — and only `ACCEPTED`.
- **No runtime** — resolvers, adapters, verification services, anchoring, persistence are
  EPIC-236/237/238/239. Pure helpers here (`resolveActor`, `validateWorkflow`) are config
  matchers/graph checkers, not engines.

## 2. The 15 contracts (fields as implemented)

All objects are **strict** (unknown keys rejected — including `uuid`, `id`, `payload`,
`signature` where not declared). Constraint notation: `[]` array bounds, `?` optional,
`|` enum, `~` regex-constrained string.

### 2.1 Identity primitives

**ExternalReference** — the ONLY identity form allowed inside contracts.
`{namespace~, referenceType~, value≤512}` where `namespace` is a colon-joined qualified
space (`eip155:5042002`, `erc8004:eip155:5042002`, `agentbadge:supply-chain`,
`agentbadge:system`, `agentbadge:commitment`) — ≥1 colon REQUIRED: an unqualified value is
invalid because the same EVM address on different chains is a different identity.
`referenceType` is a kebab token (`agent-id`, `wallet`, `batch`, `id`, `serial`, …).

**ActorRef** — public actor identity, no UUID.
`{type: HUMAN|ORGANIZATION|AI_AGENT|DEVICE|SERVICE|SYSTEM, externalReferences[1..64]}`.
`SYSTEM` ≠ `SERVICE`; the enum is closed — a new type = new schema version. Duplicate
`namespace+referenceType+value` triples rejected. Two references inside one ActorRef assert
an already-confirmed link — nothing ever merges them automatically.

**ActorResolutionResult** — resolver output.
`{status: RESOLVED|UNRESOLVED|AMBIGUOUS, source, rawActor, actorRef?, issues[{code,field?}]=[]}`.
`UNRESOLVED` is a status, never an actor type. `resolveActor(source, rawActor, registry)` is
a pure config matcher over `(source, rawActor) → ActorRef` entries: identical refs collapse
→ `RESOLVED`; distinct refs under one key → `AMBIGUOUS`; no match → `UNRESOLVED`.

### 2.2 Asset identity and lineage

**AssetRef** — public asset identity, no UUID.
`{assetType~, domain~, externalReferences[1..64], contentDigest?{algorithm, value hex}}`.
`assetType` is an extensible namespaced string — convention `physical.*`/`digital.*` — NOT an
enum. `domain` names the owning domain (`supply-chain`, `software`, `commerce`).
Identity only: no quantity, custodian, location, measured properties, parent/child arrays —
all rejected.

**AssetRelationship** — append-only lineage/containment edge.
`{parentAssetRef→AssetRef, childAssetRef→AssetRef,
relationType: DERIVED_FROM|SPLIT_FROM|MERGED_FROM|CONTAINS|PACKAGED_IN,
quantity? ~decimal-string, unit? ≤64 UCUM}`. `quantity` is a STRING (Decimal/JCS rule —
never a JSON number); `quantity` ⇒ `unit` required. `parent == child` (canonical
`assetRefKey` equality) rejected. Cycles across multi-hop lineage: persistence concern
(EPIC-239).

### 2.3 Policy and evidence references

**PolicyRef** — reference to a policy.
`{policyId? ≤128, version ≤32, uri ≤512 allowlist, hash ~64-hex}` — `hash` REQUIRED (a policy
ref without a hash is unfalsifiable). `uri` allowlist: `http|https|ipfs|ar`, no credentials,
non-empty `ipfs:`/`ar:` resource.

**EvidenceRef** — econ-events-compatible link primitive.
`{type ≤32 OPEN, hash ~0x64-hex, issuer: ActorRef | {address~evm, type ≤32 open, label? ≤256},
uri? ≤2048 allowlist}`. A real econ-events evidence ref parses unchanged via the compat
issuer branch (a stored `{address,type}` cannot auto-upgrade — it lacks the chain id).
`type` is open on read (unknown future types must not brick replay). A LINK, not a fact —
`value`/`unit`/`sequence`/`payload` rejected.

**DigestDescriptor** — how a portable digest was produced (a type, not a computation).
`{canonicalization: "RFC8785", hashAlgorithm: "SHA-256", domainSeparator: enum(3), value ~64-hex}`.
Domain separators: `agentbadge.policy` | `agentbadge.acceptance-criteria` |
`agentbadge.evidence-root`. **policyHash ≠ criteriaDigest** — same bytes, different
separators → different digests (D-235-19). `domainSeparator` is required so a verifier knows
which prefix to recompute under.

### 2.4 Process description

**ProcessStep** — a DAG node.
`{stepId~kebab, stepType~namespaced open, dependsOn[] ≤64 =0, policyRefs[]→PolicyRef ≤16 =0}`.
`stepType` (`supply-chain.handoff`, `physical.measurement.temperature`) is valid WITHOUT
registration. `requiredEvidenceTypes`/`allowedActorTypes` are NOT step fields — they live in
Policy Definition (v0.1 divergence, §5).

**WorkflowDefinition** — immutable DAG of steps.
`{schema: "workflow-definition/1", workflowId~kebab (no version), version~semver, domain~,
steps→ProcessStep [1..256]}`. Array order is NOT execution order — edges are DEPENDS_ON only
(v1: no conditions/branches/execution loops). Step-set change = new semver.
Graph semantics are enforced by `validateWorkflow(wf)` → issues
(`WORKFLOW_CYCLE` with exact path `a→b→c→a`, `WORKFLOW_DANGLING_DEPENDENCY`,
`WORKFLOW_DUPLICATE_STEP_ID`) — schemas guarantee shape; the validator guarantees the DAG.
Parse ≠ validity: an invalid graph must still parse so issues can be reported.

### 2.5 Interpretation

**ProcessEventProjection** — formalized result of interpreting a domain event.
`{projectionVersion: "process-event-projection/1",
sourceEvent: {spec, id, source, sourceId, seq} — all 5 required,
interpretation: {workflowRef?{workflowId,version}, stepType?~namespaced,
subjectRefs[]→AssetRef =0, actorRefs[]→ActorRef =0, domainData? record},
mapping: {adapter~kebab, version~semver,
status: SUPPORTED|PARTIAL|UNSUPPORTED|AMBIGUOUS,
issues[] {code: ACTOR_UNRESOLVED|ASSET_REF_MISSING|TYPE_UNKNOWN|AMBIGUOUS_SOURCE, field?, message?}}}`.

- `sourceEvent.spec` is the FOREIGN spec id (`econ-events/1`) — free string; `id` by
  convention `ev:{source}:{sourceId}:{seq}`.
- `domainData` is the containment zone for domain semantics (hopIndex, verdictId, buildId) —
  preserved, never universal.
- Status↔issues invariant (parse-enforced): `SUPPORTED` ⇒ zero issues; every non-SUPPORTED
  status ⇒ ≥1 issue. The unknown is never interpreted as confirmed — a refusal must name
  its reason.
- A projection is never signed and never written into EconomicEvent — `signature`,
  `verdict`, `accepted`, `evidenceRoot` rejected.
- Issue codes are a closed starting enum — new codes = minor schema versions.

### 2.6 Verified transition

**StateTransitionCommitment** — the immutable artifact, the only thing that asserts
verification.
`{schema: "state-transition-commitment/1",
commitmentId→ExternalReference pinned {namespace:"agentbadge:commitment", referenceType:"id"},
subjectAssetRef→AssetRef, fromState~namespaced, toState~namespaced (fromState ≠ toState),
causationEventRefs[1..64] {spec,id}, relatedSettlementRefs? {spec,id} ≤64,
policyHash→DigestDescriptor pinned separator "agentbadge.policy",
evidenceRoot→DigestDescriptor pinned separator "agentbadge.evidence-root",
verificationResult: "ACCEPTED", verifierVersion~semver,
artifactHash: {algorithm: "KECCAK-256", value hex},
signature: {scheme ≤64, value hex}}`.

- Only `ACCEPTED` exists — REJECTED candidates live in verifier logs (EPIC-237).
- `anchorStatus` is absent by design — anchoring is a projection concern, not part of the
  cryptographic fact; `updatedAt`/`memoId`/`txHash` rejected (immutable).
- `relatedSettlementRefs` are escrow/payment links — NOT causation unless a policy says so
  (D-235-28).
- States are namespaced (`supply-chain.carrier-custody`) — cross-domain state collision
  impossible.

### 2.7 Typed evidence artifacts (Phase 0: exactly two — D-235-29)

**MeasurementObservation** — device-signed measurement.
`{schema: "measurement-observation/1", subjectAssetRef→AssetRef,
deviceRef→ActorRef pinned type:"DEVICE",
property: weight|temperature|humidity|pressure|dimension|other,
value ~decimal-string, unit UCUM, observedAt ISO, sequenceNumber int≥0,
previousRecordHash? ~64-hex, signature {scheme, value hex},
trustLevel: DECLARED|SIGNED_DEVICE|SECURE_DEVICE|CALIBRATED_DEVICE|INDEPENDENTLY_VERIFIED}`.

- `value` is a STRING — "-2.500" preserves metrological scale; `-2.5` number rejected.
- `trustLevel` is assigned by EXTERNAL verification (EPIC-240), never by the sender —
  signature proves integrity, not physical accuracy.
- `receivedAt` is absent by design — server-assigned at ingest; sequence gaps are an ingest
  check, not schema.
- `previousRecordHash` chains a device's record series (absent on the first record).
- `property` enum: humidity/pressure do NOT map to econ-events `EvidenceRef.type`; the
  ref-level mapping is a 240-3 decision (string fallback).

**DocumentArtifact** — typed evidence document.
`{schema: "document-artifact/1", documentType~namespaced open,
contentDigest {algorithm, value 64-hex}, uri allowlist ≤512, mimeType~type/subtype,
issuer→ActorRef, issuedAt ISO, signature? {scheme, value hex}}`.

- Reference + digest only — `content`/`payload`/`base64`/`data`/`body` rejected (no generic
  SignedArtifact — D-235-29).
- `signature` optional — server-issued documents need no crypto signature.
- `documentToEvidenceRef(artifact)` → `EvidenceRef {type:"document", hash:0x-normalized,
  issuer, uri}` — digest constrained to 64-hex so the projection is always hash-valid.

### 2.8 Telemetry packaging

**TelemetryBatch** — high-frequency telemetry packaging (contract only, D-235-34).
`{schema: "telemetry-batch/1", batchId~kebab, subjectAssetRef→AssetRef,
deviceRef→ActorRef pinned DEVICE, property enum(6), unit UCUM,
period {from,to} ISO + from≤to, recordCount int>0,
sequenceRange {first,last} int≥0 + first≤last,
manifest {uri allowlist, contentDigest 64-hex} — external,
merkle {algorithm: "SHA-256", root 64-hex, treeVersion: "telemetry-merkle/1"},
anchorRef? {spec,id} | null}`.

- Merkle semantics (docstring contract): leaf = digest of a MeasurementObservation; odd leaf
  count → last duplicated; manifest restores record ORDER (the tree is unordered);
  sequenceRange declares coverage, NOT sequence-integrity proof.
- **merkleRoot ≠ evidenceRoot** — hierarchy: observations → batch root → batch artifact →
  EvidenceRef → evidenceRoot → commitment. Roots nest, never equate.
- `anchorRef` tri-state: absent / null / valid ref — unanchored batches are first-class.
- Manifest is a pointer — `records`/`digests`/`leaves`/`observations` arrays rejected inline.

*(SmokeCheck exists in the registry as a plumbing smoke schema — not a contract.)*

## 3. Crypto boundary (D-235-3/28/37)

Two digest families, deliberately distinct:

| Family | Used for | Canonicalization | Hash | Anchoring |
|---|---|---|---|---|
| **Portable digests** | policyHash, criteriaDigest, evidenceRoot, merkle roots, fixture vectors | JCS (RFC 8785) | SHA-256 | recomputed off-chain |
| **Anchor hashes** | `artifactHash` on the commitment | JCS bytes | **keccak256** | on-chain via existing EaaS anchor flow (`memo(target,"0x",memoIdFor("process",commitmentId),artifactHash)`) |

`artifactHash` is explicitly NOT SHA-256 (D-235-37): the EaaS anchoring scheme is keccak256 —
declared via `algorithm: "KECCAK-256"` literal so "hash of what" is never ambiguous.
Signature scheme labels (`eip191`, …) are open strings — verification is verifier-side.
Computation lives in EPIC-237/238; `canonicalize` is a server/generator dependency, never a
runtime dep of this package (D-235-32).

## 4. Commitment flow and adapter rules (D-235-28)

```
Domain Events → Domain Adapter (Transition Candidate)
  → Central Verification Service (resolve refs → Actor/Asset → Evidence → Policy
                                 → transition admissibility)
  → ACCEPTED → immutable StateTransitionCommitment → Anchor Request → on-chain
```

- **Escrow ordering**: acceptance → commitment → settle for custody transitions; settlement
  refs are related, not causal, unless policy says otherwise.
- **Adapter versioning**: `mapping.adapter` + `mapping.version` are recorded on every
  projection — adapters are semver'd contracts; a projection names exactly who interpreted
  the event and under which version.
- **Mapping statuses**: `SUPPORTED` (full interpretation, zero issues), `PARTIAL`
  (interpreted with named gaps), `UNSUPPORTED` (no mapping — never silent), `AMBIGUOUS`
  (multiple candidate interpretations — never guessed). Refusal is data.

## 5. Terminology v0.1 → v0.2 (every divergence)

| v0.1 (spec/`info/` sources) | v0.2 (implemented) | Why |
|---|---|---|
| `Process` | `WorkflowDefinition` | "process" was overloaded by six domain models |
| `Slice` | `ProcessStep` | "slice" collides with delivery slices; a step is a DAG node |
| `Execution` | `StepExecution` — **DEFERRED**, reserved term | EXECUTION_WHEN triggers (§6); no schema/model created (D-235-27) |
| `Actor` entity + `{system, identifier}` refs | `ActorRef` + `ExternalReference {namespace, referenceType, value}` | qualified namespace mandatory (chain-qualified identity) |
| UUID in contract shapes | no UUID fields anywhere; strict schemas reject them | UUIDs = internal PKs only (D-235-4) |
| `requiredEvidenceTypes` / `allowedActorTypes` on Slice | NOT on ProcessStep — live in Policy Definition | step declares existence+deps; requirements are policy (D-235-25) |
| `ExternalReference {system, identifier}` | `{namespace, referenceType, value}` | reference type is a first-class field (D-235-4/36) |
| `commitmentId`/transitionId as uuid | namespaced `ExternalReference {agentbadge:commitment, id}` | contract-identity rule (D-235-36) |
| generic `SignedArtifact` | exactly two typed artifacts: MeasurementObservation + DocumentArtifact | generic abstraction rejected (D-235-29) |
| `EvidenceRef {type, hash, issuer:{address,type,label}}` (econ) | same shape + `issuer` union with ActorRef | stored refs replay unchanged; new form is canonical (D-235-15) |
| `UNRESOLVED` as actor type | `UNRESOLVED` as resolution status only | absence is a result, not an identity (D-235-21) |
| `SERVICE` ≡ `SYSTEM` | distinct enum members | system participant vs. autonomous software service |
| state as bare string | namespaced state strings (`supply-chain.carrier-custody`) | cross-domain collision guard |
| `quantity`/`value` as numbers | Decimal STRINGS everywhere | IEEE-754/JCS safety + metrological scale (D-235-32) |
| `unit` free text | UCUM-convention strings | mass-balance comparability |
| `receivedAt` inside measurement | absent — server-assigned at ingest | artifact = what the device claimed (D-235-22) |
| `artifactHash` "the hash" | `{algorithm:"KECCAK-256", value}` explicit | portable SHA-256 digests ≠ EaaS anchor hashes (D-235-37) |
| `policyHash` ≈ `criteriaDigest` | distinct domainSeparator constants | different digests for different subjects (D-235-19) |
| `merkleRoot` = `evidenceRoot` | distinct roots, nested hierarchy | record-set vs transition-evidence integrity (D-235-34) |
| `anchorStatus` in artifact | absent — projection field (EPIC-237) | anchoring state is not a cryptographic fact |
| REJECTED transition records | `verificationResult:"ACCEPTED"` literal only | commitments are append-only proofs, not logs |
| universal event envelope | none — `econ-events/1` stays closed | foreign specs project, never re-format (D-235-15) |
| ~20 Prisma models | zero tables — persistence deferred to EPIC-239 | contracts first; tables prove a real gap first |
| `Task` (commerce/board) | separate concept — `Task ≠ ProcessStep` | business request ≠ process stage (D-235-10) |
| `Handoff` | domain term of supply-chain, not a contract type | naming reserved (D-235-5) |
| package `@agentbadge/process-core` | `packages/process-contracts` (in-repo, npm deferred) | honest scope: contract package ships when vectors exist (D-235-12) |

## 6. Parse-only invariants (superRefine inventory)

JSON Schema cannot express these — they are enforced at zod parse and MUST be part of any
conformance suite (a second implementation cannot rely on the emitted `.schema.json` alone):

- `ActorRef`/`AssetRef`: duplicate external-reference triples rejected
- `AssetRelationship`: parent ≠ child (canonical key); `quantity` ⇒ `unit`
- `ProcessEventProjection`: `SUPPORTED` ⇒ 0 issues; non-SUPPORTED ⇒ ≥1 issue
- `StateTransitionCommitment`: commitmentId pinned to `agentbadge:commitment`/`id`;
  `policyHash`/`evidenceRoot` separators pinned; `fromState ≠ toState`
- `MeasurementObservation`/`TelemetryBatch`: `deviceRef` pinned `type:"DEVICE"`
- `TelemetryBatch`: `period.from ≤ to`, `sequenceRange.first ≤ last`
- URI scheme allowlists (`policy-ref`, `evidence-ref`, `document`, `manifest`) — `.refine`,
  parse-time only
- `WorkflowDefinition` graph rules — not schema at all: `validateWorkflow` (cycle path,
  dangling, duplicate ids)

## 7. Conformance methodology

- **Fixtures** (`fixtures/v1/`) are the executable spec: every valid fixture parses; every
  documented reject case fails. CI never fetches fixture URIs (D-235-29).
- **Vectors** (EPIC-238): digests computed over JCS-canonicalized contract bytes, generated
  in TS and re-verified by an independent implementation (Python) — contract package claims
  are verifiable by a second implementation, not by trust (D-235-32).
- **Levels**: reference-valid → content-integrity-verified → semantic-verification-completed
  — conformance distinguishes these explicitly.
- **MVP gate** for this package to be called "done": all 15 contracts emitted with canonical
  `$id`s (✅ this spec), fixtures green, terminology table + glossary published, conformance
  vectors generated and cross-verified, adapters proven on real events in prod (EPIC-235-13).
  npm publication stays deferred and disclosed until then (D-235-12).

## 8. Versioning rules

- Emitted schema `$id`s are immutable per version; breaking field changes → new schema id
  (`*/2`), never an in-place edit.
- Additive minor changes: new `referenceType`/`assetType`/`stepType`/`documentType` values
  (open namespaced strings — no version bump), new projection issue codes, new trust levels
  in docs — minor.
- Closed enums (actor type, relationType, property, trustLevel, projection status+issue
  codes, digest separators): adding a member = new schema version.
- `schema:`/`projectionVersion:`/`treeVersion:` literals are the versioning surface inside
  the payloads themselves.
