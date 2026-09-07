# Early Customer Profile

The archetype, drawn from evidence rather than assumed.

> "**Visualize**. Now it is show time, Picasso! Not until this point was there
> enough tangible evidence to start crafting a visual representation of your
> target audience." — Maja Voje, *GTM Strategist*, ECP Framework step 4 (p123)

That sentence is why `gtm ecp draw` refuses to create this file before the
picked segment carries C2-or-better evidence. A profile drawn before the
evidence is a persona, and personas without research are "zombies on an office
wall" (p126).

## What this file records

| record | value |
|---|---|
| segment | regional LTL carriers |
| drawn | 2026-04-15 |

## The profile

Every value below is yours to fill. **The tool does not assign an observation to
a field.** A ledger row carries an observation, a method, a grade, a date, a
decision, a proof and a segment — it carries no field tag, so nothing in the
ledger says whether `e4` is about motivations or about preferred channel, and a
tool that guessed would be inventing. Fill each field from a named row in the
evidence table at the bottom, or leave the `TODO` standing. A field still marked
`TODO` is an honest gap; a field filled from memory is the thing this whole
instrument exists to refuse.

`weight` is the source's own B2B column from the ECP element table (p123-124).
The last four rows are step 3 of the framework, *Dive deeper* (p123): how they
first heard about a solution, how they solve the problem today, what is
insufficient about that, and what the promised land looks like.

| field | weight | value |
|---|---|---|
| demographic data | assumptions-will-do | US regional LTL carrier, 20-80 doors, 40-300 tractors, one to four terminals |
| job and functions | useful | terminal operations manager, owns dock throughput and driver turn time (e2) |
| motivations and goals | critical | cut average driver turn time and stop eating detention the carrier could have billed (e2) |
| problems and frustrations | critical | two drivers arrive for one door and nobody can say when the trailer actually landed (e2) |
| dependencies in the purchasing process (DMU) | critical | ops manager recommends, VP of operations signs, IT is consulted and rarely blocks (e4) |
| how they measure their success | critical | average dock turn time in minutes, and detention dollars billed versus absorbed (e3) |
| preferred technologies | critical | whatever the existing TMS will hand data to; a browser tab on the dock office desktop |
| brands they like and trust | useful | their TMS vendor, and the two carriers a size above them that they benchmark against |
| influencers | useful | the dock supervisor who would have to use it, and their regional trucking association |
| preferred channel | critical | direct outbound to the ops manager, then a live walkthrough on their own dock data |
| channel they first heard through | critical | trade association newsletter and word of mouth between terminal managers (e2) |
| current alternative | critical | a shared spreadsheet plus a phone tree run by the dock supervisor |
| what is insufficient about it | critical | it records nothing timestamped, so detention cannot be proved after the fact (e2) |
| the promised land | critical | every appointment timestamped on arrival, and detention billed automatically |

## Anti persona

Patrick Campbell's addition to the framework (p124): the segment that looks like
revenue and is bad for the business, defined with the same rigour as the profile
itself. His own row reads $100M+ revenue, procurement-driven, heavy discounts,
NPS -25. Defining it is half of what a profile is for, because it lets you score
an account OUT.

| anti | value |
|---|---|
| who they are | national parcel hubs, 500+ doors, procurement-driven |
| why they look like revenue | the door count makes the seat maths look enormous on a first pass |
| what goes wrong | they need yard-management depth we do not have, buy through a 9-month RFP, and demand custom EDI work that would consume the roadmap |

## The evidence this stands on

Every valid ledger row citing this segment, written in when the archetype was
drawn. This is the provenance the tool CAN fill, and it is what makes a field
auditable: a reader can ask which row a value came from, which is the thing a
poster on a wall never lets you do.

Rows logged after the draw are not added here. Reread them with `gtm status` and
update this file by hand — step 6 of the framework (*Elaborate*) makes the ECP a
living document, and the tool never overwrites your edits.

| id | grade | method | date | observation |
|---|---|---|---|---|
| e4 | C4 | presale | 2026-04-02 | four terminal managers at regional LTL carriers signed a paid pilot order form |
| e3 | C2 | survey | 2026-03-30 | a 61-respondent survey of terminal managers put dock double-booking in their top two operational costs |
| e2 | C1 | interview | 2026-03-24 | eleven dispatchers walked us through their dock spreadsheet unprompted |
