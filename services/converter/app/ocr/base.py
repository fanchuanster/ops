"""The OCR abstraction.

CLAUDE.md section 8 asks for OCR to be replaceable. Everything downstream
depends only on `OcrEngine` and the `OcrPage` it returns, so swapping
PaddleOCR for something else is a new module and one line in `get_engine`,
not a rewrite of the pipeline.
"""

from __future__ import annotations

from pathlib import Path
from typing import Protocol

from ..models import OcrPage


class OcrEngine(Protocol):
    """Reads one page image into positioned text spans."""

    name: str

    def read(self, image_path: Path, index: int) -> OcrPage:
        """OCR a single page image.

        `index` is the 0-based page index in the source document, carried
        through so results can be cached and reordered independently of
        the order they were processed in.
        """
        ...


def get_engine(name: str = "paddle", **kwargs) -> OcrEngine:
    if name == "paddle":
        from .paddle import PaddleOcrEngine

        return PaddleOcrEngine(**kwargs)
    raise ValueError(f"unknown OCR engine: {name!r}")
