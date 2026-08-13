"""PaddleOCR backend.

Chosen for Chinese: on this book's 207 DPI bilevel scans it reads verse
lines at 0.99–1.00 confidence, where the failure cases are confined to
the running-head page numbers we discard anyway.
"""

from __future__ import annotations

import os
from pathlib import Path

from ..models import Box, OcrPage, OcrSpan


class PaddleOcrEngine:
    name = "paddle"

    def __init__(self, lang: str = "ch", enable_mkldnn: bool | None = None):
        # oneDNN is off by default because this Paddle build raises
        #   NotImplementedError: ConvertPirAttribute2RuntimeAttribute
        #   not support [pir::ArrayAttribute<pir::DoubleAttribute>]
        # inside the detection model on this host. The pure-CPU kernels
        # produce identical text. Override with CONVERTER_ENABLE_MKLDNN=1
        # on a host where the accelerated path works.
        if enable_mkldnn is None:
            enable_mkldnn = os.environ.get("CONVERTER_ENABLE_MKLDNN") == "1"

        from paddleocr import PaddleOCR

        self._ocr = PaddleOCR(
            lang=lang,
            enable_mkldnn=enable_mkldnn,
            # All three are page-level preprocessors aimed at photographs
            # of documents. These pages are flatbed scans that are already
            # upright and flat, so the classifiers only add runtime and a
            # chance of rotating a clean page the wrong way.
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,
            use_textline_orientation=False,
        )

    def read(self, image_path: Path, index: int) -> OcrPage:
        from PIL import Image

        with Image.open(image_path) as im:
            width, height = im.size

        spans: list[OcrSpan] = []
        for result in self._ocr.predict(str(image_path)):
            for text, score, poly in zip(
                result["rec_texts"], result["rec_scores"], result["rec_polys"]
            ):
                text = text.strip()
                if not text:
                    continue
                xs = [float(p[0]) for p in poly]
                ys = [float(p[1]) for p in poly]
                spans.append(
                    OcrSpan(
                        text=text,
                        confidence=float(score),
                        box=Box(min(xs), min(ys), max(xs), max(ys)),
                    )
                )

        return OcrPage(index=index, width=width, height=height, spans=spans)
