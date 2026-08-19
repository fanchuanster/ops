"""DOCX → PDF, keeping the DOCX's own layout.

The requirement is that a book's PDF *mirrors the original document's
layout and appearance*. For a book uploaded as a PDF that is free — the
PDF is the upload. For a book uploaded as a DOCX, the original is the
Word document, and mirroring it means rendering it the way Word would.

`builder.py` cannot do that and should not try. It renders the pipeline's
own `Document` — headings, paragraphs, verse — through NobleSee's
typography, which is the right answer for a source with no layout of its
own (plain text, or a master built from a scan). Run against a DOCX an
uploader designed, it would throw away their margins, their fonts and
their page size and produce something that looks like every other book
here. That is a different thing from a faithful copy.

So LibreOffice, headless. It is the only option in CLAUDE.md section 11's
list that reads Word's own layout model — the same code that opens the
file in a word processor lays it out for print. Pandoc discards
presentation by design; WeasyPrint never sees the DOCX; Chromium has no
DOCX renderer.

What it costs is honest: a large dependency in the image, a subprocess
rather than a library call, and a converter that fails in ways a Python
traceback will not explain. Hence the timeout and the explicit check that
a file actually appeared — `soffice` is perfectly capable of exiting 0
having written nothing.
"""

from __future__ import annotations

import logging
import shutil
import subprocess
import tempfile
from pathlib import Path

log = logging.getLogger(__name__)

# Generous. A long book with many embedded images is genuinely slow, and
# a timeout that fires on a book that would have finished is worse than
# waiting — the whole job is retried and pays the cost again.
TIMEOUT_SECONDS = 600


class LibreOfficeUnavailable(RuntimeError):
    """No `soffice` on this machine.

    Its own type so a caller can fall back rather than fail. A developer
    running the CLI on a laptop without LibreOffice should still be able
    to build an EPUB.
    """


def _soffice() -> str:
    found = shutil.which("soffice") or shutil.which("libreoffice")
    if not found:
        raise LibreOfficeUnavailable("LibreOffice (soffice) is not installed")
    return found


def docx_to_pdf(source: Path, path: Path) -> Path:
    """Render `source` to `path`, preserving its own layout.

    Raises `LibreOfficeUnavailable` when there is no LibreOffice, and
    `RuntimeError` when there is one and it did not produce a file.
    """
    binary = _soffice()
    path.parent.mkdir(parents=True, exist_ok=True)

    # Its own profile directory, thrown away afterwards. Two conversions
    # sharing the default profile is the classic way this hangs forever:
    # the second instance decides the first already owns the profile and
    # waits for it.
    with tempfile.TemporaryDirectory(prefix="soffice-") as profile:
        result = subprocess.run(  # noqa: S603
            [
                binary,
                "--headless",
                "--norestore",
                f"-env:UserInstallation=file://{profile}",
                "--convert-to",
                "pdf",
                "--outdir",
                str(path.parent),
                str(source),
            ],
            capture_output=True,
            timeout=TIMEOUT_SECONDS,
            check=False,
        )

    # `soffice` names the output after the input and ignores what we
    # would rather call it, so the rename is not optional.
    produced = path.parent / f"{source.stem}.pdf"
    if not produced.exists():
        raise RuntimeError(
            "LibreOffice produced no PDF: "
            + (result.stderr.decode("utf-8", "replace").strip()[:200] or "no output")
        )

    if produced != path:
        produced.replace(path)
    return path
