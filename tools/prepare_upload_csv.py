r"""Stage recently downloaded books into a CSV for manual review before
anyone calls the NobleSee upload API (docs/API.md, tools/ns.py).

    python3 tools/prepare_upload_csv.py
    python3 tools/prepare_upload_csv.py --hours 48 --downloads D:\Books
    python3 tools/prepare_upload_csv.py --output tmp/my_batch.csv

A source in Downloads is a scan and, often, a second file carrying the
same text -- same stem, different suffix, exactly the pairing this
groups by. tools/clean-book.ps1 runs on the recent files first, so the
mirror-site numeric prefix is off the filename and an oversized scan
shrunk before anything here reads them -- pass --skip-clean to sample
the files as found instead. Title, author, language and a candidate collection are read by sending
the (cleaned) filenames and the book's own first page to xAI -- the
same "Auto-fill with AI" call NobleSee's own upload form makes
(apps/web/src/lib/identifyBook.ts, apps/web/src/domain/bookIdentity.ts),
reused here rather than reimplemented as a second, weaker guesser, so a
staged row already carries the read a person would otherwise get by
clicking that button after upload. Requires XAI_API_KEY in the
environment; without it, this falls back to a local filename/text
heuristic and says so in each row's notes. A title that already matches
something in the catalog is dropped rather than guessed at twice.

Requires NOBLESEE_TOKEN in the environment (tools/ns.py) to read the
existing catalog for the duplicate check and the list of collections xAI
can choose from.
"""

import argparse
import base64
import csv
import json
import os
import re
import subprocess
import sys
import tempfile
from collections import Counter
from datetime import datetime, timedelta
from pathlib import Path
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parent))

from ns import CONTENT_TYPE_BY_SUFFIX, NobleSee, NobleSeeError  # noqa: E402
from pdf import QUOTE_CHARS, _is_ideograph, clean_stem, pymupdf_module, render_cover_image  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parent.parent

DEFAULT_HOURS = 24
PAGE_SAMPLE = 2
TEXT_SAMPLE_CHARS = 4000
MIN_IDEOGRAPHS_FOR_CHINESE = 20
TRADITIONAL_SHARE_FOR_HANT = 0.02

XAI_BASE_URL = "https://api.x.ai/v1"
XAI_IDENTIFY_MODEL = "grok-4.20-0309-reasoning"
XAI_TIMEOUT_SECONDS = 120
XAI_FIRST_PAGE_TEXT_CHARS = 3000
XAI_MAX_FIELD = 200
XAI_MAX_SHELF_DESCRIPTION = 160
BOOK_LANGUAGES = ("zh-Hans", "zh-Hant", "en", "zh-en")
XAI_PLACEHOLDER = re.compile(r"^(unknown|none|n/a|null|undefined|untitled|未知|无|無)$", re.IGNORECASE)

# Mirrors apps/web/src/domain/bookIdentity.ts's IDENTIFY_SYSTEM verbatim,
# so a row staged here gets the same read NobleSee's own "Auto-fill with
# AI" button would give the book after upload.
IDENTIFY_SYSTEM = "\n".join(
    (
        "You fill in a library record for a book from the names of the files its uploader sent and its first page — usually a scanned title page or cover, sometimes the opening text.",
        'Reply with one JSON object: {"title": string|null, "author": string|null, "language": string|null, "collection": number|null}.',
        "title: the book’s own title exactly as printed, in its original script. Keep a printed subtitle, volume or edition marker in full-width parentheses, e.g. 壽康寶鑑（現代全譯）. Never translate or romanize.",
        "author: the author, compiler or translator as printed, in its original script, without role words like 著 or 编. Several names: join with \"、\".",
        f"language: the language of the book's body text — one of {', '.join(BOOK_LANGUAGES)}. zh-en means Chinese and English in roughly equal measure.",
        "collection: the id of the one listed collection this book plainly belongs to — an author collection when the author has one, otherwise the collection whose subject it is. null when none fits; never invent an id.",
        "File names often carry catalogue numbers and site names; use them for what they plainly say, and where several agree, trust that more — but prefer what the page shows.",
        "Anything neither shows, or that you cannot read with confidence, is null. Never guess from general knowledge.",
    )
)

