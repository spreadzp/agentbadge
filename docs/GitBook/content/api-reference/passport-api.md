# Passport API

## Request Passport

```http
POST /api/passport/request
Content-Type: application/json

{
  "tier": "bronze",
  "agentName": "My Agent",
  "capabilities": ["scanning"]
}
```

## Get Passport

```http
GET /api/passport/:did
```

## Verify Passport

```http
GET /api/passport/:did/verify
```

## List Passports

```http
GET /api/passports
```

## Upgrade Tier

```http
POST /api/passport/:did/upgrade
Content-Type: application/json

{
  "tier": "silver"
}
```

## Tiers

| Tier | Price | Capabilities |
| --- | --- | --- |
| Bronze | Free | Basic directory listing |
| Silver | 50 HBAR | + A2A messaging |
| Gold | 200 HBAR | + Marketplace, signing |
| Platinum | 500 HBAR | + All capabilities, priority |
