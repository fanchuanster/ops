"""Admin client for the NobleSee REST API (docs/API.md).

A thin wrapper around the endpoints an administrator actually reaches
for during catalog upkeep: creating a book by uploading its first file,
adding further formats to one that exists, editing metadata, publishing
without the review flow, queuing (or not) for the conversion cron, and
collection CRUD. Nothing here is a route of its own — it is the same
REST surface `docs/API.md` describes, called the way this session's
catalog work called it by hand, kept in one place instead of retyped.

Library first, CLI second:

    from ns import NobleSee
    ns = NobleSee()  # token from NOBLESEE_TOKEN env var
    book_id = ns.create_book(Path("道德经.pdf"))
    ns.add_source(book_id, Path("道德经.txt"))
    ns.publish(book_id)

    python3 tools/ns.py create 道德经.pdf --author 老子 --collection 15
    python3 tools/ns.py add-source 66 道德经.txt
    python3 tools/ns.py update 66 --title 道德经 --rights-status public_domain
    python3 tools/ns.py publish 66
    python3 tools/ns.py list --limit 20
    python3 tools/ns.py delete 66

The token is never a CLI argument you'd leave in shell history: it is
read from the `NOBLESEE_TOKEN` environment variable, or passed to
`NobleSee(token=...)` by a caller that already has it in memory.
"""

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any
from urllib.error import HTTPError
from urllib.request import Request, urlopen

DEFAULT_BASE_URL = "https://noblesee.com/api"

CONTENT_TYPE_BY_SUFFIX = {
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".epub": "application/epub+zip",
    ".txt": "text/plain",
    ".md": "text/markdown",
}
"""Mirrors the `ACCEPTED` map in apps/web's `/api/upload` route.

The upload endpoint trusts the `Content-Type` header, not the filename,
so a caller has to send the right one — this is the same table, kept in
one place instead of re-derived per script.
"""

RIGHTS_STATUSES = (
    "public_domain",
    "licensed",
    "permission_granted",
    "user_owned",
    "restricted",
    "unknown",
)
"""From apps/web/src/domain/rights.ts — kept here only as a reference
for callers picking a value, not enforced client-side."""


class NobleSeeError(RuntimeError):
    """Raised for any non-2xx response, carrying the status and body."""

    def __init__(self, status: int, body: str):
        super().__init__(f"HTTP {status}: {body}")
        self.status = status
        self.body = body


