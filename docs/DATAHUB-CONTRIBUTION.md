# DataHub Open-Source Contribution

As part of the DataHub Hackathon, we contributed back to the DataHub project:

- **Type:** RFC — Blockchain-Verified Data Lineage
- **Repository:** `acryldata/datahub`
- **Submission:** GitHub Issue/Discussion with RFC document
- **RFC Document:** [RFC-blockchain-verified-lineage.md](./RFC-blockchain-verified-lineage.md)

## Description

We propose using Hedera Consensus Service (HCS) for cryptographically verifiable data lineage in DataHub. Currently, DataHub lineage is metadata-only — it tracks transformations but doesn't cryptographically verify them. By committing each lineage edge as an HCS message with a timestamp and signature, lineage becomes tamper-proof and independently auditable.

This RFC emerged from building AgentBadge, where we use Hedera HCS for audit trails and DataHub for data quality verification. Combining the two creates a system where both the data quality AND the data provenance are trustless.

## AgentBadge Context

AgentBadge is a trustless medical data marketplace that uses:
- **DataHub** — assertions, glossary terms, lineage for medical analysis verification
- **Hedera** — on-chain escrow (Scheduled Transactions), HCS audit trail, HTS NFT passports

The RFC proposes bringing these two systems closer together by making DataHub lineage blockchain-verifiable.
