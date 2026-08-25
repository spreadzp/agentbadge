# Scanner API

## Scan a URL

```http
GET /api/scan?url=https://example.com
```

### Response

```json
{
  "url": "https://example.com",
  "score": 73,
  "maxScore": 100,
  "badge": "yellow",
  "categories": [
    {
      "name": "discovery",
      "score": 15,
      "maxScore": 20,
      "checks": [
        {
          "id": "AB-001",
          "name": "robots.txt accessible",
          "status": "pass",
          "hint": null
        }
      ]
    }
  ]
}
```

## Get Scan Report

```http
GET /api/scan/:reportId
```

Returns a stored scan report by ID.
