*Part of the NobleSee specification. `CLAUDE.md` is the entry point;
this file is the book model, covers, reading levels and how the library
is shelved. It records decisions, not structure.*

# 5. BOOK DOMAIN MODEL

**A book has one title**, in whatever script it is in; a translated
edition says so in its description. Two fields for one book's name is a
question every editor answers twice and a fallback every tile and search
has to carry, and extraction can fill neither a second title nor a
translator — they were boxes only an editor could type into.

**A book is whole**: one record, one master, one set of generated
formats. It is not split into separately released parts.

**The original is always kept, and it is always one of the book's own
formats** — a PDF upload *is* the book's PDF, a DOCX *is* its master, an
EPUB *is* its edition, a text upload *is* its text. That is what makes
"always keep the original" cost nothing rather than doubling every book,
and it is also the whole constraint on holding several originals
(ARCHITECTURE.md 3): one per kind, because a second would want the same
name.

Which source the master is built from is recorded, not inferred. The
formats a book holds cannot answer it — a DOCX is sometimes an upload
and sometimes the OCR result, an EPUB sometimes an upload and sometimes
generated — and a rule right for half the formats is worse than no rule.

**The DOCX master is the source of truth.** Reader-facing formats are
generated from the approved master. Do NOT use PDF as the canonical
source.

## Covers

A book with no uploaded cover gets **a page of itself**. For a scan that
page *is* the cover the publisher printed, which is why the PDF is
preferred over an EPUB's declared image. An uploaded cover is a
deliberate choice and always wins; a rendered one is only ever the
default; with neither, the tile draws the book's own first character.

**The first three pages are rendered and the book records which it
wears**, because the page the cover was printed on is often not the
first leaf a scanner fed — a blank verso, a library stamp, a half-title.
Past a leaf or two it stops being "which of these is the cover" and
becomes browsing the book. A reading edition has one declared image and
no pages, so it has one candidate and no choice. Rendering happens
**once**, since the same pages produce the same pictures; making a cover
is offered only while nothing has been rendered, which still covers a
render that failed.

**Uploading the image and choosing the page belong to the owner or an
administrator** — the one place uploader and editors have equal power. A
cover is not a claim about the book, only which photograph of it looks
right, and the person holding the physical copy is at least as well
placed to say. Everything else on that boundary stays asymmetric: rights
and visibility are the administrator's, the bibliographic fields the
uploader's.

Covers are served through the same door as everything else, behind the
book's own access rule. The media collection itself is
administrators-only: it was readable by all, which was survivable while
only administrators uploaded and became a hole the moment an owner could
upload for a private draft, since the file sat under whatever the
uploader called it and `cover.jpg` is not a secret.

**The rendering happens in the browser**, on the machine that already
has the file open — the uploader's, between the upload finishing and the
draft page loading, or an editor's, reading the source back for a book
already in the library. The renderers are dynamically imported, so a
reader who never uploads downloads neither. The Worker was never a
candidate: a PDF renderer is a megabyte of JavaScript against a bundle
near its limit, and rasterizing is CPU-shaped work.

Two costs. There is **no DOCX renderer in a browser**, so a book whose
only artifact is a master has no cover until a PDF exists. And making a
cover for an existing book means **downloading the book**, which for a
60 MB scan is a real wait, so the button says so. When it fails, the
screen distinguishes a file that could not be opened at all — possibly
incomplete — from one that opened and yielded no page; that difference
was for a long time the only symptom a truncated upload produced
(RIGHTS.md 6.2).

## 5.1 Reading levels

Every book is **essential**, **normal** or **extensive**, nesting so a
reader sees their level and everything shallower.

Levels are stored and compared as **ordered ids, never names**, so a
reader's view is one indexed comparison in the catalog query. The ids
are spaced: a level added later between two existing ones needs no
stored row rewritten.