TITLE_JUNK = (
    re.compile(r"^untitled$", re.IGNORECASE),
    re.compile(r"^[\s\W_]*$"),
    re.compile(r"^(scan|img|image|photo|page|cover)[\s_-]*\d*$", re.IGNORECASE),
    re.compile(r"^https?://"),
    re.compile(r"图书在版编目|\bCIP\b"),
    re.compile(r"下载自|www\.|\.com|搜书吧"),
    re.compile(r"^作\s*者\s*[:：]"),
    re.compile(r"^\d{4}\s*年\d{1,2}\s*月\d{1,2}\s*日"),
)

FRONT_MATTER_JUNK_WORDS = frozenset(
    (
        "目录", "目次", "序", "序言", "前言", "简介", "内容简介", "内容提要",
        "版权信息", "版权页", "版权所有", "出版说明", "出版前言", "编者的话",
        "编辑说明", "校订说明", "引言", "扉页", "书名页", "插图", "插页",
        "封面", "封底", "作者序", "推荐序", "推荐语", "编者序", "译者序",
    )
)

AUTHOR_LINE_PATTERNS = (
    re.compile(r"作\s*者\s*[:：]\s*([^\s，,。]{1,20})"),
    re.compile(r"编\s*著\s*[:：]?\s*([^\s，,。]{1,20})"),
    re.compile(r"著\s*者\s*[:：]\s*([^\s，,。]{1,20})"),
    re.compile(r"原\s*著\s*[:：]?\s*([^\s，,。]{1,20})"),
)
AUTHOR_SUFFIX_LINE = re.compile(r"^([\u4e00-\u9fff·]{2,12})\s*(著|编著|编译|译注|讲述|校订|撰)$")
AUTHOR_LINE_WINDOW = 40

NON_NAME_MARKERS = frozenset("版译解册集注校读卷篇传录记讲编")
NON_NAME_PHRASES = ("白话", "素食")

TRADITIONAL_ONLY_CHARS = frozenset(
    "們國語學說東車華蘭麗醫廣豐觀樂時書對開關經買賣邊這頭龍鳳壽寶鑒"
    "馬鳥雞紅綠藍畫愛聽見聞讀寫錢銀鐵鋼機電話電視飛機車輛過還來嗎麼"
    "們個為義韋鄉裏義興舊區醫葉業叢從眾會傳偉傷億儀優儉價億"
    "眾樓層擁擊據點電腦網絡萬億兆億"
)


CLEAN_BOOK_SCRIPT = REPO_ROOT / "tools" / "clean-book.ps1"


def find_recent_files(downloads: Path, hours: float) -> list[Path]:
    """Recent PDF/txt sources directly in `downloads`."""
    cutoff = datetime.now() - timedelta(hours=hours)
    return [
        path
        for path in sorted(downloads.iterdir())
        if path.is_file()
        and path.suffix.lower() in CONTENT_TYPE_BY_SUFFIX
        and datetime.fromtimestamp(path.stat().st_mtime) >= cutoff
    ]


def group_by_stem(paths: list[Path]) -> dict[str, dict[str, Path]]:
    groups: dict[str, dict[str, Path]] = {}
    for path in paths:
        groups.setdefault(path.stem, {})[path.suffix.lower()] = path
    return groups


def clean_recent_files(paths: list[Path]) -> None:
    """Run tools/clean-book.ps1 on `paths` -- the mirror-site numeric
    prefix stripped from each filename, oversized scans shrunk, before
    anything here samples their text or reports on their names."""
    if not paths:
        return
    subprocess.run(
        [
            "powershell",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(CLEAN_BOOK_SCRIPT),
            *[str(path) for path in paths],
        ],
        check=True,
    )


