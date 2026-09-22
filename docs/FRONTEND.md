*Part of the NobleSee specification. `CLAUDE.md` is the entry point;
this file is the public site and the reading experience. It records
decisions, not structure.*

# FRONTEND

Next.js App Router, React and TypeScript, with Payload embedded. Next is
required by Payload 3 and gives server-side and static rendering where
each page needs it — the catalog and book pages are read-mostly and
should not ship a client-side app to render text.

Required: responsive mobile-first design; clean typography, including
Chinese; book, blog and archive layouts; accessibility; performance; an
excellent reflowable reading experience.

**Do NOT put business logic in the frontend.** Rights checks, delivery
authorization and credit accounting are enforced server-side; the
frontend renders what the API permits and must never be the only thing
standing between a reader and a restricted file.

Prefer server components, with client components only where interaction
genuinely requires them. **The in-browser reader is the one place
meaningful client-side JavaScript is justified.**

**A book's name goes to the book, not to the reader.** Catalog tiles and
lines always link to the book page — the one carrying the cover,
description, rights, price and send control, which is what a reader
decides with. Reading is a choice made there.

**The format chips are how that choice is made**, so a book with both a
reflowable edition and a fixed one can be read either way. A requested
format is honoured when the book has it and the reader may open it, and
otherwise falls back to the best edition rather than refusing; the
choice is threaded through the authorization so the bytes served match
the reader that opened. A reader who edits it to something absent gets
the best edition, never someone else's file.

**Their order is `FORMAT_DISPLAY_ORDER` in `domain/conversion.ts`** —
pdf, txt, docx, epub — and it is a fixed list rather than whatever order
the artifacts were written in, so the same book offers the same chips in
the same place on every screen that shows them. A format missing from
the list sorts last; it used to sort first, because an unranked format
scored -1.

**`/books` shows the whole shelf tree, so it must ask for the whole
catalog.** One query feeds every shelf on that page, and the catalog is
sorted globally by order id, so a page-sized limit does not cut the
bottom shelf off — it cuts the tail off *every* shelf at once. That is
what a default `limit` of 48 did: nine volumes of 南怀瑾选集 rendered as
six, and five other shelves lost their tails with no sign that anything
was missing. `getCatalog` therefore takes a required `limit`, so the
home page's 48 reads as the preview it is and `/books` asks for
`CATALOG_LIMIT`. A caller that wants a page of the catalog must say so.

**A search result opens in a new tab, and any other link clears the
box.** The two halves are one rule: the box holds what the reader is
looking for, so it survives exactly as long as the looking does. A
result is opened *out of* the search, leaving the query and the rest of
the matches where they were, because the next result is usually the one
they wanted. Anything else — a shelf in the sidebar, a title in the
nav, the brand — is the reader leaving the search behind, and the field
is emptied on the click rather than after the new page renders, so the
old query is never left sitting over a page that is not its answer. The
listener reads the anchor the browser is about to follow and stands
aside for the clicks that do not navigate this window: a modified click,
a middle click, a `target`, a `download`, a bare fragment.

**Search answers with books, over title, author and shelf name.** A
reader looking for 南怀瑾选集 is as likely to type the shelf's name as a
volume's, and a shelf that matched but returned nothing would read as an
empty library. Naming a shelf therefore returns **its whole subtree** —
the same rule as narrowing to that shelf, because the children are not
on screen to answer for themselves — and the shelf itself is never a
result: there is no second kind of row, only the books. Matching runs on
the query as typed, so `search.ts` stays a pure rule the catalog query
and the editorial tree both call, one filtering in SQL and the other in
the page.
