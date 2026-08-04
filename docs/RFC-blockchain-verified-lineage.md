# RFC: Blockchain-Verified Data Lineage in DataHub

> **Author:** AgentBadge Team (DataHub Hackathon 2026)
> **Status:** Draft
> **Discussion:** To be submitted as GitHub Discussion on `acryldata/datahub`

## Problem

DataHub's lineage tracking is metadata-only. Lineage edges are stored in DataHub's metadata graph (GMS) and can be modified or deleted by anyone with GMS write access. There is no cryptographic guarantee that:

1. A lineage edge existed at a specific point in time
2. The transformation described actually occurred
3. The lineage hasn't been tampered with after the fact

This is acceptable for internal data platforms where the platform operator is trusted. But for use cases involving external parties (marketplaces, regulated industries, cross-organization data sharing), metadata-only lineage is insufficient.

## Proposal

Use Hedera Consensus Service (HCS) to create **cryptographically verifiable lineage commits**. Each lineage edge is committed as an immutable HCS message containing:

```json
{
  "sourceUrn": "urn:li:dataset:(urn:li:dataPlatform:kaggle,pima-diabetes,PROD)",
  "targetUrn": "urn:li:dataset:(urn:li:dataPlatform:agentbadge,analysis-report-001,PROD)",
  "transformationType": "TRANSFORMED",
  "timestamp": "2026-08-05T12:00:00Z",
  "submitter": "0.0.1234567",
  "signature": "<Hedera-signed-hash>"
}
```

### Properties

- **Immutable**: HCS messages cannot be modified once submitted
- **Timestamped**: Consensus timestamp from Hedera network
- **Signed**: Submitting entity signs with their Hedera private key
- **Auditable**: Anyone can verify via Mirror Node API (public, free)
- **Low cost**: ~$0.001 per HCS message (Hedera testnet is free)

### Architecture

```text
DataHub GMS (metadata graph)
    ↕ (sync)
Hedera HCS Topic (immutable audit log)
    ↕ (read)
Mirror Node API (public verification)
```

1. When a lineage edge is created in DataHub GMS, also submit an HCS message
2. The HCS message contains the lineage edge URNs + signature
3. External parties can verify lineage via Mirror Node API without DataHub access
4. If GMS and HCS disagree, HCS is the source of truth (immutable)

### Implementation Sketch

```python
# datahub_lineage_hcs.py — optional DataHub plugin

from hedera import AccountId, Client, TopicId, PrivateKey
import json

class HCSLineageCommit:
    def __init__(self, operator_id, operator_key, topic_id):
        self.client = Client.forTestnet()
        self.client.set_operator(AccountId.fromString(operator_id),
                                  PrivateKey.fromString(operator_key))
        self.topic_id = TopicId.fromString(topic_id)

    def commit_lineage_edge(self, source_urn, target_urn, transform_type):
        message = json.dumps({
            "sourceUrn": source_urn,
            "targetUrn": target_urn,
            "transformationType": transform_type,
            "timestamp": datetime.utcnow().isoformat() + "Z",
        })
        # Submit to HCS topic
        tx = TopicMessageSubmitTransaction(
            topic_id=self.topic_id,
            message=message.encode()
        )
        receipt = tx.execute(self.client)
        return receipt.topic_sequence_number
```

### Integration Points

1. **DataHub Lineage Change Event** — hook into lineage creation events
2. **Optional plugin** — not core DataHub, but an extension module
3. **Mirror Node verification** — read-only, no DataHub dependency

### Benefits

| Current DataHub | With HCS Verification |
|----------------|----------------------|
| Metadata-only lineage | Cryptographically verified |
| Mutable (GMS write access) | Immutable (HCS consensus) |
| Internal trust model | External/trustless verification |
| No timestamp proof | Consensus timestamp from Hedera |
| Free to tamper | Tamper-evident (HCS + GMS comparison) |

### Use Cases

1. **Data Marketplaces** — buyers verify data provenance before purchase
2. **Regulated Industries** — auditable data lineage for compliance (HIPAA, FDA)
3. **Cross-Organization Sharing** — verifiable lineage without shared trust
4. **AI Agent Economies** — agents verify task lineage before payment (AgentBadge use case)

### Alternatives Considered

- **Ethereum logs**: Too expensive (~$5-50 per transaction vs $0.001 on Hedera)
- **IPFS only**: Provides content addressing but not ordering or consensus timestamps
- **Trusted timestamping (RFC 3161)**: Provides timestamps but not a public audit log

### Open Questions

1. Should HCS lineage commits be a core DataHub feature or an extension plugin?
2. Should the HCS topic be per-DataHub-instance or global/shared?
3. How to handle lineage deletions (GMS allows soft-delete, HCS is immutable)?
4. Should this be Hedera-specific or support other DLTs (Chainlink, Polygon)?

## References

- [DataHub Lineage Docs](https://datahubproject.io/docs/features/data-lineage/)
- [Hedera Consensus Service](https://docs.hedera.com/hedera/sdks-and-apis/sdks/consensus-service)
- [AgentBadge](https://github.com/spreadzp/agentgate) — implementation using HCS for audit trails
- [DataHub MCP Server](https://github.com/acryldata/mcp-server-datahub)