def find_download_groups(downloads: Path, hours: float) -> dict[str, dict[str, Path]]:
    """Recent files in `downloads`, cleaned up then grouped by stem.

    tools/clean-book.ps1 runs first so the filenames sampled and
    reported on below are already the clean ones -- the same tool a
    human would otherwise run by hand before staging a batch.
    """
    clean_recent_files(find_recent_files(downloads, hours))
    return group_by_stem(find_recent_files(downloads, hours))


def sample_text(paths: dict[str, Path]) -> str:
    pdf_path = paths.get(".pdf")
    if pdf_path is not None:
        pymupdf = pymupdf_module()
        if pymupdf is not None:
            try:
                with pymupdf.open(pdf_path) as doc:
                    pages = list(doc)[:PAGE_SAMPLE]
                    return "\n".join(page.get_text() for page in pages)
            except Exception:
                return ""
        return ""

    txt_path = paths.get(".txt")
    if txt_path is not None:
        return txt_path.read_text(encoding="utf-8", errors="ignore")[:TEXT_SAMPLE_CHARS]

    return ""


def is_junk_title_line(line: str) -> bool:
    if any(pattern.search(line) for pattern in TITLE_JUNK):
        return True
    stripped = re.sub(r"[^\u4e00-\u9fffA-Za-z0-9]", "", line)
    return stripped in FRONT_MATTER_JUNK_WORDS


TOC_MARKERS = frozenset(("目录", "目次"))
VERTICAL_RUN_CHAR = re.compile(r"^[\u4e00-\u9fff]$")
ROLE_MARKER_LINE = frozenset(
    ("编订", "编著", "校订", "编译", "译注", "讲述", "原著", "撰述", "编选", "选编", "著", "撰")
)
NAME_LIKE_LINE = re.compile(r"^[\u4e00-\u9fff·]{2,10}$")
QUOTED_TITLE = re.compile(r"《([^《》]{2,30})》")
AUTHOR_BEFORE_QUOTED_TITLE = re.compile(
    r"([\u4e00-\u9fff·]{2,12})(?:编述|编著|编选|编订|校订|编译|译注|讲述|原著|撰述|著)(?:的)?\s*《"
)
CIP_SLASH_TITLE = re.compile(r"^(.{2,40}?)\s*/\s*(?:[（(][^）(]{1,10}[）)])?[\u4e00-\u9fff·]{2,10}著")
CIP_SLASH_AUTHOR = re.compile(r"/\s*(?:[（(][^）(]{1,10}[）)])?\s*([\u4e00-\u9fff·]{2,10})\s*著")


def merge_vertical_runs(text: str) -> list[str]:
    """Join a run of single-character lines into one logical line.

    A scanned title or colophon page is often laid out as one large
    character per line rather than a horizontal line of text; read as
    plain text that turns a six-character title into six single-
    character "lines", none of which look like a title on their own. A
    blank line is kept as a hard boundary rather than skipped over,
    because it is the visual gap between two such columns on the same
    page — title, then a blank, then the editor's name, then another
    blank, then the translator's — and running through it merges
    unrelated columns into one string. Any other kind of line — longer,
    punctuated — ends the run the same way.
    """
    logical: list[str] = []
    buffer = ""
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            if buffer:
                logical.append(buffer)
                buffer = ""
            continue
        if VERTICAL_RUN_CHAR.match(line):
            buffer += line
            continue
        if buffer:
            logical.append(buffer)
            buffer = ""
        logical.append(line)
    if buffer:
        logical.append(buffer)
    return logical


