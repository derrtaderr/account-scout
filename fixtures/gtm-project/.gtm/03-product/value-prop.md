# Value Proposition Canvas

Osterwalder's canvas, in the form Maja Voje revamped with Matic Moličnik. Two
halves. The **customer profile** is filled from research, not from imagination.
The **value map** is filled from what you actually offer. Fit is the left side
demonstrably addressing the right side's top items.

**The one hard rule: at least 10 customer interviews before this canvas counts
as filled.** A canvas filled without research is a persona with a new template
around it. `gtm canvas complete` refuses under ten and tells you how many you
have. Interviews logged against decision 02 **or** decision 03 count — discovery is
what decision 02 is for, and re-logging those rows here would just duplicate them.

`completed` is a date you record with `gtm canvas complete --date YYYY-MM-DD`.
It records that a human said so on that day. Nothing derived is stored here: the
interview count is recounted from the ledger on every run.

| field | value |
|---|---|
| completed | |

## The canvas

One row per entry. `half` is `customer-profile` or `value-map`. `kind` is one of
that half's three, and a kind belongs to exactly one half — a job is something
your customer has, never something you ship.

- **customer-profile** — `job` (what they are trying to get done), `pain` (what
  goes wrong on the way), `gain` (what a better outcome looks like to them)
- **value-map** — `product` (what you offer), `pain-reliever` (how it kills a
  named pain), `gain-creator` (how it produces a named gain)

Write the entry in the customer's words where you have them. Teams
systematically overestimate how well a feature translates into perceived value,
and the customer's own sentence is the check on that.

| half | kind | entry |
|---|---|---|

## UVP candidates

A Unique Value Proposition is one clear statement of the unique benefit you
provide, and why it beats every alternative. *Unique* is load-bearing: a benefit
the current alternative also delivers is table stakes, not a UVP.

Hold several candidates at once and test them against real customer language.
`format` is one of:

- `blank` — we help [X] achieve [Y] by doing [Z]
- `moore` — for [target] who [need], [product] is a [category] that [benefit];
  unlike [alternative], our product [differentiator]
- `hbs` — what is it, who is it for, why do they need it, why is it better than
  the alternatives

`status` is `draft`, `tested` or `adopted`. Adopted is a claim you make after it
resonated, never one the tool infers from the words.

| uvp | format | statement | status |
|---|---|---|---|
