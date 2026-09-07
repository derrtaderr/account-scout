# Market-problem map

One row per segment × problem pair. The map takes 2 to 5 segments — beyond
five, researching every candidate stops being practical, so narrow with
`gtm rank` first. Every segment here must already have a row in `segments.md`.

`statement` is the problem **as that segment would describe it, in their own
words**. Interviews are the source. A row with scores and no statement is
refused, because a number with no observation behind it is false precision.

The axes, each scored 1-10, whole numbers:

- **pain** — how much this problem matters in the customer's own view. Bleeding
  scores high; known-but-tolerated scores low, because tolerated problems do
  not get budgets.
- **ease-of-sale** — how reachable and how quick this segment is to sell to.
  A short, cheap cycle scores high; a year of meetings scores low.
- **ease-of-implementation** — how easily you can serve them with what you
  have. Happy-as-is scores high; custom builds and heavy user education score
  low. **Leave this column blank while `product_state` is `none`** — ease is
  unknowable before a product exists, and the map scores on two axes instead.

`gtm map` sums each row, then each segment. The highest totals are your
strongest beachhead candidates. The pick stays yours: `gtm pick`.

| segment | problem | statement | pain | ease-of-sale | ease-of-implementation |
|---|---|---|---|---|---|
| regional LTL carriers | detention billing leaks | "we eat the detention because nobody wrote down when the trailer actually landed" | 9 | 8 | 7 |
| regional LTL carriers | dock double-booking | "two drivers show up for the same door and one of them waits three hours" | 8 | 8 | 8 |
| third-party warehouses | receiving labor spikes | "we staff for the average and then Tuesday buries us" | 6 | 5 | 5 |
| national parcel hubs | yard visibility | "we know where the trailer is, we just cannot tell you when it moves" | 5 | 2 | 3 |
