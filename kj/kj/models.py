from dataclasses import dataclass, field


@dataclass
class Listing:
    id: str
    title: str
    description: str
    url: str
    category_id: int | None
    price_cents: int | None
    price_type: str | None
    image_urls: list[str]
    posted_at: str | None
    address: str | None
    latitude: float | None
    longitude: float | None
    seller_id: str | None
    is_top_ad: bool
    attributes: dict[str, list[str]] = field(default_factory=dict)


@dataclass
class SearchResult:
    listings: list[Listing]
    total_count: int
    limit: int
    page: int

    @property
    def has_more(self) -> bool:
        return self.page * self.limit < self.total_count
