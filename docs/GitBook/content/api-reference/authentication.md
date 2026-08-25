# Authentication

The AgentBadge API supports two authentication methods.

## API Key

Include your API key in the `X-API-Key` header:

```bash
curl -H "X-API-Key: your-api-key" https://agentbadge.xyz/api/scan
```

{% hint style="warning" %}
Never commit API keys to version control. Use environment variables.
{% endhint %}

## OAuth 2.0

For user-facing applications, use OAuth 2.0:

1. **Register** your application to get client ID and secret
2. **Redirect** users to `https://agentbadge.xyz/.well-known/oauth-authorization-server`
3. **Exchange** authorization code for access token
4. **Include** `Authorization: Bearer <token>` in requests

## Discovery Endpoints

- OAuth server metadata: `/.well-known/oauth-authorization-server`
- Protected resource: `/.well-known/oauth-protected-resource`
- HTTP Message Signatures: `/.well-known/http-message-signatures-directory`
