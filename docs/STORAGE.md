*Part of the NobleSee specification. `CLAUDE.md` is the entry point;
this file is object storage. It records decisions, not structure.*

# 14. STORAGE

Production is **Cloudflare R2**, chosen because the domain and DNS
already live on Cloudflare and R2 has no egress fees. Everything reaches
it through a Worker **binding** rather than the S3 API, so no access key
exists anywhere. R2 being S3-compatible keeps a later move cheap, but
the binding is the interface. Development runs the same binding against
a local simulation, so the stack needs no cloud account.

**Artifacts stream through the application. Never redirect to a public
object URL** — protected artifacts must not be reachable without passing
the server-side rights and credit checks. Presigning is an S3-API
feature the binding has no equivalent for, which is a better shape
regardless: no credential exists to be lifted, and no URL outlives the
authorization decision that produced it. Streaming is I/O, so it stays
cheap on a Worker.

## Naming

**A book is a folder named after its id, and every object it owns lives
in it.** The filename says what the file *is*, because the folder
already says which book it belongs to:

    books/{id}/
      book.pdf           the upload, kept as uploaded
      master.docx        the master
      book.epub          the reading edition
      book.txt           a text upload, kept as itself
      cover.jpg          the cover
      cover-2.jpg        the other rendered candidates, written by the
      cover-3.jpg        browser (POST /covers/{id})
      suggestions.json   what the model proposed
      decisions.json     the same file with `approved` filled in

    covers/{filename}    an uploaded cover image (the Media collection's
                         own prefix, MEDIA_PREFIX)

    conversion/{job}/input/   where an upload lands before it is filed

Everything is derived from the id in `domain/bookStorage.ts`, and there
is nothing else to derive it from. Seven names, the same for every book.

This replaced two earlier schemes on 2026-09-18, and what it deleted is
the argument for it. Keys were built from a **stem** — the name of the
first file uploaded — which had to be unique across the whole library,
so it carried an incrementing number (`scan`, `scan-2`), a footprint
check that reserved every slot the stem *would* occupy so a book could
not end up as `scan.docx` beside `scan-2.epub`, and a bucket lookup per
upload to find a free one. All of it existed to make one flat namespace
behave like a folder. A folder per id is unique by construction, so
`stemFromFilename`, `bookStem`, `numberedStem`, `stemFootprint` and
`freeStem` are gone, `lib/bookObjects.ts` with them, and so is
`masterKey` — Adobe's exported master now lands at the same
`artifactKey(id, 'docx')` as a built one, which it always should have.

**The uploaded filename is not in the key, and never needs to be.** It
is a fact about the book, recorded on the book: `conversion.sourceFilename`
for the master source and `filename` on each entry of
`conversion.sources`, which is what the upload panel and the account
page display. Encoding it in the key made it *look* preserved while
quietly mangling it — the stem stripped punctuation, collapsed spaces,
truncated at 80 characters and appended a collision number, so what a
listing showed was never quite what anyone uploaded.

**Re-uploads are caught by content, not by name.** `conversion.sourceHash`
is a SHA-256 of the bytes, indexed, and `alreadyExported` in
`lib/masterPipeline.ts` looks for a twin before paying Adobe for an
export — attaching the master the twin already has instead. Names could
never have done this job: two readers both have a `scan.pdf`, and the
same scan renamed is still the same scan. Worth knowing that the hash is
currently written only in the export path, so most rows predate it and
carry none; widening it to every intake is the obvious next step and has
not been taken.

**Never build a key from the slug.** An editor can correct a slug, and a
corrected title renames the link on its own, so a key built from one
would move when a book is renamed. An id does not change, ever. Two
rules bound that rename: **only a generated slug is rebuilt**, so one an
editor wrote by hand is never touched; and **the uniqueness suffix is
kept**, so a rename that collides with another book still resolves. A
renamed book's old URL stops working, which is the honest cost and the
reason this is keyed on the title actually changing rather than run on
every save.

**The path is not the link.** A book still reaches its objects through
the keys it stores, read back and never recomputed, and that rule did
not relax because the keys became derivable. It is what let the layout
change at all: a rebuild overwrites the object the book points at
instead of filing a second one, and a row left on an older key keeps
working. The derivation names a *new* object; the stored key finds an
existing one.

Uploads land in a staging area that a lifecycle rule sweeps after 30
days, which is why every source is also filed under its own book
(BOOKS.md 5) rather than left where it was uploaded.
