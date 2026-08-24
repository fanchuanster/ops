# Visit statistics for administrators

**Status:** proposed, not built
**Written:** 2026-08-24

## The story

> As an administrator, I want to see which books and pages readers
> actually open, so that I can decide what to digitise next and tell
> whether the library is being read at all.

## Why this, and why now

NobleSee currently records exactly one thing a reader does: a delivery
to an e-reader, in the `downloads` ledger, because it costs credits and
an entitlement has to be durable. That number is on the admin's Library
screen as **Sent**.

It is the wrong number for this question, and it is the only one we
have. Reading online is free, unlimited, and needs no account — that is
the product thesis in CLAUDE.md 5.2 — so the books that are being *read
the most* are precisely the ones that generate no ledger row at all. An
editor deciding what to OCR next is currently choosing between titles on
the strength of a metric that measures the one behaviour the mission
says is secondary.

## Acceptance criteria

1. An administrator can see, for any book, how many times its reader was
   opened and over what period.
2. The Library screen can be sorted by that number, so "what is being
   read" is one click rather than a mental join.
3. Catalog and collection pages carry the same count, so an editor can
   tell a shelf nobody opens from a shelf with nothing on it.
4. A visit is counted once per reader per book per day, not once per
   page turn. The question is "is this being read", not "how fast".
5. Counting never blocks a reader's request, and a failure to count
   never fails a page.
6. Nothing personally identifying is stored — see Constraints.

## Constraints that shape the design

**No identifiers, and this is not negotiable.** CLAUDE.md 6.1 already
treats *who uploaded a book* as private enough to hide behind field-level
access. What a named person reads is a great deal more sensitive than
that, especially for a library of religious, philosophical and
politically-inflected Chinese texts, and especially for readers in
jurisdictions where some of this material is not neutral. Store counts,
not visits. No IP addresses at rest, no user ids on a view row, no
per-reader history — and therefore no "readers who liked this" feature
downstream, which is the thing that would quietly reintroduce all of it.
Deduplication per criterion 4 needs a per-day salted hash that is never
written down, not a stored identifier.

**A Worker is billed on CPU and D1 on rows written.** A write per page
view turns every catalog visit into a database round trip on the request
path. The counter must be aggregated — a daily bucket per book, written
by a background task, or an increment through a durable counter — and
the read path must never wait for it.

**No third-party analytics.** Nothing that ships reader behaviour to
Google, Plausible-hosted, or anyone else. The same reasoning that keeps
private uploads away from a third-party LLM (CLAUDE.md 6.1) applies with
more force to reading history. Cloudflare Web Analytics is already in the
account and privacy-preserving, but it reports on URLs rather than on
domain objects — worth using for traffic shape, not sufficient for
criteria 1–3.

## Out of scope

Per-reader reading history, recommendations, funnels, A/B testing,
session replay, real-time dashboards, and any notion of "engagement".
This is a shelf-wear indicator for an editor, not an analytics product.

## Open questions

- Bucket granularity: daily is enough for criteria 1–3 and is the
  cheapest to aggregate. Hourly buys nothing an editor would act on.
- Where the increment happens: a Durable Object counter flushed to D1,
  or `waitUntil` writing a daily row. The second is simpler and loses a
  few counts under contention, which for a shelf-wear number is
  acceptable — worth stating that trade explicitly before building.
- Retention. A count per book per day is small, but "small" times three
  years is a table nobody prunes. Suggest rolling daily rows into
  monthly ones after 90 days.
