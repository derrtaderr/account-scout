# Account research: Acme Freight

Generated 2026-09-07T23:30:04.463Z (mode: recorded)

## Claims (1)

- [factual/primary] Acme Freight moves palletised freight between regional depots in the American Midwest.
  - https://acmefreight.example/ — "moves palletised freight between regional depots in the American Midwest"

## Refusals (3)

- Acme Freight employs roughly 120 people. — quote does not appear in the fetched content of https://[domain]/acme-freight — quote was: "Employees: approximately 120"
- Acme Freight raised a $12 million Series A in 2025. — citation url was never fetched this run: https://[domain]/acme-freight-series-a — quote was: "Acme Freight raised $12 million"
- Acme Freight prices per pallet-mile. — claim carries no citation — an uncited claim is a refusal, not a claim

## Hops (2)

- https://acmefreight.example/ — Acme Freight (2026-09-07T13:00:00.000Z)
- https://[domain]/acme-freight — Acme Freight — company directory listing (2026-09-07T13:00:02.000Z)

## Machine-readable

```json
{
  "account": "Acme Freight",
  "generatedAt": "2026-09-07T23:30:04.463Z",
  "claims": [
    {
      "id": "c1",
      "text": "Acme Freight moves palletised freight between regional depots in the American Midwest.",
      "kind": "factual",
      "citations": [
        {
          "url": "https://acmefreight.example/",
          "title": "Acme Freight",
          "fetchedAt": "2026-09-07T13:00:00.000Z",
          "quote": "moves palletised freight between regional depots in the American Midwest"
        }
      ],
      "tier": "primary"
    }
  ],
  "refusals": [
    {
      "text": "Acme Freight employs roughly 120 people.",
      "reason": "quote does not appear in the fetched content of https://[domain]/acme-freight — quote was: \"Employees: approximately 120\""
    },
    {
      "text": "Acme Freight raised a $12 million Series A in 2025.",
      "reason": "citation url was never fetched this run: https://[domain]/acme-freight-series-a — quote was: \"Acme Freight raised $12 million\""
    },
    {
      "text": "Acme Freight prices per pallet-mile.",
      "reason": "claim carries no citation — an uncited claim is a refusal, not a claim"
    }
  ],
  "hops": [
    {
      "url": "https://acmefreight.example/",
      "title": "Acme Freight",
      "fetchedAt": "2026-09-07T13:00:00.000Z",
      "content": "Acme Freight moves palletised freight between regional depots in the American Midwest. Founded 2016. Contact us for a quote."
    },
    {
      "url": "https://[domain]/acme-freight",
      "title": "Acme Freight — company directory listing",
      "fetchedAt": "2026-09-07T13:00:02.000Z",
      "content": "Acme Freight. Road freight and less-than-truckload. Headquarters: Toledo, Ohio. Employees: 51-200. This listing is user-maintained and may be out of date."
    }
  ],
  "meta": {
    "mode": "recorded"
  }
}
```
