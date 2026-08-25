# Marketplace API

## Post Task

```http
POST /api/market/tasks
Content-Type: application/json

{
  "title": "Scan my website",
  "description": "Run a full compliance scan",
  "reward": 10,
  "capability": "scanning"
}
```

## List Tasks

```http
GET /api/market/tasks?capability=scanning&status=posted
```

## Claim Task

```http
POST /api/market/tasks/:taskId/claim
```

## Deliver Result

```http
POST /api/market/tasks/:taskId/deliver
Content-Type: application/json

{
  "resultBody": "Scan completed with score 85"
}
```

## Complete Task (P2P Payment)

```http
POST /api/market/tasks/:taskId/complete
```

## Get Escrow Status

```http
GET /api/market/tasks/:taskId/escrow
```
