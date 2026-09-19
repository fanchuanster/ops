*Part of the NobleSee specification. `CLAUDE.md` is the entry point;
this file is what cannot be read off the route files — the credential,
the header format, and what is deliberately absent.*

# THE API

Base: **`https://noblesee.com/api`**, locally `http://localhost:8787`.
The live surface is documented by the site itself at `/api/docs`,
generated from the collection configs so it cannot drift, and
administrators-only because it maps every collection and field.

## The credential

A personal access token is created at `/account/tokens` and sent as a
header whose `users` prefix is part of the format and is required:

    Authorization: users API-Key <token>

A browser session cookie authenticates the same way, which is why
Swagger's "Try it out" works while signed in. A token carries **exactly
its owner's privileges**, and it is stored rather than hashed, so it can
be re-shown later; replacing it invalidates the old value immediately.

The maintainer's administrator token is `FANCHUANSTER_ACCESS_TOKEN` in
the repo-root `config.env` (CLAUDE.md 2.4).

## What will surprise a script

- **Access control is not overridden here.** A request sees exactly what
  its owner would see in the UI.
- **Ownership is invisible** to anyone but the owner and an
  administrator, so a book's uploader is absent from responses rather
  than null (RIGHTS.md 6.1).
- **A few book fields refuse writes from non-administrators** — shelf
  placement among them — because the API is another door into rules the
  editorial screens enforce (BOOKS.md 5.4).
- **There is no GraphQL.** It is disabled and its routes deleted
  (CLAUDE.md 2.1), so both paths answer the REST handler's "route not
  found".
- **Most of what the UI does is a server action, not an endpoint.**
  Upload details, review, delivery, credit spends and cover choice have
  no addressable route; the REST collections are the programmatic path.
  **The one exception is the raw upload itself** — streaming a file body
  through a server action isn't practical, so `POST /api/upload` is a
  real route, covered below.
- **The cron route fails closed**, answering 404 rather than advertising
  itself when its secret is unset (PIPELINE.md 13).

## Adding a source format to an existing book

`POST /api/upload?book=<id>&name=<filename>` streams a file's raw bytes
as the request body and attaches it as an additional source/artifact on
an existing book — e.g. adding the `.pdf` alongside a book that only had
a `.txt`, or vice versa. It is the same route the upload screen calls
for a brand-new book, minus the `book` query param.

Requirements the route enforces, in order:

- **The caller must own the book.** `getCurrentUser()` reads the
  `Authorization: users API-Key <token>` header the same way any REST
  call does, but there is no administrator override here — the token's
  owner must equal the book's `owner`, or the route answers `404 No
  such book.` even to an administrator token, so the token used must
  belong to whoever the book is attributed to.
- **Content-Type must be one of** `application/pdf`, the DOCX MIME type,
  `application/epub+zip`, `text/plain`, `text/markdown` — sent as a real
  header, not guessed from the filename.
- **`Content-Length` must be set and truthful** (`FixedLengthStream`
  reads exactly that many bytes from the body) and under
  `MAX_UPLOAD_BYTES`.
- **The format must not already exist on that book**
  (`canAddSource`/`ADD_SOURCE_ERRORS` in `domain/sources.ts`) — a second
  PDF on a book that already has one is refused with `409`, not
  silently replaced.

PowerShell example, adding a PDF to book 53:

```powershell
$token = "<personal access token>"
$file  = "C:\path\to\100556018-让生命恢复纯净.pdf"
$name  = [System.Web.HttpUtility]::UrlEncode("100556018-让生命恢复纯净.pdf")
Invoke-WebRequest `
  -Uri "https://noblesee.com/api/upload?book=53&name=$name" `
  -Method Post `
  -Headers @{ Authorization = "users API-Key $token" } `
  -ContentType "application/pdf" `
  -InFile $file
```

A `200` response is `{"bookId": <id>}`; the new artifact then shows up
in that book's `conversion.sources` and `artifacts` on the next `GET
/api/books/<id>`. There is no batch form — one file per request, run
once per book.
