from urllib.parse import quote

BASE_URL = "https://www.kijiji.ca"


def search_url(keywords: str = "", category_id: int | None = None, location_id: int = 0, page: int = 1) -> str:
    words = quote("-".join(keywords.split()), safe="-") if keywords.strip() else ""
    segments = [f"page-{page}"] if page > 1 else []
    if words:
        segments.append(words)
    segments.append(f"k0{f'c{category_id}' if category_id else ''}l{location_id}")
    return f"{BASE_URL}/b-search/results/{'/'.join(segments)}"


def listing_url(listing_id: str) -> str:
    return f"{BASE_URL}/v-listing/ad/listing/{listing_id}"