def title_from_text(text: str) -> str:
    """A title candidate off the book's own opening lines, or "" if none.

    Once a table-of-contents marker is seen, every line after it is a
    chapter heading, not the book's title -- extraction stops there
    rather than returning one, on a two-page sample that has nowhere
    else to look past it. A front-matter sentence that merely mentions
    the book by its quoted 《title》 -- "so-and-so compiled 《Title》" --
    is more reliably the title than the sentence carrying it.
    """
    for line in merge_vertical_runs(text)[:30]:
        if re.sub(r"\s+", "", line) in TOC_MARKERS:
            return ""
        if is_junk_title_line(line):
            continue
        slashed = CIP_SLASH_TITLE.search(line)
        if slashed:
            return slashed.group(1).strip()
        quoted = QUOTED_TITLE.search(line)
        if quoted:
            return quoted.group(1).strip()
        if 2 <= len(line) <= 60:
            return line
    return ""


def author_from_text(text: str) -> str:
    quoted_author = AUTHOR_BEFORE_QUOTED_TITLE.search(text)
    if quoted_author:
        return quoted_author.group(1).strip()

    slash_author = CIP_SLASH_AUTHOR.search(text)
    if slash_author:
        return slash_author.group(1).strip()

    for pattern in AUTHOR_LINE_PATTERNS:
        match = pattern.search(text)
        if match:
            return match.group(1).strip()

    lines = merge_vertical_runs(text)[:AUTHOR_LINE_WINDOW]
    for line in lines:
        match = AUTHOR_SUFFIX_LINE.match(line)
        if match:
            return match.group(1).strip()

    for index, line in enumerate(lines):
        if line not in ROLE_MARKER_LINE or index == 0:
            continue
        previous = lines[index - 1]
        if NAME_LIKE_LINE.match(previous) and previous not in FRONT_MATTER_JUNK_WORDS:
            return previous

    return ""


def split_filename_title_author(cleaned_stem: str) -> tuple[str, str]:
    """A trailing "-<name>" on a cleaned stem, when it looks like a name.

    Mirror filenames often trail a title with its author
    ("欲海慈航-黃正元"), but just as often trail it with a descriptor
    ("...-原文和白话文") that happens to be short and all-Chinese too --
    NON_NAME_MARKERS/PHRASES catch the common descriptors so this only
    fires on the former.
    """
    if "-" not in cleaned_stem:
        return cleaned_stem, ""

    left, _, right = cleaned_stem.rpartition("-")
    if not left or not (2 <= len(right) <= 6):
        return cleaned_stem, ""
    if not all(_is_ideograph(ch) or ch == "·" for ch in right):
        return cleaned_stem, ""
    if any(marker in right for marker in NON_NAME_MARKERS):
        return cleaned_stem, ""
    if any(phrase in right for phrase in NON_NAME_PHRASES):
        return cleaned_stem, ""
    return left, right


def infer_title_and_author(stem: str, text: str) -> tuple[str, str, bool]:
    """Returns (title, author, author_is_filename_guess)."""
    cleaned_stem = clean_stem(stem)
    filename_title, filename_author = split_filename_title_author(cleaned_stem)

    title = QUOTE_CHARS.sub("", title_from_text(text) or filename_title)
    author = author_from_text(text)
    if author:
        return title, author, False
    return title, filename_author, bool(filename_author)


def infer_language(text: str) -> str:
    ideographs = [ch for ch in text if _is_ideograph(ch)]
    if len(ideographs) < MIN_IDEOGRAPHS_FOR_CHINESE:
        return "en" if any(ch.isalpha() for ch in text) else "zh-Hans"

    traditional = sum(1 for ch in ideographs if ch in TRADITIONAL_ONLY_CHARS)
    if traditional / len(ideographs) > TRADITIONAL_SHARE_FOR_HANT:
        return "zh-Hant"
    return "zh-Hans"


def normalize_title(title: str) -> str:
    return re.sub(r"[\s\W_]+", "", title).lower()


def fetch_catalog(client: NobleSee) -> list[dict]:
    docs: list[dict] = []
    page = 1
    while True:
        result = client.list_books(limit=200, page=page, depth=0)
        docs.extend(result.get("docs", []))
        if not result.get("hasNextPage"):
            return docs
        page += 1


