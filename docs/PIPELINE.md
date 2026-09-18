*Part of the NobleSee specification. `CLAUDE.md` is the entry point;
this file is OCR, conversion, correction and the formats a book is built
into. It records decisions, not structure.*

# 4. AI INFRASTRUCTURE

The LLM provider is **xAI**, over its OpenAI-compatible HTTP API, with
base URL, model and key all taken from the environment — so pointing the
pipeline at a self-hosted endpoint is configuration, and nothing in it
knows which is answering.

**The default model is the cheap non-reasoning variant.** Measured
against the reasoning model it gave the same corrections on sample lines
at 2.4x cheaper output. Correction is a narrow task over short inputs,
and reasoning tokens are billed as output at twice the input rate —
over a whole book that is the real cost of the stage.

The key is a Worker secret. With it unset, correction fails with a clear
message and nothing else is affected: a book still converts, it just
gets no suggestions.

- The endpoint and key are server-side. A browser never sees either, and
  neither is hard-coded.
- **Whether a reader's upload goes to the provider is the reader's
  decision**, made on the upload screen. It is re-read at the moment of
  sending rather than trusted from when the job was queued, so a reader
  who changes their mind is not overtaken. Unanswered means no.
- Correction is **advisory whatever the answer**: the stage proposes and
  a human disposes (section 7). Consenting to the send is not consenting
  to an edit, and the approver is the book's owner.

---

# 7. AI BOOK PRODUCTION PIPELINE

    Source (DOCX, or scan → OCR → normalization → AI correction)
                            |
                     editable DOCX master
                            |
                      human review
                            |
                     approved DOCX  →  EPUB

The AI must NOT blindly rewrite literary or historical source material.
It assists with OCR correction, punctuation, obvious errors, paragraph
reconstruction, heading detection, structural normalization, metadata
extraction and formatting suggestions. **Preserve original wording.**

Modifications must be auditable. Prefer

    original text + suggested correction + confidence/reason
    + human approval

over silently replacing source content.

---

# 8. OCR

**Settled: Adobe PDF Services**, which reads a scan and returns a DOCX
in one call (ARCHITECTURE.md 3 has the reasoning and the limits).

Keep OCR an abstraction — it has survived two replacements. Every rule
about the engine that is not an HTTP call lives apart from the call
itself, so replacing Adobe means writing a new pair and nothing
downstream of the master would know.

**Nothing reads a PDF locally.** Every PDF goes to Adobe whether or not
it has a text layer, because that is the one call producing a master.
Reading a scan through a text-layer extractor "succeeds" — it returns a
one-page book from the one born-digital title page and drops the other
four hundred.

---

# 9. DOCX GENERATION

The master is what a human corrects and what a corrected book is rebuilt
from, so it must be high-quality and editable, preserving headings,
paragraphs, page breaks, footnotes where possible, emphasis, tables,
Chinese typography and metadata.

Word XML is written and read directly — there is no third-party writer,
since the Worker has no native library. **Do not assume a library is
suitable without testing**: the round trip is tested against a fixture
that must never be regenerated (13).

---

# 10. EPUB

EPUB is the PRIMARY reflowable format, because it lets the reader's
device control font size, margins, line spacing, theme and layout. Do
NOT try to make a PDF behave like a reflowable EPUB. Generate valid
EPUB 3 where practical, and validate what is generated.

---

# 11. PDF

**Nothing renders a PDF. A book has one only when the uploader uploaded
one** — a DOCX, text or EPUB upload gets none.

A PDF's job here is **fidelity to the original**. A book whose original
is a DOCX or text file has no original page to be faithful to, so a
rendered PDF was our own typography frozen flat: strictly worse than the
EPUB beside it, on every device, competing with the reading edition
rather than preserving anything. For a scan, the uploaded file already
gives perfect fidelity and zero rendering time by not trying to improve
on it.

