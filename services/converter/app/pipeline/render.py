"""PDF → page images, and the PDF outline when the file carries one."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import pymupdf


@dataclass(frozen=True)
class OutlineEntry:
    level: int
    title: str
    page: int  # 0-based page index


def has_text_layer(pdf_path: Path, sample: int = 40) -> bool:
    """True if the PDF already contains extractable text.

    A born-digital PDF should never be sent through OCR: the embedded
    text is exact and OCR can only degrade it.
    """
    with pymupdf.open(pdf_path) as doc:
        step = max(1, doc.page_count // sample)
        for i in range(0, doc.page_count, step):
            if doc[i].get_text("text").strip():
                return True
    return False


def read_outline(pdf_path: Path) -> list[OutlineEntry]:
    with pymupdf.open(pdf_path) as doc:
        return [
            OutlineEntry(level=lvl, title=title.strip(), page=page - 1)
            for lvl, title, page in doc.get_toc()
            if page > 0
        ]


def render_pages(
    pdf_path: Path,
    out_dir: Path,
    dpi: int = 300,
    pages: list[int] | None = None,
) -> list[Path]:
    """Write one image per page and return the paths, in page order.

    Where a page is a single full-page image — which is what a scanned
    book normally is — the embedded image is extracted at its own
    resolution instead of being re-rasterized. Re-rasterizing means
    resampling an image that is already the source of truth, which
    softens exactly the stroke edges the OCR detector keys on. Pages that
    are not a single image (a cover with overlaid vector text, say) fall
    back to rendering at `dpi`.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []

    with pymupdf.open(pdf_path) as doc:
        wanted = pages if pages is not None else range(doc.page_count)
        for i in wanted:
            page = doc[i]
            images = page.get_images(full=True)
            target = out_dir / f"page-{i:04d}"

            # A rotated page must be rendered: extraction returns the
            # stored image, which ignores the page's /Rotate and would
            # hand the OCR engine a sideways page.
            if len(images) == 1 and page.rotation == 0:
                extracted = doc.extract_image(images[0][0])
                path = target.with_suffix(f".{extracted['ext']}")
                path.write_bytes(extracted["image"])
            else:
                path = target.with_suffix(".png")
                page.get_pixmap(dpi=dpi).save(path)

            written.append(path)

    return written