**This is curation, not access control.** A reader chooses their own
level and can raise it at any time, so the deepest level is always one
click away. Rights, ownership and the credit price are the access rules,
enforced independently, and nothing about levels may ever be relied on
to keep a reader away from anything. The purpose is the mission's low
visual distraction: start with the core, open up the tail on request.

Level is an administrator field. **An upload arrives at normal**, not
the tail — what keeps an unreviewed upload out of the browse view is its
privacy, and landing it in the tail only meant an approved book stayed
there unless somebody remembered to move it.

A whole shelf can be levelled at once, in two modes: as a **cap**, which
can only move a book shallower and leaves a curated one alone, or
**exactly**, which overwrites. Cap is offered first. A shelf stores no
level of its own — this is an act performed on books, not an attribute a
book filed there later would inherit.

## 5.3 Collections nest

A shelf can stand on another shelf, and **a parent carries everything
beneath it**. Anything less and nesting is only filing.

- A collection may not be its own ancestor. Enforced in a hook, not only
  in the admin screen, because the API is another door and a ring would
  strand every shelf in it.
- **Three levels deep at most**, counting a moved subtree's own height.
  The limit is editorial: past a grandchild a reader is navigating a
  filesystem rather than browsing a library.
- A parent that no longer exists reads as a root, so deleting a shelf
  never makes its children vanish.

**The browse page shows the whole tree at once, folded.** Drilling down
one level at a time hid the library behind a click and made a reader
guess which shelf was worth opening, which is the opposite of browsing.
Two things keep that page from becoming an application: a shelf is still
a URL, which is what a reader shares; and only the fold is client-side,
because a level is a *view* someone would send to someone else where a
fold is a per-reader convenience.

Each shelf renders the books filed **directly** on it, so nothing is
printed twice — a different rule from narrowing to one shelf, where a
parent genuinely answers with its whole subtree because its children are
not on screen to answer for themselves.

## 5.4 Two orders, on every shelf

Books on a shelf read alphabetically or in a sequence the shelf carries.
**The shelf decides, not the reader**, and the default is alphabetical:
an uncurated library reads A–Z, which a reader can predict and scan. A
curator switches one shelf to sequence when its contents have an order
of their own — a ten-volume set, a reading path — and only that shelf
changes.

**Where a shelf stands among its siblings is the admin's**, set by the
reorder arrows and never re-sorted afterwards; the public library
renders the tree in exactly the order the editorial tree shows.

**There is no reader-facing sort toggle.** Alphabetical is what you want
when *looking for* a book, and that is what search is for. How the
library reads is an editorial judgement about where a reader should
start, and a control that overrules every shelf at once hands back the
curation the library exists to provide.

The sequence is **a number the item carries**, not a position in a list:
handed out one past the highest on the shelf when the item is filed, and
editable. It **need not be unique** — two books may share a number and
read alphabetically between themselves, so setting one writes a single
row and moves nothing else. It **need not be contiguous** either;
closing a gap would move books nobody touched.

Ordering happens **per shelf, in the page**, not in the catalog query,
because one SQL ordering cannot be alphabetical for one shelf and by
number for the next. The editorial tree sorts by the same rule, so an
editor arranging a shelf sees what it actually does.

**Choosing a number is an administrator's; filing is not.** An uploader
picks their book's shelf and the arrival hook gives it the next free
number. This is enforced as field-level write access, not merely by
which screen offers the control: the REST API is another door, and an
unspecified access rule defaults to any logged-in user — so a signed-in
reader could otherwise walk their own upload to the front of a shelf.
The one action that writes with access overridden has to re-check it
itself, since field access is not consulted there.

**A trap in the arrival hooks, because it bit once.** Payload hands a
before-change hook the whole document with the update merged in, so the
order field is *always* present. "The caller stated a number" has to
mean "a number different from the stored one" — reading mere presence as
an instruction made every move to another shelf keep its old number.

An unfiled book has no number at all — off the shelf there is nothing
for it to be a position in — and sorts last.
