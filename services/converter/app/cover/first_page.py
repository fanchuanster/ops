"""Page one of a book, as a JPEG.

Three sources, in the order the web side prefers them:

    pdf    rasterize page 1. For most of this library that page is the
           scanned cover of the physical book.
    epub   the cover image the EPUB declares. An EPUB has no pages, so
           there is nothing to rasterize — but every EPUB worth the name
           names a cover in its manifest, by one of two mechanisms.
    docx   through LibreOffice to a PDF, then as above. The unhappy
           case: a master has no cover of its own, so what comes back is
           the first page of the typeset text.

JPEG throughout. This is a photograph of a page — a lossless encoding of
a scan is several times the size for no visible gain on a tile a few
hundred pixels wide.

Never silently produces a wrong image. A source that carries no cover
raises `CoverUnavailable`, the book is marked `failed`, and the tile
falls back to the book's own first character — which is a deliberate
design, not an error state (`apps/web/src/components/BookTile.tsx`).
"""

from __future__ import annotations

import logging
import posixpath
import tempfile
import zipfile
from pathlib import Path
from xml.etree import ElementTree

import pymupdf
from PIL import Image

from ..pdf import docx_to_pdf

log = logging.getLogger(__name__)

# Wide enough for the largest slot a cover is drawn in — the book page's
# own header — at 2x. Bigger costs bytes on every catalog page for
# detail nothing renders.
MAX_WIDTH = 800
MAX_HEIGHT = 1200

# High enough that the page's type stays crisp, low enough that a cover
# is tens of kilobytes rather than hundreds.
JPEG_QUALITY = 82


class CoverUnavailable(RuntimeError):
    """This source has no first page that can be turned into a cover.

    Its own type because it is an ordinary outcome, not a failure of the
    converter: an EPUB with no declared cover is a valid EPUB.
    """


def render_cover(source: Path, source_format: str, out: Path) -> Path:
    """Write a cover for `source` to `out`, and return the path."""
    if source_format == "pdf":
        image = _from_pdf(source)
    elif source_format == "epub":
        image = _from_epub(source)
    elif source_format == "docx":
        image = _from_docx(source)
    else:
        raise CoverUnavailable(f"no cover can be rendered from a {source_format}")

    return _write(image, out)


def _write(image: Image.Image, out: Path) -> Path:
    """Downscale to the cover box and encode.

    `thumbnail` only ever shrinks, which is what is wanted: a cover
    scanned at 150dpi is already smaller than the box, and upscaling it
    would add pixels without adding detail.
    """
    if image.mode != "RGB":
        # A PNG cover with alpha composited onto white rather than
        # converted straight to RGB, which turns transparency black.
        if image.mode in ("RGBA", "LA", "P"):
            image = image.convert("RGBA")
            ground = Image.new("RGB", image.size, (255, 255, 255))
            ground.paste(image, mask=image.split()[-1])
            image = ground
        else:
            image = image.convert("RGB")

    image.thumbnail((MAX_WIDTH, MAX_HEIGHT), Image.LANCZOS)
    out.parent.mkdir(parents=True, exist_ok=True)
    image.save(out, format="JPEG", quality=JPEG_QUALITY, optimize=True, progressive=True)
    return out


def _from_pdf(path: Path) -> Image.Image:
    with pymupdf.open(path) as doc:
        if doc.page_count == 0:
            raise CoverUnavailable("the PDF has no pages")
        page = doc[0]

        # Rendered at the zoom that lands on the cover box, rather than
        # at a fixed dpi: page sizes here range from a paperback scan to
        # A4, and a fixed dpi makes the first cost four times the bytes
        # of the second for the same displayed size.
        width = page.rect.width or 1
        zoom = min(4.0, max(1.0, MAX_WIDTH / width))
        pixmap = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom))
        return Image.frombytes("RGB", (pixmap.width, pixmap.height), pixmap.samples)


def _from_docx(path: Path) -> Image.Image:
    with tempfile.TemporaryDirectory(prefix="noblesee-cover-") as tmp:
        pdf = docx_to_pdf(path, Path(tmp) / "master.pdf")
        return _from_pdf(pdf)


# The two ways an EPUB names its cover. EPUB 3 marks the manifest item;
# EPUB 2 points at it from a metadata element. Both are common enough in
# the wild that supporting one is supporting half of them.
_OPF_NS = "{http://www.idpf.org/2007/opf}"
_CONTAINER_NS = "{urn:oasis:names:tc:opendocument:xmlns:container}"


def _from_epub(path: Path) -> Image.Image:
    with zipfile.ZipFile(path) as book:
        opf_path = _opf_path(book)
        opf = ElementTree.fromstring(book.read(opf_path))

        href = _cover_href(opf)
        if not href:
            raise CoverUnavailable("this EPUB declares no cover image")

        # Manifest hrefs are relative to the OPF, not to the archive
        # root, and `normpath` is what collapses the `../` an OPF in an
        # `OEBPS/` directory routinely uses.
        target = posixpath.normpath(posixpath.join(posixpath.dirname(opf_path), href))
        try:
            data = book.read(target)
        except KeyError:
            raise CoverUnavailable(f"the declared cover {href!r} is not in the archive") from None

    from io import BytesIO

    try:
        return Image.open(BytesIO(data))
    except OSError as error:
        raise CoverUnavailable(f"the declared cover could not be read: {error}") from None


def _opf_path(book: zipfile.ZipFile) -> str:
    """Where the package document lives, per the container.

    Read rather than guessed. `OEBPS/content.opf` is only a convention,
    and the container is the one place an EPUB is required to say.
    """
    try:
        container = ElementTree.fromstring(book.read("META-INF/container.xml"))
    except KeyError:
        raise CoverUnavailable("this file has no META-INF/container.xml") from None

    for rootfile in container.iter(f"{_CONTAINER_NS}rootfile"):
        full_path = rootfile.get("full-path")
        if full_path:
            return full_path
    raise CoverUnavailable("the container names no package document")


def _cover_href(opf: ElementTree.Element) -> str | None:
    items = list(opf.iter(f"{_OPF_NS}item"))

    # EPUB 3: the manifest item says what it is.
    for item in items:
        if "cover-image" in (item.get("properties") or "").split():
            return item.get("href")

    # EPUB 2: metadata points at a manifest id.
    for meta in opf.iter(f"{_OPF_NS}meta"):
        if (meta.get("name") or "").lower() != "cover":
            continue
        cover_id = meta.get("content")
        for item in items:
            if item.get("id") == cover_id:
                return item.get("href")

    return None
