# Evidence ledger

Every claim this project makes about its market or its customers lives here,
with the method that produced it and how much that method can support.

Grades: C1 a few people said it · C2 many said it, nobody bought · C3 a
behavioural signal short of purchase intent · C4 evidence they will purchase ·
C5 they purchased.

Add rows with `gtm evidence add`. It refuses a row with no grade, a grade its
method cannot support, or a date it cannot read, and it names which one.

`proof` is optional and belongs to decision 03 alone. It ties a row to one of
the three proofs of product-market fit — `value-experience`, `monetization`,
`value-proposition` — which is what `gtm gate 03` reads. Leave it blank on every
other row; a tag on any other decision is refused rather than quietly ignored.

`segment` says which ECP a row was observed in, and it must be one of the
segments the ranking scored in `.gtm/01-market/segments.md`. It is **required on
any row carrying a `proof`**, because the three proofs of product-market fit are
measured for each ECP separately — one segment's history cannot carry another
segment's proof. Rows for decisions 01 and 02 may name a segment and are not
required to, since validating a pick includes collecting evidence against it.

| id | decision | observation | method | grade | date | proof | segment |
|---|---|---|---|---|---|---|---|
| e1 | 01 | six of eight dispatchers named unbilled detention as the first thing they would fix | interview | C1 | 2026-03-11 |  |  |
| e2 | 02 | eleven dispatchers walked us through their dock spreadsheet unprompted | interview | C1 | 2026-03-24 |  | regional LTL carriers |
| e3 | 02 | a 61-respondent survey of terminal managers put dock double-booking in their top two operational costs | survey | C2 | 2026-03-30 |  | regional LTL carriers |
| e4 | 02 | four terminal managers at regional LTL carriers signed a paid pilot order form | presale | C4 | 2026-04-02 |  | regional LTL carriers |
| e5 | 01 | desk research put 1,900 US regional LTL carriers in the 20-80 door band | desk-research | C1 | 2026-02-18 |  |  |
