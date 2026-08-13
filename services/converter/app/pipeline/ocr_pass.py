"""Run the OCR engine over rendered pages, with an on-disk cache.

OCR is the slowest stage by a wide margin — a few seconds per page, so
tens of minutes for a book. Caching per page means the structure and
DOCX stages, which are the parts actually being iterated on, can be
re-run in seconds against a book that was read once.
"""

from __future__ import annotations

import json
from pathlib import Path

from ..models import Box, OcrPage, OcrSpan
from ..ocr.base import OcrEngine


def _to_json(page: OcrPage) -> dict:
    return {
        "index": page.index,
        "width": page.width,
        "height": page.height,
        "spans": [
            {
                "text": s.text,
                "confidence": round(s.confidence, 4),
                "box": [s.box.x0, s.box.y0, s.box.x1, s.box.y1],
            }
            for s in page.spans
        ],
    }


def _from_json(data: dict) -> OcrPage:
    return OcrPage(
        index=data["index"],
        width=data["width"],
        height=data["height"],
        spans=[
            OcrSpan(
                text=s["text"],
                confidence=s["confidence"],
                box=Box(*s["box"]),
            )
            for s in data["spans"]
        ],
    )


def ocr_pages(
    image_paths: list[Path],
    engine: OcrEngine,
    cache_dir: Path,
    indices: list[int] | None = None,
    on_page=None,
) -> list[OcrPage]:
    """OCR each image, reusing cached results where they exist.

    The cache is keyed on page index and engine name, so switching engines
    does not silently serve results from the previous one.
    """
    cache_dir.mkdir(parents=True, exist_ok=True)
    indices = indices if indices is not None else list(range(len(image_paths)))

    pages: list[OcrPage] = []
    for path, index in zip(image_paths, indices):
        cached = cache_dir / f"{engine.name}-{index:04d}.json"
        if cached.exists():
            page = _from_json(json.loads(cached.read_text()))
        else:
            page = engine.read(path, index)
            cached.write_text(json.dumps(_to_json(page), ensure_ascii=False))
        pages.append(page)
        if on_page:
            on_page(page)

    return pages
