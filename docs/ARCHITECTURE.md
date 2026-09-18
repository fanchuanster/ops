*Part of the NobleSee specification. `CLAUDE.md` is the entry point;
this file is the shape of the system and how a book moves through it.
It records decisions, not structure — the structure is in the code.*

# 3. ARCHITECTURE

## OCR is an HTTP call

A scanned PDF becomes a DOCX master through **Adobe PDF Services**. The
reason is not OCR quality: OCR cannot run on a Worker, so calling a
hosted service turns that compute into a request — and Adobe does the
reading *and* the mastering in one call, which is the whole of phase 1.

That collapse deletes work rather than adding it. There is no OCR
handoff document to slice back into pages. Running heads and folios land
in Word's header and footer parts, which the DOCX reader does not walk,
so they are excluded by *where they are* rather than by inferring
position across the book. Headings come back as Word heading styles,
which the reader already had to map.

The cost, plainly: Adobe's structure detection is unauditable. When it
decides wrongly there is no threshold to tune, only a master to correct.
That is the intended repair, at the price of a human's time.

Traditional Chinese is this library's centre of gravity and is read as
traditional Chinese rather than through a simplified model. Mixed
Chinese/English goes under the CJK locale deliberately: Latin script
reads well under a CJK locale and the reverse does not, so the
asymmetric failure decides it. Footnotes do not survive reliably and are
not claimed to.

**Two limits, and they agree on purpose.** Adobe refuses a file over
100 MB; Cloudflare caps a request body at the same size on our plan. The
portal's ceiling is therefore the same number, and a file the portal
accepts is a file Adobe will read. It took streaming the upload straight
into R2 to get there — a form parse would have made Worker memory the
binding constraint instead. Raising it further means a Business plan
*and* an answer for scans Adobe refuses, which is a product decision.

Billing is per document transaction, one per 50 pages, so a 400-page
book costs eight of them. An Acrobat Pro subscription is **not** these
credentials — PDF Services is a separate product with its own free tier.
With the credentials unset the export stages do not run at all, so the
Worker deploys fine ahead of them.

## Failing twice for different reasons

Adobe reports a file it cannot read and a service that was busy the same
way, and the pipeline must tell them apart: the first fails identically
every time, the second fails a perfectly good file. A recognised
transient failure returns the book to the queue and the next tick sends
it again. Three rules bound that:

- **Recognised transience only.** An unfamiliar message fails the book.
  Failing one that would have succeeded costs a click; retrying one that
  never can costs transactions for ever.
- **Two automatic retries**, counted on the book, since every submission
  is billed.
- **A person pressing Try again starts a fresh budget.** An automatic
  retry is the pipeline guessing; a manual one is somebody deciding.

A transient fault while *polling* is different: the export is untouched
and its handle still good, so the book waits and the next tick asks
again. Requeueing there would discard a running export and pay twice.

## Two phases, joined at the master

    Phase 1   original → DOCX master        expensive, run once
    Phase 2   DOCX master → EPUB            cheap, run whenever

The split is what makes "the master is the source of truth" mean
something: a corrected master re-enters phase 2 and never phase 1.
Re-running phase 1 would pay to re-read pages already read and discard
the correction that prompted it.

Every rule following from the split is a pure function rather than a
condition in a route. Where a failure restarts from is keyed on whether
a master artifact exists rather than on the recorded state, because the
state is what a failure loses and the artifact is what survived.

**Phase 2 does not wait for review.** Two reasons, both only visible
from outside. What a reviewer reads is the finished edition, so holding
the EPUB until after review leaves them a DOCX and an act of
imagination. And a private book is never submitted at all, so gating
conversion on review means the one reader entitled to it cannot read it
either.

Review still decides publication: an owned book cannot become public
without an approved review *and* rights that permit distribution.
Building an EPUB is not publishing it — a converted private upload is
readable by its owner alone. Reviewing therefore means reading the book
in the ordinary reader.

## Four sources, and what each one needs

    PDF    the owner chooses: read it into a master and build the EPUB,
           or publish the file exactly as it stands
    text   the owner chooses: build a master and an EPUB from it,
           or publish the text exactly as it stands
    DOCX   already the master — build the EPUB
    EPUB   already the edition — nothing is converted

**Two of the four get a choice**, being the two where converting buys
something an uploader might decline. For a PDF the trade is sharp: a
scan must be read before it can reflow, which costs money and time and
can go wrong, while a born-digital PDF may already be fine. For text the
words already reflow, and what converting adds is *structure* —
chapters, a contents list, a navigable EPUB — worth offering rather than
imposing. DOCX and EPUB have one sensible path each, so their owners are
*told* what will happen rather than asked to pick from a list of one.

**The default is to publish as it stands.** Converting is the expensive
path and was being taken on behalf of someone who had so far only chosen
a file. The fast default is safe because it cannot be regretted: the
original is always kept, while a reader who wanted their book today
cannot un-wait for a conversion they did not ask for. The mission is
served by offering the option plainly on the same screen with the cost
of skipping it said out loud.

Publishing a *PDF* as it stands means a fixed-layout book and no EPUB, a
real cost against the mission — so that decision stays reversible:
switching to converted re-queues the book and charges the conversion to
the month it actually happens in. Only in that direction. A converted
book set back to as-it-stands is a metadata change, not a request to
delete an EPUB somebody may already have been sent.

## A book can hold more than one source

A book may hold a source of each kind at once — the scan *and* a
transcription — and **which one the master is built from is its owner's
choice**, changeable after they have seen how the first attempt turned
out. The case is ordinary: a Chinese classic often circulates as both.
Adobe reading the scan costs a transaction, takes minutes and gets
characters wrong; the transcription is free, instant and already right —
but may be abridged or from another edition, and only the person holding
both can tell.

- **One source per artifact slot**, because objects are named by format
  and two PDFs would compete for one name. A slot filled by a
  *generated* edition is refused too: accepting there would overwrite
  what readers already have.
- **A reading edition is never a master source.** Parsing one back into
  a master and rendering it forward again can only lose.
- **Adding is free; choosing is not.** Uploading another file costs no
  quota and starts nothing. Choosing it re-enters phase 1 at full price.

Nothing is deleted by switching, so the decision is reversible for the
price of another conversion. Books that predate multiple sources have a
single real source and are synthesized into the same shape, which is why
nothing was migrated.

## Everything slow is queued

There is no synchronous conversion. The book's own state *is* the queue
and the status: a worker claims a book, does the work and reports back
while the owner watches the state change. A book with nothing to convert
still passes through the queue — filed by the same tick, just without a
job at the end of it.

Phase 2 builds everything the source can give on the first run, and when
a book already has formats, every one is rebuilt. That is a master edit,
and regenerating only what is missing would leave the existing edition
carrying the errors the edit removed.
