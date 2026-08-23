"""The book's default cover: page one, rendered as an image.

CLAUDE.md's library is mostly scans, and a scan's first page *is* its
cover — the title page whoever published it printed. So a book with no
uploaded cover gets a picture of that page rather than a placeholder.

The rules about which artifact a cover comes from, and what happens when
one cannot be made, live on the web side in `apps/web/src/domain/cover.ts`.
This module only renders what it is handed.
"""

from .first_page import CoverUnavailable, render_cover

__all__ = ["CoverUnavailable", "render_cover"]
