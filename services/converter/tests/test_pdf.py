"""The one PDF, and which renderer produces it.

The behaviour worth protecting is that a book's PDF mirrors its
*original*. That means three different answers depending on where the
book came from, and only one of them involves rendering anything:

  - uploaded as a PDF   → the upload is the PDF; nothing here runs
  - uploaded as a DOCX  → LibreOffice, so the Word layout survives
  - built from a scan   → our own typography, there being nothing to
                          mirror

The third case is the fallback for the second, too, when LibreOffice is
absent — a developer without it installed should still get a book.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from app.models import Block, BlockKind, Document
from app.pdf import LibreOfficeUnavailable, build_pdf, page_count
from app.pdf.docx_pdf import docx_to_pdf


def _document() -> Document:
    doc = Document(title="測試書", author="無名氏")
    doc.blocks.append(Block(kind=BlockKind.CHAPTER, lines=["第一章"], page=1, confidence=1.0))
    doc.blocks.extend(
        Block(kind=BlockKind.BODY, lines=["這是一段測試文字。" * 40], page=1, confidence=1.0)
        for _ in range(12)
    )
    return doc


def test_builds_a_single_pdf(tmp_path: Path):
    out = build_pdf(_document(), tmp_path / "book.pdf")
    assert out.exists()
    assert out.read_bytes().startswith(b"%PDF-")


def test_build_pdf_takes_no_variant():
    # The three sizes are gone. This is the signature guarding that: a
    # caller still passing `variant=` is a caller that thinks it can
    # choose a typography, and should fail loudly rather than silently
    # render the only one there is.
    with pytest.raises(TypeError):
        build_pdf(_document(), Path("/tmp/x.pdf"), variant="pdf_large")  # type: ignore[call-arg]


def test_page_count_is_independent_of_what_was_built(tmp_path: Path):
    # The count prices the book, so it must not depend on whether a PDF
    # happened to be one of the requested formats.
    assert page_count(_document()) >= 1


def test_missing_libreoffice_is_its_own_error(tmp_path: Path, monkeypatch):
    # Distinguishable on purpose, so the runner can fall back to our own
    # renderer instead of failing a job over a missing binary.
    monkeypatch.setattr("app.pdf.docx_pdf.shutil.which", lambda _: None)
    with pytest.raises(LibreOfficeUnavailable):
        docx_to_pdf(tmp_path / "master.docx", tmp_path / "book.pdf")


def test_runner_falls_back_when_libreoffice_is_absent(tmp_path: Path, monkeypatch):
    from app.jobs import runner

    monkeypatch.setattr(
        runner, "docx_to_pdf", lambda *a, **k: (_ for _ in ()).throw(LibreOfficeUnavailable())
    )
    out = runner._render_pdf(_document(), tmp_path / "master.docx", tmp_path / "book.pdf")
    assert out.exists()
    assert out.read_bytes().startswith(b"%PDF-")
