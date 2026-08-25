"""What kind of thing is this file, and how should it be read?

Every accepted input converges on the same DOCX master (CLAUDE.md
section 5) — a scanned PDF, an ordinary text-layer PDF, a plain text
file and a DOCX all become a `Document` and then a master. What differs
is only how the text is recovered, and that is what this decides.

Detection is by content, not by extension. An uploaded file's name is
whatever the uploader's browser said it was, and a `.pdf` that is really
a zip should be refused rather than handed to PyMuPDF.
"""

from __future__ import annotations

from enum import Enum
from pathlib import Path


class SourceKind(str, Enum):
    PDF_SCANNED = "pdf_scanned"  # at least one page must be read by OCR
    PDF_TEXT = "pdf_text"  # every page carries its own exact text
    DOCX = "docx"
    TEXT = "text"


class UnsupportedSource(ValueError):
    """The file is not something the pipeline can read."""


# The DOCX master is the source of truth, so what a reader may upload is
# whatever can honestly become one. Formats are added here, deliberately,
# rather than by trying and seeing what happens.
SUPPORTED_DESCRIPTION = "a PDF (scanned or not), a DOCX, or a plain text file"

_ZIP_MAGIC = b"PK\x03\x04"
_PDF_MAGIC = b"%PDF-"


def sniff(path: Path) -> str:
    """The container format, from the file's first bytes."""
    with path.open("rb") as handle:
        head = handle.read(8)
    if head.startswith(_PDF_MAGIC):
        return "pdf"
    if head.startswith(_ZIP_MAGIC):
        return "zip"
    return "other"


def detect(path: Path) -> SourceKind:
    """Classify a source file, or refuse it.

    A PDF is split by whether *any* of its pages has to be read by OCR,
    which is a coarser question than the one the reader actually asks:
    `pdf_in.read_pdf` decides page by page, and a book can hold both
    kinds. This exists for the callers who need one answer up front —
    whether hours of OCR are in prospect at all.

    Erring towards `PDF_SCANNED` is the safe direction. It says "some of
    this needs reading", and the reader will still extract every page
    that carries its own text. The reverse mistake is the one that used
    to be made here, and it lost whole books: a document declared
    text-layer had its scanned pages read as empty and dropped.
    """
    if not path.is_file():
        raise UnsupportedSource(f"{path} is not a file")

    container = sniff(path)

    if container == "pdf":
        from ..pipeline.render import classify_pages

        return SourceKind.PDF_SCANNED if classify_pages(path).ocr else SourceKind.PDF_TEXT

    if container == "zip":
        # A DOCX is a zip with a word/document.xml inside it. An .xlsx or
        # a plain .zip is also a zip, and must not be read as a document.
        import zipfile

        try:
            with zipfile.ZipFile(path) as archive:
                names = set(archive.namelist())
        except zipfile.BadZipFile as exc:
            raise UnsupportedSource(f"{path.name} is not a readable archive") from exc
        if "word/document.xml" in names:
            return SourceKind.DOCX
        raise UnsupportedSource(
            f"{path.name} is a zip archive but not a DOCX — expected {SUPPORTED_DESCRIPTION}"
        )

    if _is_probably_text(path):
        return SourceKind.TEXT

    raise UnsupportedSource(f"{path.name} is not {SUPPORTED_DESCRIPTION}")


def _is_probably_text(path: Path, sample_bytes: int = 8192) -> bool:
    """Decodable as UTF-8 and free of NUL bytes.

    Deliberately strict about the encoding. A Chinese text file in GB18030
    or Big5 decoded as UTF-8 does not fail cleanly — it produces mojibake
    that would flow all the way into a published book. Refusing it here
    tells the uploader to convert it, which is recoverable; silently
    mangling it is not.
    """
    with path.open("rb") as handle:
        sample = handle.read(sample_bytes)
    if b"\x00" in sample:
        return False
    try:
        sample.decode("utf-8")
    except UnicodeDecodeError:
        # A multi-byte character may straddle the sample boundary; that
        # alone is not evidence the file is binary.
        try:
            sample[:-3].decode("utf-8")
        except UnicodeDecodeError:
            return False
    return True
