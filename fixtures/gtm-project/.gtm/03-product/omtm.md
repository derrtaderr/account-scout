# One Metric That Matters

One number, owned by someone, valid for a stated window of 2 to 6 months. Its
job is to make yes/no decisions computable: if a choice does not move this
number inside this window, it is not the work.

**This tool validates the shape and never chooses the metric.** Whether yours is
the right one is a judgment call about your own bottleneck, and a tool that
picked it for you would be picking your strategy.

- `metric` — the number, in words
- `owner` — the person or team who owns it. An unowned metric changes nobody's
  behaviour
- `ratio` — `yes` or `no`, declared by you. A good OMTM is a ratio or a rate
  rather than a raw count, and whether yours is one is a fact about your metric
  rather than something to read off its name
- `window_from` / `window_to` — the validity window, `YYYY-MM-DD`. 2 to 6 months.
  Shorter and the metric cannot move far enough to tell you anything; longer and
  the bottleneck has moved before you look again

Set it with `gtm omtm set`. Check it with `gtm omtm --today YYYY-MM-DD` — the
day is given rather than read off the clock, the same as every other date here.

| field | value |
|---|---|
| metric | average dock turn time in minutes, per active terminal, per week |
| owner | the terminal operations manager on each pilot account |
| ratio | yes |
| window_from | 2026-04-01 |
| window_to | 2026-09-30 |
