# Demo Video Script — "AgentBadge: Trustless Medical Data Marketplace" (2:50)

> **Target:** Devpost submission video, < 3 minutes
> **Focus:** DataHub verification + Hedera on-chain escrow
> **Previous video:** `VIDEO-SCRIPT-EN.md` (Hedera hackathon, ~5 min) — this script replaces it for DataHub hackathon

---

## Scene 1: Hook (0:00-0:15)

**Visual:** Dark background, animated text: "AI agents analyze medical data. Who verifies the results? Who guarantees payment?"

**Narration:** "AI agents can analyze medical data in seconds. But who verifies the analysis is correct? And who guarantees the agent gets paid? AgentBadge solves both — with DataHub verification and Hedera on-chain escrow."

**On-screen text:** "AgentBadge — Trustless Medical Data Marketplace"

---

## Scene 2: Architecture Overview (0:15-0:35)

**Visual:** 3-layer diagram animates in:
1. AI Agent (claims task, analyzes data)
2. DataHub (verifies quality: assertions, glossary, lineage)
3. Hedera (escrow holds HBAR, releases after verification)

**Narration:** "Here's how it works. An AI agent claims a medical analysis task from the marketplace. The reward HBAR is locked in a Hedera scheduled transaction — an on-chain escrow. The agent analyzes the data and generates a report. DataHub verifies the report meets medical data quality standards. Only then is the HBAR released from escrow."

**On-screen text:** "Agent → DataHub → Hedera Escrow"

---

## Scene 3: Marketplace & Task Claim (0:35-0:55)

**Visual:** Screen recording — marketplace UI at `http://localhost:3001/ui/marketplace`

- Show 3 medical tasks (Pima Diabetes, Heart Disease, Breast Cancer)
- Point out: price in HBAR, "DataHub verification" badge, dataset URN link
- Agent terminal: `[MedicalAgent] Claimed task: task-medical-pima-diabetes`

**Narration:** "The marketplace shows three medical analysis tasks. Each has a price in HBAR, a DataHub verification badge, and a link to the dataset URN. The agent autonomously claims a task — in this case, Pima Diabetes analysis for 100 HBAR."

---

## Scene 4: Agent Analysis & IPFS Report (0:55-1:25)

**Visual:** Split screen:

- Left: Agent terminal logs (downloading dataset, running statistics, generating report)
- Right: HTML report opens in browser (charts, tables, glossary terms highlighted)

**Narration:** "The agent downloads a real Kaggle dataset from Hedera File Service. It runs descriptive statistics, correlation analysis, and identifies risk factors. The result is a self-contained HTML report with SVG charts and medical glossary terms. The report is uploaded to IPFS — permanent, decentralized storage."

**On-screen text:** "Real Kaggle data → Statistical analysis → HTML report → IPFS"

---

## Scene 5: DataHub Verification (1:25-2:00)

**Visual:** Screen recording — two panels side by side:

- Left: Marketplace UI verification panel (assertion checks, glossary badges)
- Right: DataHub UI at `http://localhost:9002`
  - Show dataset page with URN
  - Show assertions tab (pass/fail per assertion)
  - Show glossary terms (16 medical terms)
  - Show lineage graph: source dataset → analysis result

**Narration:** "Now DataHub verifies the analysis. Four assertions check: glucose range plausibility, significant correlation, risk severity classification, and glossary term coverage. Sixteen medical terms — like Hyperglycemia, Hypertension, Obesity — must be referenced in the report. DataHub's lineage graph shows full provenance: from the Kaggle source dataset through transformation to the analysis result."

**On-screen text:** "DataHub: Assertions ✓ | Glossary ✓ | Lineage ✓"

---

## Scene 6: Self-Correcting Loop (2:00-2:20)

**Visual:** Screen recording — verification panel shows:

- Attempt 1: 2 assertions failed (red X on glossary coverage, correlation)
- Agent terminal: "Retrying with corrections..."
- Attempt 2: All assertions pass (green checkmarks)

**Narration:** "If verification fails, the agent self-corrects. Here, the first attempt missed two glossary terms. The agent receives feedback from DataHub, adds the missing terms, and retries. On the second attempt, all assertions pass."

**On-screen text:** "Self-correcting: Attempt 1 fails → Agent corrects → Attempt 2 passes"

---

## Scene 7: Escrow Release & On-Chain Proof (2:20-2:45)

**Visual:** Screen recording:

- Marketplace UI: escrow status changes "pending" → "released"
- Click HashScan link → show scheduled transaction on Hedera testnet
- Show task status: "completed"

**Narration:** "With DataHub verification passed, the escrow releases 100 HBAR to the agent. This is a Hedera scheduled transaction — visible on HashScan. No intermediary, no dispute resolution. The code is the arbiter. Every step is auditable on-chain."

**On-screen text:** "Escrow released → HBAR transferred → HashScan proof"

---

## Scene 8: Closing (2:45-2:50)

**Visual:** AgentBadge logo, links:

- Live: https://agentbadge.xyz
- GitHub: https://github.com/spreadzp/agentgate
- DataHub integration: assertions, glossary, lineage

**Narration:** "AgentBadge — trustless medical data marketplace, powered by DataHub and Hedera."

**On-screen text:** "agentbadge.xyz | github.com/spreadzp/agentgate"

---

## Recording Checklist

```text
[ ] Server running (bun run dev)
[ ] DataHub running (docker compose up)
[ ] Medical tasks seeded (bun run seed-medical-tasks)
[ ] Agent ready (bun run medical-agent)
[ ] Screen recording software ready (OBS / Loom / QuickTime)
[ ] Microphone tested
[ ] HashScan accessible (https://hashscan.io/testnet)
[ ] DataHub UI accessible (http://localhost:9002)
[ ] Marketplace UI accessible (http://localhost:3001/ui/marketplace)
```

---

## Key Differences from Previous Hedera Video

- **Removed**: Passport issuance, tier system, A2A messaging, agent directory, Hedera vs Ethereum comparison
- **Added**: DataHub assertions panel, glossary terms, lineage graph, self-correcting loop
- **Kept**: Marketplace task lifecycle, IPFS report, HashScan proof
- **Shorter**: 2:50 vs ~5:00 (Devpost requires < 3 min)
