*Part of the NobleSee specification. `CLAUDE.md` is the entry point;
this file is rights status, the conversion portal and what may be
published. It records decisions, not structure.*

# 6. RIGHTS MANAGEMENT

Every book carries the legal status of its material: public domain,
licensed, permission granted, user-owned, restricted, or unknown.

Do not build anything that assumes an uploaded or scanned book can
legally be redistributed. Public distribution requires an appropriate
status, and the portal distinguishes public library content from
user-owned private content. **Private uploads never become public
automatically.**

## 6.1 The conversion portal

A converted book gets everything the library offers — a reading edition,
delivery to a device, the online reader — with no second-class path. A
book published as it stands is the deliberate exception: its owner chose
a faithful copy over a reflowable one, and it is still delivered, still
read from the book page, still theirs.

Such a book is **private by default** and may stay so forever.
Publishing takes two independent approvals: an administrator approves
the submission, **and** the rights status permits public distribution.

The second is not a formality the first can wave through. An admin
approving says "this belongs in the library", not "this is legally
distributable" — a reader owning a copy confers no right to publish it
to everyone else. Unknown rights block submission entirely: the uploader
is the only person who knows where their material came from, and that is
the one moment in the flow when the question is easy to answer.

**Two questions, not two buttons.** Approving publishes, in the same
act. Separating them produced a state nobody could explain to an
uploader — an "Approved" chip on a book still invisible to every reader.
So the rights gate sits *in front* of the approval: a submission whose
rights do not permit distribution cannot be approved at all, and the
queue disables the control rather than offering a button that would be
refused. The check reads the review state **as stored** rather than the
approval it is about to write, or the never-offered gate would find
every book offered. The same rule is enforced again on the write itself,
which is what covers every writer including the API. An administrator
publishing their own upload is refused exactly as a reader would be.

A third thing is easy to mistake for the first: **the uploader offering
the book**. The approval is an administrator's to give early; the offer
is not theirs at all. A private upload never submitted stays private
whoever is asking — unless the administrator is its uploader, in which
case they are both parties and their submission publishes itself.

**Who uploaded a book is not public.** Ownership is readable by its
owner and an administrator and nobody else, enforced as field-level read
access so it is absent from the UI, from a populated relationship and
from the API alike. The uploader's *identity* was always protected; what
this closes is the correlation that a given set of books shares an
uploader. Field access is skipped when access is overridden, which is
how every internal ownership check still reads it.

Rights status and reading level are administrator fields — an uploader
who could set their own would walk their upload into the front of the
library.

There is no stored "public" flag. Whether a book is in the public
catalog is computed from what is already there: `status` reaching
`published`, and, if it has an owner, `review.state` having reached
`approved`. An ownerless, staff-entered library book needs nothing more
than `published` — there is no uploader to review. `domain/moderation.ts`
exports this as `isInPublicLibrary`; every reader-facing screen and the
`books` collection's own read access call it rather than re-deriving it,
so "public" cannot drift out of step with "approved".

### Tell the uploader who else will see their file

Reading a scan *is* a third-party call, so forbidding the send outright
would ban the portal's main path — and it would be a protection the
person being protected never saw, could not weigh and could not consent
to. The disclosure sits inside the option that does the sending, so it
is read while the choice is being made and cannot drift onto the wrong
option.

**The two sends are two decisions, because they are two services.** The
OCR service reads a scan's pages and there is no converting a scan
without it, so it is chosen by choosing to convert. AI correction is
separate and optional, off unless asked for. A DOCX or plain text upload
can therefore be converted with **nothing leaving NobleSee**, and the
screen says exactly that.

Three things make disclosure sufficient rather than a shrug: there is
always a private alternative and it is the **default**; the choice is
the owner's, because who may hold a copy of your own book is not a claim
about the library; and a book already sent cannot be un-sent, which is
why sending must be chosen deliberately rather than arrived at.

## 6.2 What the portal actually does

**Upload asks for the file and nothing else.** Title, author, language
and length are read out of it and shown on an editable summary page.
Asking someone to retype what their file already says is friction that
stops uploads happening.

