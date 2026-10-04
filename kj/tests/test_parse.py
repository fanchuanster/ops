import json

import pytest

from kj.config import ConfigError, load_config
from kj.models import SearchResult
from kj.parse import KijijiParseError, parse_listing_page, parse_search_page
from kj.urls import search_url

RAW = {
    "id": "1",
    "title": "Scooter",
    "url": "https://www.kijiji.ca/v-x/y/scooter/1",
    "categoryId": 644,
    "price": {"type": "FIXED", "amount": 27500},
    "location": {"address": "Toronto, ON", "coordinates": {"latitude": 43.6, "longitude": -79.4}},
    "posterInfo": {"posterId": "9"},
    "flags": {"topAd": True},
    "attributes": {"all": [{"canonicalName": "condition", "canonicalValues": ["used"]}]},
}


def page(state: dict) -> str:
    data = {"props": {"pageProps": {"__APOLLO_STATE__": state}}}
    return f'<script id="__NEXT_DATA__" type="application/json">{json.dumps(data)}</script>'


SEARCH = page({
    "StandardListing:1": RAW,
    "ROOT_QUERY": {"searchResultsPageByUrl:/x": {
        "pagination": {"limit": 1, "totalCount": 2},
        "results": {"mainListings({})": [{"__ref": "StandardListing:1"}]},
    }},
})

LISTING = page({
    "StandardListing:1": RAW,
    "ROOT_QUERY": {'listing({"id":"1"})': {"__ref": "StandardListing:1"}},
})


def test_listing_price_is_in_cents_and_attributes_keyed_by_name():
    listings, _, _ = parse_search_page(SEARCH)
    assert listings[0].price_cents == 27500
    assert listings[0].attributes == {"condition": ["used"]}
    assert listings[0].is_top_ad is True


def test_search_reports_total_and_page_size():
    _, total, limit = parse_search_page(SEARCH)
    assert (total, limit) == (2, 1)


def test_page_without_embedded_data_is_rejected():
    with pytest.raises(KijijiParseError):
        parse_search_page("<html></html>")


def test_listing_page_resolves_the_reference():
    assert parse_listing_page(LISTING).title == "Scooter"


def test_has_more_until_pages_cover_the_total():
    assert SearchResult([], 2, 1, 1).has_more is True
    assert SearchResult([], 2, 1, 2).has_more is False


def test_search_url_puts_the_page_in_the_path():
    assert search_url("e scooter", 644, 1700273) == "https://www.kijiji.ca/b-search/results/e-scooter/k0c644l1700273"
    assert search_url(page=3) == "https://www.kijiji.ca/b-search/results/page-3/k0l0"


def test_config_requires_credentials():
    with pytest.raises(ConfigError):
        load_config({})
