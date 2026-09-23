*Part of the NobleSee specification. `CLAUDE.md` is the entry point;
this file is rights status, the upload portal and what may be published.
It records rules and the reasons for them, not structure.*

# 6. RIGHTS MANAGEMENT

Every book carries a rights status: public domain, licensed, permission
granted, user-owned, restricted, or unknown. Only the first three may be
distributed publicly.

Never assume an uploaded book can legally be redistributed. **Private
uploads never become public automatically.**

## 6.1 Publication

A book is in the public library when `status` is `published` and, if it
has an owner, `review.state` is `approved`. That is computed by
`isInPublicLibrary` in `domain/moderation.ts`, and every reader-facing
screen and the `books` read access call it. **There is no stored public
flag.** The `visibility` column dropped from the schema on 2026-09-19
stays dead, because a stored flag is what drifted from approval before.

**Do not restate that rule in a caller's `where`.** The access layer
already applies it, together with the rights check. `owner` is
field-read-restricted, so a caller-supplied `owner` path throws
`QueryError` for anonymous visitors. This took the public site down on
2026-09-20. Pass only what narrows the query further.

Publishing an owned book takes three things:

- **The uploader offers it.** A book never offered stays private,
  whoever is asking. An administrator who uploaded it is both parties,
  so their offer publishes itself.
- **An administrator approves it.** Approving *is* publishing, in one
  act, because a separate "approved but invisible" state could not be
  explained to anyone.
- **Its rights permit distribution.** This gate sits in front of the
  approval, so a book whose rights don't permit distribution cannot be
  approved at all. The queue disables the button, and the write itself
  refuses too, which covers the API. Approval says "this belongs here",
  not "this is legal".

**Offering a book is its rights claim; the uploader is not asked.**
On 2026-09-23 the maintainer removed first the question about where a
book came from, then the "I have the right to share this" checkbox that
replaced it. Offering records `public_domain` (`rightsOnOffer`) unless
the book already has a distributable status, and it **never overrides
`restricted`**, which is an editor's block. An editor sets `licensed`
or `permission_granted` through the API when that is the truth.

**So nobody asserts a book's rights any more, and the editor's approval
is the only check.** The stored default is also `public_domain` (set
2026-09-20, because this catalog is mostly pre-modern texts entered by
the maintainer). A reviewer must therefore never read `public_domain`
as "someone checked". Look at what an owned book actually is before
approving it: a recent commercial title marked `public_domain` is a
mislabelling, not a licence. An administrator's own upload has no check
at all, because their offer publishes itself.

**Rights status, reading level and shelf order are administrator
fields.** An uploader who could set them would walk their own book into
the library.

**Who uploaded a book is not public.** `owner` is readable only by its
owner and administrators, through field-level read access, so it is
absent from the UI, populated relationships and the API.

### Tell the uploader who else will see their file

Sending to a third party is disclosed inside the option that does the
sending, so it is read while the choice is made. There is always a
private alternative, and it is the default.

- **Adobe PDF Services reads a scan's pages** when the owner chooses to
  convert a PDF. It is chosen by choosing to convert.
- **xAI suggests corrections** only when AI correction is switched on,
  which it is not by default. DOCX and plain text convert with nothing
  leaving NobleSee.
- **xAI reads the first page and the uploaded file names on every
  upload**, to fill title, author, language and collection. The upload
  card says so before anything is sent. The **Auto-fill with AI**
  button sends the same things again. This is the one send that is not
  a choice, so **never widen it** past the first page and the file
  names, and never to anything that reads the body.

## 6.2 The upload portal

**Upload asks for the file and nothing else.** Everything else is read
from it and shown on the Process & Review card for the uploader to
correct.

**Where the details come from, strongest first:**

1. xAI's reading of the first page (the rendered cover page, or the
   opening text of a plain-text file) with every uploaded file name and
   the collection tree (PIPELINE.md 4). It runs automatically once, on
   upload. The **Auto-fill with AI** button reruns it at any stage, even
   on an approved, published book, because the owner asks for it. It
   overwrites the fields it reads, and a new title moves a published
   book's address. A suggested collection must be one of the listed
   ids, and a title another book already holds is not taken. It never
   guesses importance level or shelf order: a title page cannot say
   either. With no rendered page (a PDF whose cover render at upload
   failed), the button first renders page one in the browser with
   pdf.js, never on the Worker, which also restores the cover. If that
   fails too, the file names are sent alone rather than skipping the
   call. A call that fails is reported as a failure, never as "nothing
   found". If it fails, what the file gave stands.
2. The file's own metadata. PDF metadata has no declared encoding, so
   GBK and Big5 are told apart with a **common-character check, not a
   CJK-range check**. **Decode before tidying whitespace**, and decode
   self-describing fields individually.
3. The filename, with one run of digits stripped from each edge and no
   more. A name is judged before it is stripped.

**A half-written file is refused at intake**, by checking the stored
object's tail for its end marker. Plain text has no marker and is not
checked. A truncated scan was once published as a whole book, priced for
twice its pages, so the check belongs where the damage enters.

**Several files can make one book.** A Word file is the master; the
file that creates the book is the one the master is built from; then
the scan, then text, then a reading edition. A duplicate kind is refused
before anything is sent, judged against the book's recorded sources.
More files can be added later from the book's own page.

**The Process & Review card ends in submission, not conversion.**
Submit saves the details and **creates the book from its original
file**, using the `as_is` plan where the file kind allows it. Nothing is
sent to Adobe or xAI, and the book is readable at once. A DOCX has only
`convert` and is its own master. Conversion, AI correction and the EPUB
come next, on the book's page, beside their disclosures.

**Visibility on that card is public (the default) or private.** It is
a form field, not stored. Public also offers the book, which for anyone
but an administrator then waits for an editor's approval. Private
creates the book and stops, with no review, visible only to its owner
and administrators. It can be offered later from its page.

**An owner can always delete their book, and so can an administrator.**
Deleting a book others have spent credits on breaks the promise that an
entitlement never expires, so it shouldn't be done casually. But making
it impossible would leave material nobody could take down.

### Conversion quota

A few books and a page budget per month, administrators unlimited.
**Counted when a book leaves draft, not at upload**, so an abandoned
draft costs nothing. The rule is "would this take the total past the
limit", not "is there any room left". Before conversion the count is an
estimate read from the file; the exact count replaces it afterwards.