def existing_title_index(catalog: list[dict]) -> set[str]:
    return {normalize_title(doc["title"]) for doc in catalog if doc.get("title")}


def collection_guess(author: str, catalog: list[dict]) -> tuple[str, str]:
    if not author:
        return "", ""

    counts: Counter[str] = Counter()
    for doc in catalog:
        doc_author = (doc.get("author") or "").strip()
        collection = doc.get("collection")
        if not doc_author or collection is None:
            continue
        if doc_author == author or author in doc_author or doc_author in author:
            collection_id = collection["id"] if isinstance(collection, dict) else collection
            counts[str(collection_id)] += 1

    if not counts:
        return "", ""
    return counts.most_common(1)[0][0], ""


def collection_titles(client: NobleSee) -> dict[str, str]:
    result = client.list_collections(limit=500)
    return {str(doc["id"]): doc.get("title", "") for doc in result.get("docs", [])}


def shelf_path(doc: dict, by_id: dict[str, dict]) -> str:
    titles: list[str] = []
    current: dict | None = doc
    seen: set[str] = set()
    while current is not None:
        titles.append(current.get("title", ""))
        parent = current.get("parent")
        parent_id = parent["id"] if isinstance(parent, dict) else parent
        if parent_id is None or str(parent_id) in seen:
            break
        seen.add(str(parent_id))
        current = by_id.get(str(parent_id))
    return " / ".join(reversed(titles))


def build_shelves(client: NobleSee) -> list[dict]:
    """The same {id, path, description} list identifyPrompt() shows xAI
    in the app, built here from /book-collections instead of Payload's
    ancestryOf() -- there is no in-process collection tree in a script
    that only ever talks to the REST API."""
    docs = client.list_collections(limit=500).get("docs", [])
    by_id = {str(doc["id"]): doc for doc in docs}
    return [
        {
            "id": doc["id"],
            "path": shelf_path(doc, by_id),
            "description": doc.get("description") or "",
        }
        for doc in docs
    ]


def shelf_line(shelf: dict) -> str:
    about = re.sub(r"\s+", " ", shelf["description"]).strip()[:XAI_MAX_SHELF_DESCRIPTION]
    return f"{shelf['id']}: {shelf['path']} — {about}" if about else f"{shelf['id']}: {shelf['path']}"


def file_lines(filenames: list[str]) -> str:
    seen: set[str] = set()
    names: list[str] = []
    for name in filenames:
        name = name.strip()
        if name and name not in seen:
            seen.add(name)
            names.append(name[:XAI_MAX_FIELD])
    if not names:
        return "Uploaded file names: none given."
    if len(names) == 1:
        return f"Uploaded file name: {names[0]}"
    return "Uploaded file names:\n" + "\n".join(f"- {name}" for name in names)


def identify_prompt(filenames: list[str], shelves: list[dict], page_kind: str, page_text: str | None) -> str:
    lines = [file_lines(filenames)]
    lines.append(
        "Collections:\n" + "\n".join(shelf_line(shelf) for shelf in shelves)
        if shelves
        else "Collections: none yet — collection is null."
    )
    if page_kind == "image":
        lines.append("The first page is attached as an image.")
    elif page_kind == "text":
        lines.append(f"First page text:\n{(page_text or '')[:XAI_FIRST_PAGE_TEXT_CHARS]}")
    else:
        lines.append("No first page is available. Work from the file names alone.")
    return "\n".join(lines)


def call_xai(system: str, user: str, image_data_url: str | None, api_key: str, model: str) -> str:
    content: object = (
        [
            {"type": "text", "text": user},
            {"type": "image_url", "image_url": {"url": image_data_url, "detail": "high"}},
        ]
        if image_data_url
        else user
    )
    payload = {
        "model": model,
        "temperature": 0,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": content},
        ],
    }
    request = Request(
        f"{XAI_BASE_URL}/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
    )
    with urlopen(request, timeout=XAI_TIMEOUT_SECONDS) as response:
        body = json.loads(response.read().decode("utf-8"))
    return body["choices"][0]["message"]["content"]


