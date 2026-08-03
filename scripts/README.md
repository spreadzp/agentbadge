# AgentBadge Scripts

Utility scripts for the AgentBadge server.

## sign-transaction.ts

Standalone CLI for signing frozen Hedera transactions locally. No network calls — private key never leaves the machine.

### Usage

```bash
# DER-encoded key (default)
bun scripts/sign-transaction.ts --tx-bytes <BASE64> --key 302e020100300506032b657004220420...

# Hex key (0x-prefixed ECDSA)
bun scripts/sign-transaction.ts --tx-bytes <BASE64> --key 0xabc123... --key-type hex

# DER key with explicit type
bun scripts/sign-transaction.ts --tx-bytes <BASE64> --key 302e... --key-type der
```

### Output

```json
{
  "signature": "[\"base64sig...\"]",
  "publicKey": "302a300506032b6570032100..."
}
```

- `signature`: JSON-encoded array of base64 strings (compatible with `complete_task` MCP tool)
- `publicKey`: DER-encoded public key string

### Compile to binary

```bash
bun build scripts/sign-transaction.ts --compile --outfile agentgate-sign
./agentgate-sign --tx-bytes <BASE64> --key <KEY>
```

### Integration with complete_task

1. Call `POST /market/tasks/:id/prepare-payment` to get `txBytes`
2. Sign locally: `bun scripts/sign-transaction.ts --tx-bytes <TX_BYTES> --key <PRIVATE_KEY>`
3. Submit: `POST /market/tasks/:id/complete` with `{ signature, publicKey }` from step 2
