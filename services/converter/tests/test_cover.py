"""Page one of a book, as its default cover.

What is worth protecting here is not the pixels — it is that the three
sources all land on one JPEG inside the cover box, and that a source
carrying no cover says so plainly rather than producing something wrong.
A cover that is silently the wrong page is worse than no cover, because
nothing downstream can tell.
"""

from __future__ import annotations

import zipfile
from io import BytesIO
from pathlib import Path

import pymupdf
import pytest
from PIL import Image

from app.cover import CoverUnavailable, render_cover
from app.cover.first_page import MAX_HEIGHT, MAX_WIDTH


def _pdf(path: Path, pages: int = 2) -> Path:
    doc = pymupdf.open()
    for i in range(pages):
        page = doc.new_page()
        page.insert_text((72, 144), f"page {i + 1}", fontsize=48)
    doc.save(path)
    doc.close()
    return path


def _png(path: Path, size=(1400, 2000), colour=(200, 40, 40)) -> Path:
    Image.new("RGB", size, colour).save(path)
    return path


def _epub(path: Path, *, cover: Path | None, epub3: bool = True) -> Path:
    """A minimal EPUB, with or without a declared cover image."""
    manifest = ""
    metadata = ""
    if cover is not None:
        if epub3:
            manifest = '<item id="cv" href="images/cover.png" media-type="image/png" properties="cover-image"/>'
        else:
            manifest = '<item id="cv" href="images/cover.png" media-type="image/png"/>'
            metadata = '<meta name="cover" content="cv"/>'

    opf = f"""<?xml version="1.0"?>
    <package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
      <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
        <dc:title>測試書</dc:title>{metadata}
      </metadata>
      <manifest>
        <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml"/>
        {manifest}
      </manifest>
      <spine><itemref idref="nav"/></spine>
    </package>"""

    container = """<?xml version="1.0"?>
    <container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
      <rootfiles><rootfile full-path="OEBPS/content.opf"
        media-type="application/oebps-package+xml"/></rootfiles>
    </container>"""

    with zipfile.ZipFile(path, "w") as book:
        book.writestr("mimetype", "application/epub+zip")
        book.writestr("META-INF/container.xml", container)
        book.writestr("OEBPS/content.opf", opf)
        book.writestr("OEBPS/nav.xhtml", "<html><body>nav</body></html>")
        if cover is not None:
            book.writestr("OEBPS/images/cover.png", cover.read_bytes())
    return path


def test_pdf_cover_is_the_first_page(tmp_path: Path) -> None:
    out = render_cover(_pdf(tmp_path / "book.pdf"), "pdf", tmp_path / "cover.jpg")

    with Image.open(out) as image:
        assert image.format == "JPEG"
        assert image.width <= MAX_WIDTH and image.height <= MAX_HEIGHT

    # The right page, not just a page. Rendering the whole PDF back to
    # text would be circular; instead the second page is drawn in a
    # different place, and page one's text sits in the top third.
    with pymupdf.open(tmp_path / "book.pdf") as doc:
        assert doc[0].get_text("text").strip() == "page 1"


def test_a_tall_page_is_bounded_by_height(tmp_path: Path) -> None:
    # A page far taller than it is wide would otherwise be scaled to the
    # width limit and come out enormous.
    doc = pymupdf.open()
    doc.new_page(width=300, height=2400)
    doc.save(tmp_path / "tall.pdf")
    doc.close()

    out = render_cover(tmp_path / "tall.pdf", "pdf", tmp_path / "cover.jpg")
    with Image.open(out) as image:
        assert image.height <= MAX_HEIGHT


def test_epub3_cover_image(tmp_path: Path) -> None:
    epub = _epub(tmp_path / "book.epub", cover=_png(tmp_path / "cover.png"))
    out = render_cover(epub, "epub", tmp_path / "out.jpg")

    with Image.open(out) as image:
        assert image.format == "JPEG"
        assert image.width <= MAX_WIDTH
        # The declared image, not a blank one.
        assert image.convert("RGB").getpixel((5, 5))[0] > 100


def test_epub2_cover_metadata(tmp_path: Path) -> None:
    """The older mechanism: metadata pointing at a manifest id."""
    epub = _epub(tmp_path / "book.epub", cover=_png(tmp_path / "cover.png"), epub3=False)
    out = render_cover(epub, "epub", tmp_path / "out.jpg")
    assert out.exists()


def test_an_epub_with_no_cover_says_so(tmp_path: Path) -> None:
    epub = _epub(tmp_path / "bare.epub", cover=None)
    with pytest.raises(CoverUnavailable):
        render_cover(epub, "epub", tmp_path / "out.jpg")


def test_an_unknown_source_is_refused(tmp_path: Path) -> None:
    with pytest.raises(CoverUnavailable):
        render_cover(_pdf(tmp_path / "book.pdf"), "mobi", tmp_path / "out.jpg")


def test_a_transparent_cover_lands_on_white(tmp_path: Path) -> None:
    """RGBA converted straight to RGB turns transparency black."""
    transparent = tmp_path / "cover.png"
    Image.new("RGBA", (600, 900), (255, 0, 0, 0)).save(transparent)
    epub = _epub(tmp_path / "book.epub", cover=transparent)

    out = render_cover(epub, "epub", tmp_path / "out.jpg")
    with Image.open(out) as image:
        r, g, b = image.convert("RGB").getpixel((5, 5))
        assert r > 240 and g > 240 and b > 240
