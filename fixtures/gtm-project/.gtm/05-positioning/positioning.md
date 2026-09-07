# Positioning

Andrej Peršolja's eight-step process, from chapter 6. Steps one and two were
decided upstream: your target audience is the ECP you drew in decision 02, and
your alternatives and market gaps are decision 01's. This worksheet holds steps
three through six, and `gtm gate 05` checks step seven.

> "Positioning is not what you do to a product. Positioning is what you do to the
> mind of the prospect." (Jack Trout)

Fill this in by hand. `gtm positioning` reads it and derives what can be derived.
It never writes an asset, a benefit, a claim or a word of copy — all of those are
judgments, and a tool that drafted them would be doing the deciding.

## The story

`uvp` names a row from the UVP candidates table in
`.gtm/03-product/value-prop.md`. It has to be the one marked `adopted`, because
the story rests on the promise you chose rather than on one you were still
considering.

`statement` is your position in one sentence, in your words. It is recorded and
never graded.

| field | value |
|---|---|
| uvp | |
| statement | Lumen Freight is the dock schedule for regional LTL carriers who want to bill the detention they are currently absorbing, without replacing the TMS they already run. |

## Step three — the assets

> "Write down every asset your team has and every feature your product has."

> "Positioning is a story. That story needs to hold up. All of the elements of
> the story must be true, or your customers will get red flags when we tell them
> that story."

You cannot claim an innovative product with nothing innovative about it, or
position yourself as a tech expert with a young and inexperienced founder. This
is why `gtm gate 05` checks that every asset your story claims is actually on
this list.

`kind` is one of:

- `feature` — something your product has
- `team-ability` — something your team can do

The book's own example list mixes them: small team, lean process, easy-to-use
product, AI integration. At this point there is nothing special about any of it.

## Step four — the benefits

> "Take an asset and ask: 'So what?' or 'Why does the customer care?' Ask
> yourself the question five times, and you'll get a clear benefit a customer
> gets from your asset."

Small team → quick to respond, no overhead or bureaucracy → **fast user
support**. Lean process → short stints, small consistent upgrades → **quick
product updates**. Write the benefit as something the customer would say they
get, not as something you would say you built.

## Step five — the two filters

Answer each `yes` or `no`. **Leave it blank if you have not asked yet** — blank
is a question outstanding, and it is a different fact from `no`.

- **`valued`** — "The asset needs to be viewed as valuable by the client." If a
  customer receives fast service but doesn't care about speed, that's poor
  differentiation. The customer won't care, and you'll fall into the
  "nice-to-have" category.
- **`unique`** — "The asset needs to be unique to you." Almost exclusively
  yours, or claimed by very few competitors. If too many competitors solve the
  same problems as you, you'll compete for market share and you'll struggle to
  attract and convert users, and compete on price.

**What's left is your Unique Selling Proposition.** One is good, two is better.

The tool derives that set from these two columns. There is nowhere in this file
to write a USP down, and that is deliberate: a USP is what survives the filters,
so one that did not come through them is not a weak USP, it is not one.

An asset that is valued but not unique is **kept as a benefit** — table stakes,
still worth saying, just not what you differentiate on. An asset the client does
not value is a **nice-to-have**, whatever else is true of it.

If nothing survives both, that is a result and `gtm positioning` reports it as
one, in the book's own terms, along with the move that follows.

| asset | kind | benefit | valued | unique |
|---|---|---|---|---|
| gate-clock arrival capture | feature | detention you can prove and therefore bill | yes | yes |
| TMS-agnostic dock calendar | feature | one door schedule without replacing the TMS | yes | yes |
| browser-only dock view | feature | the dock supervisor needs no install and no tablet | yes | no |
| freight-operator founding team | team-ability | the demo speaks dock language on the first call | yes | no |
| overnight onboarding | team-ability | live on one terminal the morning after signature | no | yes |
| configurable appointment rules | feature | the schedule matches how this terminal already works | no | no |

## Step six — the claims your story makes

> "Your UVP: your main promise to the customers. Your USP: why your solution is
> better than other solutions."

One row per thing your story asserts, naming the asset underneath it. This is
how far a tool can carry the red-flag rule above: it can tell you that a claim
rests on an asset you never wrote down. It cannot tell you whether a claim about
an asset you do have is true, and it does not pretend to.

| claim | asset |
|---|---|
| every arrival is timestamped at the gate, so detention stops being an argument | gate-clock arrival capture |
| you keep the TMS you have | TMS-agnostic dock calendar |
| the dock supervisor opens a browser tab and nothing else changes | browser-only dock view |
| we ran docks before we built software for them | freight-operator founding team |
| priced under the detention a single terminal absorbs in a quarter | quarterly detention benchmark |

## Step seven — test it before you adopt it

> "Before committing to one position or the other, it is wise to test it with
> your actual target audience before blasting it throughout all of the channels."

Two landing pages, one value proposition and USP set each, ads driving a
meaningful sample to each variation. The book's bar is **at least 50 conversions
from the landing page**, and a clear enough winner usually appears within a week.

Log what you saw against decision 05, citing the segment you picked:

```
gtm evidence add --decision 05 --observation "..." \
  --method marketing-test --grade C4 --date YYYY-MM-DD --segment "<your segment>"
```

`gtm gate 05` reads that row. It does not count your conversions — see
`gtm gate 05` for why, and for what it does check instead.

## Step eight — make it practical

Once the position is tested, turn it into a checklist per department, so the
question is asked before anything ships rather than after. The book's example,
for marketing: does the post talk about the importance of accountability and
following up? Does it show how simple our product is to use? Does it talk to
small businesses? The same checklist can be made for sales and for development.

That checklist is yours to write and lives outside this tool.