def parse_identity(raw: str, shelf_ids: set[int]) -> dict:
    start, end = raw.find("{"), raw.rfind("}")
    if start == -1 or end == -1:
        return {}
    try:
        parsed = json.loads(raw[start : end + 1])
    except json.JSONDecodeError:
        return {}
    if not isinstance(parsed, dict):
        return {}

    def field(value: object) -> str | None:
        if not isinstance(value, str):
            return None
        text = re.sub(r"\s+", " ", value).strip()
        if not text or XAI_PLACEHOLDER.match(text):
            return None
        return text[:XAI_MAX_FIELD]

    def language(value: object) -> str | None:
        return value if value in BOOK_LANGUAGES else None

    def collection(value: object) -> int | None:
        try:
            number = int(value)  # type: ignore[arg-type]
        except (TypeError, ValueError):
            return None
        return number if number in shelf_ids else None

    identity = {
        "title": field(parsed.get("title")),
        "author": field(parsed.get("author")),
        "language": language(parsed.get("language")),
        "collection": collection(parsed.get("collection")),
    }
    return {key: value for key, value in identity.items() if value is not None}


def identify_with_ai(
    filenames: list[str],
    shelves: list[dict],
    pdf_path: Path | None,
    text_sample: str,
    api_key: str,
    model: str,
) -> dict | None:
    """Sends `filenames` plus the first page -- rendered as an image when
    the source is a PDF, else the sampled text -- to xAI, exactly what
    identifyFromFirstPage() sends from inside the app. Returns {} rather
    than None for "nothing found"; None means the call itself failed, so
    the caller can fall back to the local heuristic instead of staging a
    blank row."""
    image_data_url = None
    if pdf_path is not None:
        with tempfile.TemporaryDirectory(prefix="ns-identify-") as tmp:
            dest = Path(tmp) / "page.jpg"
            if render_cover_image(pdf_path, dest):
                image_data_url = f"data:image/jpeg;base64,{base64.b64encode(dest.read_bytes()).decode('ascii')}"

    if image_data_url:
        page_kind, page_text = "image", None
    elif text_sample:
        page_kind, page_text = "text", text_sample
    else:
        page_kind, page_text = "none", None

    prompt = identify_prompt(filenames, shelves, page_kind, page_text)
    try:
        raw = call_xai(IDENTIFY_SYSTEM, prompt, image_data_url, api_key, model)
    except Exception as error:  # noqa: BLE001 - any failure here falls back to the heuristic
        print(f"  xAI identify failed: {error}", file=sys.stderr)
        return None

    shelf_ids = {shelf["id"] for shelf in shelves}
    return parse_identity(raw, shelf_ids)