class NobleSee:
    """Admin-token client for https://noblesee.com/api.

    The token must belong to an administrator for collection-wide reads
    and for editing books owned by other users; `/api/upload` (create a
    book, add a source) has no administrator override and always
    requires the token's owner to be the book's owner (docs/API.md).
    """

    def __init__(self, token: str | None = None, base_url: str = DEFAULT_BASE_URL):
        self.token = token or os.environ.get("NOBLESEE_TOKEN")
        if not self.token:
            raise NobleSeeError(
                401, "No token: pass token=... or set the NOBLESEE_TOKEN env var."
            )
        self.base_url = base_url.rstrip("/")

    def _request(
        self,
        method: str,
        path: str,
        *,
        query: dict[str, Any] | None = None,
        json_body: dict[str, Any] | None = None,
        data: bytes | None = None,
        content_type: str | None = None,
        extra_headers: dict[str, str] | None = None,
    ) -> Any:
        url = self.base_url + path
        if query:
            pairs = [
                f"{key}={_url_quote(value)}"
                for key, value in query.items()
                if value is not None
            ]
            if pairs:
                url += "?" + "&".join(pairs)

        headers = {
            "Authorization": f"users API-Key {self.token}",
            "User-Agent": "noblesee-ns.py/1.0",
        }
        body = data
        if json_body is not None:
            body = json.dumps(json_body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        elif content_type:
            headers["Content-Type"] = content_type
        if body is not None:
            headers["Content-Length"] = str(len(body))
        if extra_headers:
            headers.update(extra_headers)

        request = Request(url, data=body, headers=headers, method=method)
        try:
            with urlopen(request) as response:
                raw = response.read()
        except HTTPError as error:
            raise NobleSeeError(error.code, error.read().decode("utf-8", "replace")) from error

        if not raw:
            return None
        return json.loads(raw)

    def list_books(
        self,
        *,
        limit: int = 100,
        page: int = 1,
        where: dict[str, Any] | None = None,
        depth: int = 0,
    ) -> dict[str, Any]:
        query: dict[str, Any] = {"limit": limit, "page": page, "depth": depth}
        if where:
            query.update(_flatten_where(where))
        return self._request("GET", "/books", query=query)

    def get_book(self, book_id: int, *, depth: int = 0) -> dict[str, Any]:
        return self._request("GET", f"/books/{book_id}", query={"depth": depth})

    def update_book(self, book_id: int, **fields: Any) -> dict[str, Any]:
        return self._request("PATCH", f"/books/{book_id}", json_body=fields)

    def delete_book(self, book_id: int) -> dict[str, Any]:
        return self._request("DELETE", f"/books/{book_id}")

    def create_book(self, path: Path, *, name: str | None = None) -> int:
        """Upload `path` as a brand-new book and return its id.

        This is the one-file-per-request route from docs/API.md with no
        `book` query param — the first upload for a title. Call
        `add_source` afterwards for any additional format.
        """
        result = self._upload(path, book_id=None, name=name)
        return result["bookId"]

    def add_source(self, book_id: int, path: Path, *, name: str | None = None) -> int:
        """Attach another format to an existing book. Fails 409 if that
        format is already present (`domain/sources.ts`'s `canAddSource`)."""
        result = self._upload(path, book_id=book_id, name=name)
        return result["bookId"]

    def _upload(self, path: Path, *, book_id: int | None, name: str | None) -> dict[str, Any]:
        suffix = path.suffix.lower()
        content_type = CONTENT_TYPE_BY_SUFFIX.get(suffix)
        if content_type is None:
            raise NobleSeeError(
                400,
                f"Unsupported extension {suffix!r} for {path.name}; "
                f"expected one of {sorted(CONTENT_TYPE_BY_SUFFIX)}.",
            )
        filename = name or path.name
        query: dict[str, Any] = {"name": filename}
        if book_id is not None:
            query["book"] = book_id
        return self._request(
            "POST",
            "/upload",
            query=query,
            data=path.read_bytes(),
            content_type=content_type,
        )

    def queue_for_conversion(self, book_id: int) -> dict[str, Any]:
        """Move a `draft` book into the real pipeline instead of leaving
        its original source unfiled.

        Directly PATCHing `status: published` on a freshly-uploaded book
        never files that original source into `artifacts` — only a
        second, different-format upload or an actual pipeline run does
        that (see this repo's session notes on the "no readable files"
        bug). Setting `conversion.state` to `queued` is what the normal
        "save book details" action does for a draft book; the cron then
        files the source and, for an `as_is` plan, goes straight to
        `ready` with no OCR or export required.
        """
        book = self.get_book(book_id)
        conversion = dict(book.get("conversion") or {})
        conversion.update(
            {
                "state": "queued",
                "exportJob": None,
                "exportAsset": None,
                "exportStartedAt": None,
                "exportRetries": 0,
            }
        )
        return self.update_book(book_id, conversion=conversion)

    def publish(
        self,
        book_id: int,
        *,
        rights_status: str = "public_domain",
        queue: bool = False,
    ) -> dict[str, Any]:
        """Mark a book distributable without going through review.

        `queue=False` (the default) matches "just publish as it is, no
        conversion needed": it flips `status`/`rightsStatus` only, and
        the original source stays unfiled unless a second format was
        already added via `add_source`. Pass `queue=True` to also queue
        for conversion so the pipeline files the original source — use
        this for a book with only one source and no add-source call.
        """
        result = self.update_book(
            book_id, status="published", rightsStatus=rights_status
        )
        if queue:
            result = self.queue_for_conversion(book_id)
        return result

    def list_collections(self, *, limit: int = 200) -> dict[str, Any]:
        return self._request("GET", "/book-collections", query={"limit": limit})

    def create_collection(
        self,
        title: str,
        *,
        slug: str | None = None,
        parent: int | None = None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {"title": title, "slug": slug or _slugify(title)}
        if parent is not None:
            body["parent"] = parent
        return self._request("POST", "/book-collections", json_body=body)

    def update_collection(self, collection_id: int, **fields: Any) -> dict[str, Any]:
        return self._request("PATCH", f"/book-collections/{collection_id}", json_body=fields)

    def delete_collection(self, collection_id: int) -> dict[str, Any]:
        return self._request("DELETE", f"/book-collections/{collection_id}")


def _url_quote(value: Any) -> str:
    from urllib.parse import quote

    return quote(str(value), safe="")


def _flatten_where(where: dict[str, Any], prefix: str = "where") -> dict[str, Any]:
    """Turn `{"conversion.state": {"equals": "queued"}}` into Payload's
    bracketed query form, `where[conversion.state][equals]=queued`."""
    flat: dict[str, Any] = {}
    for field, condition in where.items():
        if isinstance(condition, dict):
            for operator, value in condition.items():
                flat[f"{prefix}[{field}][{operator}]"] = value
        else:
            flat[f"{prefix}[{field}][equals]"] = condition
    return flat


def _slugify(title: str) -> str:
    import re

    slug = re.sub(r"[^a-zA-Z0-9]+", "-", title).strip("-").lower()
    return slug or "collection"


def _print_json(value: Any) -> None:
    text = json.dumps(value, ensure_ascii=False, indent=2)
    sys.stdout.buffer.write(text.encode("utf-8", "replace") + b"\n")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--token", help="Overrides NOBLESEE_TOKEN.")
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    subparsers = parser.add_subparsers(dest="command", required=True)

    list_parser = subparsers.add_parser("list", help="List books.")
    list_parser.add_argument("--limit", type=int, default=100)
    list_parser.add_argument("--page", type=int, default=1)

    get_parser = subparsers.add_parser("get", help="Show one book.")
    get_parser.add_argument("book_id", type=int)

    create_parser = subparsers.add_parser("create", help="Upload a file as a new book.")
    create_parser.add_argument("path", type=Path)
    create_parser.add_argument("--name")
    create_parser.add_argument("--author")
    create_parser.add_argument("--collection", type=int)
    create_parser.add_argument("--title")

    add_source_parser = subparsers.add_parser(
        "add-source", help="Attach another format to an existing book."
    )
    add_source_parser.add_argument("book_id", type=int)
    add_source_parser.add_argument("path", type=Path)
    add_source_parser.add_argument("--name")

    update_parser = subparsers.add_parser("update", help="PATCH book fields.")
    update_parser.add_argument("book_id", type=int)
    update_parser.add_argument("--title")
    update_parser.add_argument("--author")
    update_parser.add_argument("--collection", type=int)
    update_parser.add_argument("--rights-status", choices=RIGHTS_STATUSES)
    update_parser.add_argument("--status")

    publish_parser = subparsers.add_parser("publish", help="Mark a book published.")
    publish_parser.add_argument("book_id", type=int)
    publish_parser.add_argument("--rights-status", default="public_domain", choices=RIGHTS_STATUSES)
    publish_parser.add_argument("--queue", action="store_true", help="Also queue for conversion.")

    queue_parser = subparsers.add_parser("queue", help="Queue a book for conversion.")
    queue_parser.add_argument("book_id", type=int)

    delete_parser = subparsers.add_parser("delete", help="Delete a book.")
    delete_parser.add_argument("book_id", type=int)

    collections_parser = subparsers.add_parser("collections", help="List collections.")
    collections_parser.add_argument("--limit", type=int, default=200)

    create_collection_parser = subparsers.add_parser(
        "create-collection", help="Create a book collection."
    )
    create_collection_parser.add_argument("title")
    create_collection_parser.add_argument("--slug")
    create_collection_parser.add_argument("--parent", type=int)

    delete_collection_parser = subparsers.add_parser(
        "delete-collection", help="Delete a book collection."
    )
    delete_collection_parser.add_argument("collection_id", type=int)

    args = parser.parse_args(argv)
    ns = NobleSee(token=args.token, base_url=args.base_url)

    try:
        if args.command == "list":
            _print_json(ns.list_books(limit=args.limit, page=args.page))
        elif args.command == "get":
            _print_json(ns.get_book(args.book_id))
        elif args.command == "create":
            book_id = ns.create_book(args.path, name=args.name)
            fields = {
                key: value
                for key, value in (
                    ("title", args.title),
                    ("author", args.author),
                    ("collection", args.collection),
                )
                if value is not None
            }
            if fields:
                ns.update_book(book_id, **fields)
            print(book_id)
        elif args.command == "add-source":
            print(ns.add_source(args.book_id, args.path, name=args.name))
        elif args.command == "update":
            fields = {
                "title": args.title,
                "author": args.author,
                "collection": args.collection,
                "rightsStatus": args.rights_status,
                "status": args.status,
            }
            fields = {key: value for key, value in fields.items() if value is not None}
            _print_json(ns.update_book(args.book_id, **fields))
        elif args.command == "publish":
            _print_json(
                ns.publish(args.book_id, rights_status=args.rights_status, queue=args.queue)
            )
        elif args.command == "queue":
            _print_json(ns.queue_for_conversion(args.book_id))
        elif args.command == "delete":
            _print_json(ns.delete_book(args.book_id))
        elif args.command == "collections":
            _print_json(ns.list_collections(limit=args.limit))
        elif args.command == "create-collection":
            _print_json(ns.create_collection(args.title, slug=args.slug, parent=args.parent))
        elif args.command == "delete-collection":
            _print_json(ns.delete_collection(args.collection_id))
    except NobleSeeError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
