import json
import re

from kj.models import Listing

NEXT_DATA = re.compile(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', re.S)


class KijijiParseError(Exception):
    pass


def apollo_state(html: str) -> dict:
    match = NEXT_DATA.search(html)
    if not match:
        raise KijijiParseError("page carries no __NEXT_DATA__ block")
    state = json.loads(match.group(1)).get("props", {}).get("pageProps", {}).get("__APOLLO_STATE__")
    if not state:
        raise KijijiParseError("page carries no Apollo state")
    return state


def resolve(state: dict, value: dict | None) -> dict | None:
    if not value:
        return None
    return state.get(value["__ref"]) if "__ref" in value else value


def to_listing(raw: dict) -> Listing:
    price = raw.get("price") or {}
    location = raw.get("location") or {}
    coordinates = location.get("coordinates") or {}
    return Listing(
        id=str(raw["id"]),
        title=raw.get("title") or "",
        description=raw.get("description") or "",
        url=raw.get("url") or "",
        category_id=raw.get("categoryId"),
        price_cents=price.get("amount"),
        price_type=price.get("type"),
        image_urls=raw.get("imageUrls") or [],
        posted_at=raw.get("activationDate"),
        address=location.get("address"),
        latitude=coordinates.get("latitude"),
        longitude=coordinates.get("longitude"),
        seller_id=(raw.get("posterInfo") or {}).get("posterId"),
        is_top_ad=bool((raw.get("flags") or {}).get("topAd")),
        attributes={
            a["canonicalName"]: a.get("canonicalValues") or []
            for a in (raw.get("attributes") or {}).get("all") or []
        },
    )


def keyed(mapping: dict, prefix: str) -> str | None:
    return next((key for key in mapping if key.startswith(prefix)), None)


def parse_search_page(html: str) -> tuple[list[Listing], int, int]:
    state = apollo_state(html)
    root = state.get("ROOT_QUERY", {})
    key = keyed(root, "searchResultsPageByUrl")
    if not key:
        raise KijijiParseError("page carries no search results")
    page = root[key]
    main_key = keyed(page.get("results") or {}, "mainListings")
    refs = page["results"][main_key] if main_key else []
    listings = [to_listing(raw) for raw in (resolve(state, ref) for ref in refs) if raw]
    pagination = page.get("pagination") or {}
    return listings, pagination.get("totalCount", len(listings)), pagination.get("limit", len(listings))


def parse_listing_page(html: str) -> Listing:
    state = apollo_state(html)
    root = state.get("ROOT_QUERY", {})
    key = keyed(root, "listing(")
    raw = resolve(state, root[key]) if key else None
    if not raw:
        raise KijijiParseError("page carries no listing")
    return to_listing(raw)