A page count is therefore an estimate rather than a typesetting result,
which is the right shape anyway — a rendered page was always a fact
about our typography rather than about the book.

---

# 12. MOBI / OTHER FORMATS

EPUB is primary. Support MOBI/AZW3 only for a concrete compatibility
reason, and keep the conversion layer open so a new format is one case
and one writer.

There is deliberately **no PDF generator**. A PDF is only ever the
uploaded file (11); it must not grow one back.

---

# 13. THE CONVERSION PIPELINE

**It runs in the Worker. There is no conversion service and no
container.** Rules are pure functions and tested as such; I/O is
separate. The pipeline knows nothing about the frontend.

The diff used by the guardrails is a **port of Python's `difflib`, exact
rather than approximate**, because the guardrails compare a similarity
ratio and an edit count against constants tuned on real OCR output — a
"close enough" diff silently moves where the line between an OCR repair
and a rewrite falls. It is checked against CPython by a fixture
generated from CPython. Everything works on **code points**: Python
strings are code points and classical Chinese reaches past the BMP,
where JavaScript's `.length` would count one character as two.

## The clock

A cron trigger fires every minute, advances the export stages, then
claims and runs **at most one job**. A cron invocation has a bounded CPU
budget, and a loop that kept claiming would spend it all on whichever
book came first and be killed mid-write.

**The claim is a compare-and-swap** on the book's own state, conditional
on the state we found it in. D1 has no row locking and cron invocations
overlap — a slow tick is not cancelled when the next fires — so a plain
read-then-write would run the same job twice, which for a correction job
means paying a third party twice.

**The export handle is released whenever a book re-enters the queue**,
and only then. Phase 1 refuses to start for a book already carrying a
handle, so one book is never sent to Adobe twice; but while only success
cleared it, a book whose export failed afterwards waited for ever with
no message and nothing in the log. Releasing is keyed on the destination
state because a live export is never in the queue: clearing
unconditionally would orphan a job already paid for the moment somebody
corrected a title mid-export.

Cloudflare Queues is not used. It would be a second durable record
beside the book row that can disagree with it, and the book row is
already the durable record of a conversion.

**The cron calls a route rather than doing the work in the scheduled
handler**, because the Worker entry is compiled separately from the
application bundle: importing the pipeline there would pull Payload,
every collection config and the database adapter into a *second* bundle
in a Worker already near the 10 MB limit. The request never leaves the
Worker. That route **fails closed** — with no secret configured it 404s
as though it does not exist, so a Worker deployed ahead of its secret
converts nothing rather than converting for anyone who asks. The
secret's name is historical and deliberately not renamed: renaming means
a secret that has to land before the deploy, and if it does not, the
route fails closed and conversions stop silently.

**Uploading the script does not attach cron triggers.** The schedule
record can exist while nothing ever fires, which is as silent as it
sounds — the site is up, the route answers, and no book converts.
Applying triggers is a separate command, and the deploy script ends with
it.

## Correction is two jobs, not one

A single job that read a master and wrote a better one is precisely the
silent rewrite section 7 forbids, so the human decision goes between
them: one job proposes, a person judges, another applies what they
adopted. Applying is then an ordinary master edit and the edition is
rebuilt by the path any corrected master takes.

Correction queues on a field of its own and never touches the conversion
state. A book waiting on somebody's judgement is not converting, and
putting it in the pipeline's state machine would mislabel it and block
phase 2 behind a decision that may never be made.

**A decisions file and a suggestions file differ in one field**, and
reading the first with the reader built for the second makes every
decision read as undecided — a green tick over an unchanged book. They
have separate readers for that reason.

**A PDF never needs a master job**: Adobe returns the master already
built. Only a DOCX or plain text upload needs one built.

## The fixture that must not be regenerated

Every master already in R2 was written by a Python builder that no
longer exists, and the reader has to keep reading them. One file
generated by that builder survives as the only evidence of what it
produced. Regenerating it from the current builder would make the test
agree with itself and prove nothing.
