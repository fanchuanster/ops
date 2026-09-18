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
- **The cron route fails closed**, answering 404 rather than advertising
  itself when its secret is unset (PIPELINE.md 13).