def build_rows(
    groups: dict[str, dict[str, Path]],
    catalog: list[dict],
    collections_by_id: dict[str, str],
    shelves: list[dict],
    xai_api_key: str | None,
    xai_model: str,
) -> list[dict[str, str]]:
    known_titles = existing_title_index(catalog)
    rows: list[dict[str, str]] = []

    for stem, paths in groups.items():
        text = sample_text(paths)
        pdf_path = paths.get(".pdf")
        txt_path = paths.get(".txt")

        title, author, author_is_guess = infer_title_and_author(stem, text)
        language = infer_language(text)
        collection_id, _ = collection_guess(author, catalog)
        collection_title = collections_by_id.get(collection_id, "") if collection_id else ""
        notes: list[str] = []
        if not xai_api_key:
            notes.append("XAI_API_KEY not set; used filename/text heuristic instead of AI")
        if not author:
            notes.append("author not detected; fill in manually")
        elif author_is_guess:
            notes.append("author guessed from filename; verify")
        if not collection_id:
            notes.append("no matching author in catalog; choose a collection manually")

        if xai_api_key:
            filenames = [path.name for path in paths.values()]
            found = identify_with_ai(filenames, shelves, pdf_path, text, xai_api_key, xai_model)
            if found is None:
                notes.append("xAI identify failed; used filename/text heuristic instead")
            else:
                notes = []
                if found.get("title"):
                    title = found["title"]
                else:
                    notes.append("xAI found no title; filename guess used, verify")
                if found.get("author"):
                    author = found["author"]
                else:
                    notes.append("xAI found no author; fill in manually")
                if found.get("language"):
                    language = found["language"]
                if found.get("collection"):
                    collection_id = str(found["collection"])
                    collection_title = collections_by_id.get(collection_id, "")
                else:
                    collection_id, collection_title = "", ""
                    notes.append("xAI found no matching collection; choose one manually")

        if normalize_title(title) in known_titles:
            continue
        if any(
            normalize_title(title) in existing or existing in normalize_title(title)
            for existing in known_titles
            if len(existing) >= 4
        ):
            notes.append("possible duplicate: title overlaps an existing catalog entry")

        other_paths = [
            path.name
            for suffix, path in paths.items()
            if suffix not in (".pdf", ".txt")
        ]

        rows.append(
            {
                "title": title,
                "author": author,
                "language": language,
                "collection_id": collection_id,
                "collection_title": collection_title,
                "pdf_path": pdf_path.name if pdf_path else "",
                "txt_path": txt_path.name if txt_path else "",
                "other_paths": ";".join(other_paths),
                "source_stem": stem,
                "notes": "; ".join(notes),
            }
        )

    return rows


def write_csv(rows: list[dict[str, str]], output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = [
        "title",
        "author",
        "language",
        "collection_id",
        "collection_title",
        "pdf_path",
        "txt_path",
        "other_paths",
        "source_stem",
        "notes",
    ]
    with output.open("w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def default_output() -> Path:
    return REPO_ROOT / "tmp" / "copilot_new_downloads_files.csv"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--downloads", type=Path, default=Path.home() / "Downloads")
    parser.add_argument("--hours", type=float, default=DEFAULT_HOURS)
    parser.add_argument("--output", type=Path, default=None)
    parser.add_argument("--token", help="Overrides NOBLESEE_TOKEN.")
    parser.add_argument(
        "--skip-clean",
        action="store_true",
        help="Don't run tools/clean-book.ps1 first; sample the files as they are.",
    )
    parser.add_argument("--xai-key", help="Overrides XAI_API_KEY.")
    parser.add_argument(
        "--no-ai",
        action="store_true",
        help="Skip xAI entirely and use the local filename/text heuristic, even if XAI_API_KEY is set.",
    )
    args = parser.parse_args(argv)

    if not args.downloads.is_dir():
        print(f"error: no such directory: {args.downloads}", file=sys.stderr)
        return 1

    xai_api_key = None if args.no_ai else (args.xai_key or os.environ.get("XAI_API_KEY"))
    if not xai_api_key:
        print("warning: XAI_API_KEY not set; falling back to the local filename/text heuristic.", file=sys.stderr)

    try:
        client = NobleSee(token=args.token)
        catalog = fetch_catalog(client)
        collections_by_id = collection_titles(client)
        shelves = build_shelves(client) if xai_api_key else []
    except NobleSeeError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1

    if args.skip_clean:
        groups = group_by_stem(find_recent_files(args.downloads, args.hours))
    else:
        groups = find_download_groups(args.downloads, args.hours)
    rows = build_rows(groups, catalog, collections_by_id, shelves, xai_api_key, XAI_IDENTIFY_MODEL)
    output = args.output or default_output()
    write_csv(rows, output)

    print(f"{len(rows)} book(s) staged, {len(groups) - len(rows)} already in the catalog, skipped.")
    print(str(output))
    return 0


if __name__ == "__main__":
    sys.exit(main())
