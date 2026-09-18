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
