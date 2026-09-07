# The GTM objective

> **In __(secured time)___, we have to achieve ___(Objective of the GTM mission).**
> (p331, and the book bolds it)

This is the top cell of the GTM Canvas and the thing all six decisions are for.
`gtm plan` refuses to render a canvas without it, because six columns of state
with nothing saying what they are in service of is the 50-pager problem
inverted — a document that is easy to update and says nothing.

## The two halves

**The mission.** What has to be true when the secured time runs out. Yours to
write; this tool never suggests one and never grades one.

**The secured time.** How much time you have, or can negotiate, to achieve it.
Not a guess about how long the work takes — the time you have actually secured.

## The one number that is refused

The window must run **at least three months**. That is the book's own minimum,
and it is one of the few numbers in it stated as a rule rather than as a range
with a hedge on it:

> "Avoid promising big results in a month or less. Most GTM traction takes
> longer because you are still in an intense learning phase and operating with
> many unknowns. The minimal acceptable time for reviewing your GTM is three
> months." (p332)

A window past **eighteen months** is flagged and never refused. Eighteen is this
tool's reading of a range the book hedges twice in its own words — "we vaguely
claim that a GTM stage lasts for 3 to 18 months" (p331), "your GTM lifeline,
which in most cases is 3 to 18 months" (p285). A number an author hedges twice
is not a rule, so the long window is yours to hold.

If the time and the goal do not fit, the book's move is to renegotiate rather
than to accept it quietly:

> "You can either realign the timeline, change the tactics, or agree on an
> intermediate milestone target. Often, it is better to underpromise and
> overdeliver." (p332)

## This is NOT the OMTM

They collapse into each other easily and they must not. The **OMTM** is one
metric, owned, valid for two to six months, that changes what the team does
week to week (p154, and `gtm omtm`). The **objective** is what the whole
go-to-market is for. One is an instrument reading; the other is the mission.

A mission that reads like a metric is still legal — "two cold-start clients
signed" is a real objective — and this tool says it noticed rather than refusing
your wording. What it will not do is derive one from the other, in either
direction.

## Declare it

```
gtm objective set --mission "two cold-start clients signed" \
  --from 2026-09-04 --to 2026-12-31 --date 2026-09-04
```

`--date` is the day YOU declared it. This tool never reads the clock.

| field | value |
|---|---|
| mission | twelve regional LTL carriers paying for dock scheduling, and detention billed automatically on every one of their docks |
| secured_from | 2026-04-01 |
| secured_to | 2026-12-31 |
| declared | 2026-04-08 |
