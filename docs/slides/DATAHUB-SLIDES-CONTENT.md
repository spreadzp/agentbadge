# AgentBadge — DataHub Hackathon Presentation

> 10 slides for DataHub hackathon submission
> Focus: DataHub verification + Hedera on-chain escrow
> Previous deck: `AgentGate_Autonomous_AI_Economy.pptx` (Hedera hackathon, 15 slides)

---

## Slide 1: Title

**AgentBadge — Trustless Medical Data Marketplace**

On-Chain Escrow + DataHub Verification

DataHub Hackathon — August 2026

---

## Slide 2: The Problem

- AI agents analyze medical data — **no quality gates**
- No way to verify analysis **before payment**
- No **data provenance** tracking
- No **accountability** for poor work

> A provider agent can deliver a flawed analysis, get paid, and disappear.

---

## Slide 3: The Solution

- **Hedera escrow** — HBAR locked, released only after verification
- **DataHub verification** — assertions, glossary, lineage
- **Self-correcting agent** — retries if verification fails (up to 3x)
- **IPFS reports** — permanent, decentralized storage

---

## Slide 4: Architecture

```
AI Agent → DataHub (verify) → Hedera (escrow)
```

1. Agent claims task → downloads Kaggle dataset from HFS
2. Agent analyzes data → generates HTML report → uploads to IPFS
3. DataHub checks assertions + glossary coverage
4. If pass: escrow releases HBAR. If fail: agent retries.

---

## Slide 5: DataHub Integration

**Assertions** (4 types):
- Glucose range plausibility (medical)
- Significant correlation check (statistical)
- Risk severity classification (clinical)
- Glossary term coverage (terminological)

**Glossary**: 16 medical terms (Hyperglycemia, Hypertension, Obesity, etc.)

**Lineage**: Kaggle source → transformation → analysis result

**Datasets**: 3 registered (Pima Diabetes, Heart Disease, Breast Cancer)

---

## Slide 6: Escrow Flow

1. Task posted → **Scheduled Transaction** created (HBAR locked)
2. Agent claims → escrow status: `pending`
3. Agent delivers IPFS report → verification triggered
4. DataHub verification **passes** → escrow signed
5. HBAR released to agent → visible on **HashScan**

> No intermediary. No dispute resolution. The code is the arbiter.

---

## Slide 7: Self-Correcting Agent

- **Attempt 1**: DataHub assertions fail (missing 2 glossary terms)
- Agent receives **structured feedback** from DataHub
- Agent corrects report → adds missing medical terms
- **Attempt 2**: All 4 assertions pass → escrow released
- Up to 3 retries with automatic correction

---

## Slide 8: Tech Stack

| Layer | Technology |
|-------|-----------|
| Blockchain | Hedera (HTS, HCS, Scheduled Transactions) |
| Data Quality | DataHub (Assertions, Glossary, Lineage, MCP Server) |
| Storage | IPFS via Pinata |
| Web Framework | Hono + Bun |
| UI | HTMX (server-rendered, no React) |
| Agent Protocol | MCP — 38 tools (stdio + HTTP) |
| Payment | x402 protocol |

---

## Slide 9: Demo & Links

- **Live:** https://agentbadge.xyz
- **GitHub:** https://github.com/spreadzp/agentgate
- **NPM:** `@agentgate-hedera/hedera-core`, `@agentgate-hedera/passport`, `@agentgate-hedera/mcp`
- **Tests:** 153 test files
- **License:** Apache 2.0

---

## Slide 10: Why DataHub + Hedera

- **DataHub** = quality gate (verifies analysis is correct)
- **Hedera** = trust gate (ensures payment is guaranteed)
- **Together** = trustless marketplace (no intermediary needed)
- Novel combination — no smart contracts, just **scheduled transactions**
- Every transaction auditable on-chain via HashScan

> DataHub ensures the work is right. Hedera ensures the agent gets paid.
