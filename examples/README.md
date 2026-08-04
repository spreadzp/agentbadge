# Sample Outputs

This folder contains pre-generated sample outputs from AgentBadge's medical data analysis workflow.

## Files

| File | Description |
|------|-------------|
| `sample-medical-report.html` | Pre-generated HTML analysis report (Pima Diabetes dataset) |
| `sample-assertions-result.json` | DataHub verification result (assertions + glossary) |
| `sample-escrow-tx.txt` | Hedera scheduled transaction (escrow) details with HashScan link |
| `sample-glossary-terms.json` | 16 medical glossary terms registered in DataHub |

## How These Were Generated

1. Start server: `bun run dev`
2. Start DataHub: `docker compose up` (in datahub dir)
3. Seed tasks: `bun run seed-medical-tasks`
4. Start agent: `bun run medical-agent`
5. Agent auto-claims, processes, delivers, and completes task
6. Outputs captured from the completed task

## Live Demo

For a live demo, visit: https://agentbadge.xyz
