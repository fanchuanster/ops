"""PDF generation in three reader-selectable sizes (CLAUDE.md §11)."""

from .builder import PDF_VARIANTS, build_pdf, build_all_pdfs, page_count

__all__ = ["PDF_VARIANTS", "build_pdf", "build_all_pdfs", "page_count"]
