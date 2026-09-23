*Part of the NobleSee specification. `CLAUDE.md` is the entry point;
this file is the credit economy. It records decisions, not structure.*

# 5.2 Credits

A book's price is derived from the length of its master and stored on
the book, so what a reader was charged is a recorded fact rather than a
re-derivation that could change under them.

**Credits pay for taking a book away** — sending it to a device. They
never pay for reading. The online reader is free, unlimited and needs no
account, which is not a generosity setting but the product thesis: a
reader who cannot afford a credit must still get every word. Reading and
artifact access are two separate rules for exactly this reason — the
first deliberately stops before the account requirement the second
enforces.

- New accounts start with a balance, so a reader can send something
  before deciding anything.
- A month in which the reader signs in is worth more than a month away,
  but **being away is not punished** — an absent month still accrues.
- **The first delivery of a book buys it**, at the book's price; every
  later delivery is a small fixed charge, confirmed before it is spent.
  That charge is what bounds how fast an account can drain the library,
  and it replaced a rolling delivery cap.
- **A reader's own upload is free to send.** It is their book.

**Accrual is lazy and has no scheduled job behind it.** A sign-in always
grants for its own month, so a month with no grant recorded is by
construction a month with no sign-in and can be paid the away rate on
sight. Backlog is capped so a reader returning after years does not
arrive to a windfall.

**The balance lives on the user and the ledger is the account of how it
got there.** The duplication is deliberate: summing a ledger on D1 for
every delivery decision would be a table scan per request. Exactly one
module may move a balance, and it writes both together.

---

# The uploader's share

When a reader spends credits sending someone else's upload, the uploader
earns **66%**, whatever cleared the book for sharing. Until 2026-09-23 a
public-domain text earned 33% and a licensed one 66%; the maintainer set
one rate because the uploader stopped being asked which it is (RIGHTS.md
6.1) — the digitisation is the work being paid for either way. Nothing
else earns: a book that may not be shared publicly earns 0, and a
staff-entered library book has no uploader.

**Shares accumulate in hundredths of a credit.** A third of a one-credit
book is 0.33, so paying whole credits per delivery would pay nothing at
all for every book under four credits, which is most of them. A credit
is paid each time the total crosses a hundred, and the remainder
carries.
