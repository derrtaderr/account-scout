# Segment ranking

One row per candidate segment, scored 1-5 against the four beachhead criteria.
`gtm rank` sums them equal-weight and prints the ranking; it never writes a
total back into this file, because a stored total drifts from the cells it was
summed from.

The criteria, and what a 5 looks like on each:

- **winnable** — you could take a meaningful share of this segment inside
  roughly eighteen months. Small and reachable scores high; vast or locked-up
  scores low.
- **pain** — the segment already knows it has the problem and it hurts. The
  response to a pitch is "take my money", not "interesting, circle back next
  quarter".
- **budget** — money for solving this already exists and is adequate. Nobody
  has to invent a line item to buy from you.
- **market-health** — the surrounding market is open enough to expand into:
  low competition, no severe barriers, receptive to something new.

Whole numbers only. A 3.5 is precision the data does not have.

| segment | winnable | pain | budget | market-health |
|---|---|---|---|---|
| regional LTL carriers | 5 | 5 | 4 | 4 |
| third-party warehouses | 3 | 4 | 3 | 3 |
| national parcel hubs | 1 | 3 | 5 | 2 |
