# Search-engine visibility for the library

**Status:** proposed, not built
**Written:** 2026-08-24

## The story

> As a reader looking for a book I cannot find in a readable form, I want
> NobleSee's edition to be what a search engine shows me, so that I find
> a reflowable EPUB instead of another scanned PDF on a download site.

## Why this, and why now

This is the mission stated as a distribution problem. CLAUDE.md's first
section says NobleSee exists to find books that are hard to access in
e-reader-friendly form and make them pleasant to read. A book nobody can
find is not accessible, whatever its EPUB is like — and the competition
for these searches is exactly the download sites whose slogans keep
turning up in our own uploads' PDF metadata.

Two things make the current state worse than "not optimised":

- **Book URLs carry other people's advertising.** A slug is minted from
  the title at upload and never regenerated. Books published from scans
  whose Info dictionary held a download site's slogan have URLs like
  `/read/北斗成功社区-来者有缘-共铸成功-17d10511`. That is the canonical
  URL a search engine indexes and a reader sees.
- **The catalog page ships every field of every book to the browser.**
  `/books` hands whole Payload documents to a client component, so the
  serialised payload includes `review.note`, `conversion.sourceKey`,
  artifact storage keys and rights status. That is a privacy problem in
  its own right, and it is also several hundred kilobytes of noise in
  what a crawler reads.

## Acceptance criteria

1. Every book page has a title, description and canonical URL derived
   from the book, and a slug that reads as the book's name.
2. Book pages carry structured data (`schema.org/Book`) with title,
   author, language, and — where the rights permit — an indication that
   a free reading edition exists.
3. Correcting a title offers to correct the slug, with the old URL
   redirecting permanently rather than breaking.
4. A sitemap lists every publicly distributable book and collection, and
   is regenerated when the catalog changes.
5. `robots.txt` allows the catalog and the reader, and disallows
   `/admin`, `/cms`, `/account` and every artifact path.
6. Nothing private is indexable: a book with `visibility: private` must
   not appear in the sitemap, must not be rendered to an anonymous
   crawler, and must not leak through a populated relationship.
7. Catalog and book pages send only the fields they render.
8. Chinese-language pages declare their language correctly, including
   the Simplified/Traditional distinction, so a search engine does not
   serve a Traditional edition to a Simplified query and call it a match.

## Constraints that shape the design

**Indexing must follow the rights model, not the other way round.** A
book that is `user_owned` or `restricted` is not distributable, and
making the library more findable must not make one such book findable.
Criterion 6 is the one to test first, because it is the one where being
good at this is actively harmful if it is wrong.

**The reading experience is the product, so it is also the page.** The
temptation with SEO is to build thin landing pages full of keywords in
front of the real thing. CLAUDE.md is explicit that a landing page with
a "Read online" button was already removed once as a turnstile. Whatever
this does, a book's URL keeps opening the book.

**Server-rendered already, and should stay that way.** The catalog and
book pages are server components — the hard part of this is already
done. Criterion 7 is mostly a matter of projecting each book down to the
fields the tile actually needs before it crosses into a client
component, which is the same fix the privacy problem above needs.

## Out of scope

Paid acquisition, backlink building, keyword pages, AMP, and any content
generated for crawlers rather than for readers.

## Open questions

- Slug correction (criterion 3) needs a decision about redirects: a
  `slugHistory` array on the book and a lookup fallback, or a separate
  redirects collection. The first is simpler and keeps the history with
  the thing it belongs to.
- Whether `NEXT_PUBLIC_SERVER_URL` is reliable enough to build canonical
  URLs from in every deploy environment, or whether the request host
  should win.
- Sitemap regeneration: on-demand at request time is simplest on a
  Worker and costs one indexed query; a cached file needs invalidating
  from four different write paths.
