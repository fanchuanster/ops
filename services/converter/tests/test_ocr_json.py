"""Reading the OCR handoff document.

This file is the seam between the two services. The web application
writes it (`apps/web/src/domain/ocr.ts`), this converter reads it, and
neither can see the other's tests — so the things worth pinning here are
the ones that would fail silently rather than loudly: a version drift, a
page count quietly lost, structure invented that the OCR never saw.
"""

from __future__ import annotations

import json

import pytest

from app.models import BlockKind
from app.sources.ocr_json import (
    SUPPORTED_VERSION,
    UnsupportedOcrDocument,
    page_count_of,
    read_ocr_json,
)


def document(pages, *, version=SUPPORTED_VERSION, page_count=None):
    return json.dumps(
        {
            "version": version,
            "bookId": "7",
            "pageCount": page_count if page_count is not None else len(pages),
            "pages": pages,
        }
    )


def test_reads_paragraphs_into_body_blocks():
    doc = read_ocr_json(
        content=document([{"number": 1, "paragraphs": ["子曰學而時習之", "有朋自遠方來"]}]),
        title="論語",
    )

    assert doc.title == "論語"
    assert [b.text for b in doc.blocks] == ["子曰學而時習之", "有朋自遠方來"]
    assert all(b.kind is BlockKind.BODY for b in doc.blocks)


def test_every_paragraph_opens_its_own():
    # The writer already removed the line breaks a scan puts at every
    # typeset line, so what arrives here is a paragraph, not a line.
    doc = read_ocr_json(content=document([{"number": 1, "paragraphs": ["一", "二"]}]))
    assert all(b.starts_paragraph for b in doc.blocks)


def test_keeps_the_printed_page_number():
    # Shown to a human looking for the passage in the original, so it
    # should match the book rather than an array index.
    doc = read_ocr_json(content=document([{"number": 47, "paragraphs": ["text"]}]))
    assert doc.blocks[0].page == 47


def test_recognises_a_poem_marker():
    doc = read_ocr_json(content=document([{"number": 1, "paragraphs": ["（十一）", "body"]}]))
    assert doc.blocks[0].kind is BlockKind.MARKER
    assert doc.blocks[1].kind is BlockKind.BODY


def test_does_not_invent_headings():
    # The geometry that would justify calling this a chapter heading did
    # not cross the boundary. Guessing produces invented chapters in a
    # published book; a missing one is cheap for an editor to add.
    doc = read_ocr_json(content=document([{"number": 1, "paragraphs": ["學而第一", "子曰"]}]))
    assert [b.kind for b in doc.blocks] == [BlockKind.BODY, BlockKind.BODY]


def test_refuses_a_version_it_does_not_understand():
    # Loudly, in the first second -- rather than an hour later as a
    # malformed book.
    with pytest.raises(UnsupportedOcrDocument, match="version"):
        read_ocr_json(content=document([{"number": 1, "paragraphs": ["x"]}], version=99))


def test_refuses_a_file_with_no_text():
    with pytest.raises(UnsupportedOcrDocument):
        read_ocr_json(content=document([{"number": 1, "paragraphs": ["   ", ""]}]))


def test_refuses_a_file_with_no_pages():
    with pytest.raises(UnsupportedOcrDocument):
        read_ocr_json(content=document([]))


def test_refuses_something_that_is_not_json():
    with pytest.raises(UnsupportedOcrDocument):
        read_ocr_json(content="<html>not json</html>")


def test_page_count_counts_blank_pages_too():
    # Blank versos are dropped before the handoff is written, but they
    # are still pages of the book -- and the credit price is per page,
    # so counting the blocks instead would under-charge every book.
    content = document([{"number": 1, "paragraphs": ["x"]}], page_count=412)
    assert page_count_of(content) == 412


def test_page_count_is_absent_rather_than_wrong():
    assert page_count_of("not json") is None
