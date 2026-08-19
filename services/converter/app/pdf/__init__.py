"""PDF generation (CLAUDE.md section 11).

Two renderers, because "the PDF mirrors the original" means different
work depending on what the original was. `build_pdf` lays out the
pipeline's own Document for a source with no layout to mirror;
`docx_to_pdf` hands a DOCX to LibreOffice so the uploader's own page
keeps its shape.
"""

from .builder import BODY_SIZE, build_pdf, page_count
from .docx_pdf import LibreOfficeUnavailable, docx_to_pdf

__all__ = ["BODY_SIZE", "build_pdf", "page_count", "docx_to_pdf", "LibreOfficeUnavailable"]
