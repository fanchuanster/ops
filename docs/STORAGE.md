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

**Every file of a book shares one stem: the name of the first file
uploaded**, differing only by type suffix. A source added later is filed
under the stem the book already has, never its own name — including when
the first upload has not been filed yet, where stemming each from its
own name would give one book two stems and nothing would notice.

**Never build a book's artifact key from the slug.** An editor can
correct a slug, and a corrected title renames the link on its own, so a
key built from one would move when a book is renamed. The name of an
uploaded file does not change, ever.

Covers are the exception, and only because they are never *found* that
way: a rendered cover lives under its own prefix, named for the book,
and the key it was written to is recorded on the book. A rename
therefore strands nothing — an existing cover keeps the key it has, and
only a fresh render after a rename picks up the new name. The exception
survives exactly as long as that stays true; the moment something
recomputes a cover key instead of reading it back, a rename starts
losing covers.

Two rules bound that rename: **only a generated slug is rebuilt**, so
one an editor wrote by hand is never touched; and **the uniqueness
suffix is kept**, so a rename that collides with another book still
resolves. A renamed book's old URL stops working, which is the honest
cost and the reason this is keyed on the title actually changing rather
than run on every save.

**The path is not the link.** A book reaches its objects through the
keys it stores, read back and never recomputed — production proves it,
since the seed books record keys that do not match their own ids and
everything about them works. The stem exists to give keys a name a human
can read in a bucket listing, not to find them.

## The number belongs to the book

Uploaded names are not unique — two readers both have a `scan.pdf` — so
a taken name gets an incrementing number.

**It is reserved for the whole book at once, not per file.** A stem
counts as taken when any key it would occupy exists, which stops a book
ending up as `scan.docx` beside `scan-2.epub`. Naming variations after
one original only means something if they keep agreeing, and agreeing at
the first write is not the same as agreeing.

The reservation happens once, when the first object is filed;
afterwards the stem is read back off a recorded key rather than
recomputed, so it cannot drift. The runner reserves too, for a book that
somehow arrives with nothing filed — a can't-happen whose failure,
writing over another book's object and reporting success, is worth a
redundant check.

**Nothing was migrated and nothing needs to be.** A slot a book already
fills keeps its key, so a rebuild overwrites the object the book points
at rather than filing a second one, and a book stored under the older
layout simply yields a stem from that layout and files its next artifact
beside the ones it has.

Uploads land in a staging area that a lifecycle rule sweeps after 30
days, which is why every source is also filed under its own book
(BOOKS.md 5) rather than left where it was uploaded.
