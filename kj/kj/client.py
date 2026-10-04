from collections.abc import Iterator

from playwright.sync_api import BrowserContext

from kj.models import Listing, SearchResult
from kj.parse import parse_listing_page, parse_search_page
from kj.urls import listing_url, search_url


class KijijiClient:
    def __init__(self, context: BrowserContext, min_interval_s: float = 1.5):
        self.context = context
        self.min_interval_s = min_interval_s

    def html(self, url: str) -> str:
        page = self.context.new_page()
        try:
            page.wait_for_timeout(int(self.min_interval_s * 1000))
            page.goto(url, wait_until="domcontentloaded")
            return page.content()
        finally:
            page.close()

    def search(self, keywords: str = "", category_id: int | None = None, location_id: int = 0, page: int = 1) -> SearchResult:
        listings, total, limit = parse_search_page(self.html(search_url(keywords, category_id, location_id, page)))
        return SearchResult(listings, total, limit, page)

    def search_all(self, keywords: str = "", category_id: int | None = None, location_id: int = 0, max_pages: int = 5) -> Iterator[Listing]:
        for page in range(1, max_pages + 1):
            result = self.search(keywords, category_id, location_id, page)
            yield from result.listings
            if not result.has_more:
                return

    def get_listing(self, id_or_url: str) -> Listing:
        url = id_or_url if id_or_url.startswith("http") else listing_url(id_or_url)
        return parse_listing_page(self.html(url))