Extraction is harder than it sounds, and the difficulty is all encoding.
A PDF's metadata carries no declared encoding, so the bytes may be
UTF-16, UTF-8, GBK or Big5. UTF-8 and a byte-order mark are
self-describing; GBK and Big5 are told apart by whether the result reads
as real Chinese, which needs a **common-character check rather than a
CJK-range check** — "München" contains a legal GBK pair for a real but
unused character. Two ordering rules are load-bearing: **decode before
tidying whitespace**, because a legitimate character's low byte can be a
carriage return; and **decode self-describing fields individually**,
because joining UTF-16 fields misaligns everything after the join.

When a file carries no title, the **filename is the last source**, with
a leading or trailing run of digits stripped — a book from an archive
mirror arrives named for its catalogue numbers, and proposing that whole
string is worse than proposing nothing, since it is then the one field
the uploader must delete by hand. Two rules keep it from eating real
titles: **one run from each edge, not repeatedly**, because past that it
stops cleaning an edge and starts guessing where a title ends; and **a
name is judged before it is stripped**, since stripping first can leave
a fragment that reads like a title and is not one.

**A file that arrives half-written is refused, at intake.** The stored
object's tail is checked for the marker saying the file ends where it
claims. Plain text has no such marker and is not checked, because any
prefix of a text file still reads.

This is not imagined. A book was once stored as a clean prefix of a scan
and published as a whole book: the browser declared the short length and
sent exactly that many bytes, so the guard against a body that stops
early was satisfied. Extraction could not catch it either — it reads the
first and last stretch of the file, and the page count sits in the
first, so the book arrived priced and paginated for twice the pages it
held. The first thing that actually failed was a cover, minutes later,
in somebody's browser. **The check belongs where the damage enters**,
which is also why it is one read of a tail we are fetching anyway, and a
refusal rather than a repair.

A book then sits as a **draft**: private, owned, not converted, not
submitted. The draft is a workspace, not a form — it can be read, its
master downloaded, corrected and re-uploaded, and it can be deleted.

**Several files can arrive together and become one book.** Which goes
first is the whole rule: a Word file *is* the master, and the file that
creates the book is the one the master is built from; then the scan,
because a scan is the book; then text, then a reading edition. Nothing
is lost by arriving this way, since which source the master comes from
stays changeable afterwards.

A duplicate kind is refused **before anything is sent**, naming the file
— finding out after uploading 90 MB is the wrong moment. That question
is asked of the book's recorded sources rather than its filed originals:
a book whose first upload has not been filed yet has no originals, so
for the minute between upload and the next tick every slot would read as
empty, and two files sent in that window would both be accepted with the
first left where uploads are swept.

A book can also gain **another file later**, and the panel offering that
sits on the book's own page rather than on the upload form. The form
confirms what a book *is*, once, before anything has happened to it,
while this is a decision its owner takes with the results in front of
them — they have read what the OCR made of the scan and now want the
master built from the transcription instead. On the form the question
would be asked at the one moment there is no evidence to answer it with.

**Its owner can always delete it, and so can an administrator.**
Ownership is the only gate; an administrator may withdraw any book,
which is the one act on the library screen that needs no ownership.
Deleting a book others have spent credits on does break the promise that
an entitlement never expires, and that is the reason not to do it
casually — but as a *rule* it produced a book nobody at all could take
down, which is wrong for material that has to come down. The judgement
is the person's rather than the function's.

**Submitting for review is a separate, optional act on a finished
book**, because asking someone to decide about publication before they
have seen a converted page is asking them to guess.

### Conversion quota

A few books and a page budget per month, administrators unlimited.
**Counted at conversion, not upload**: a draft costs nothing, so a
refused conversion leaves it to convert next month rather than being
thrown away. The page rule is "would this take the total past the
limit", not "is there any room left".

The quota needs a page count before anything is rendered, which is
circular — so it runs on an estimate read from the file, and the exact
count replaces it once conversion finishes.
