from datetime import date

import pytest

from wellness import NotClaimable, check_claim, expense_option, fiscal_year_start, format_amount, parse_amount

TODAY = date(2026, 11, 13)
OPTIONS = [
    "Fitness Activities (Live, Onsite & Virtual) Ex: Gym membership, yoga, online cardio, etc.",
    "Fitness Wearable Technology Ex. Fitness Smartwatches, Heart rate monitors, Oura Ring etc",
]


def test_parse_amount_drops_currency_and_thousands():
    assert parse_amount("CA$1,234.50") == 1234.5


def test_format_amount_drops_zero_cents():
    assert format_amount(320.0) == "320"
    assert format_amount(89.5) == "89.50"


def test_fiscal_year_runs_july_to_june():
    assert fiscal_year_start(date(2026, 11, 13)) == date(2026, 7, 1)
    assert fiscal_year_start(date(2027, 6, 30)) == date(2026, 7, 1)


def test_expense_option_matches_by_prefix_only():
    assert expense_option("Fitness Wearable Technology", OPTIONS) == OPTIONS[1]
    with pytest.raises(NotClaimable):
        expense_option("Fitness", OPTIONS)


def test_claim_over_available_is_rejected():
    with pytest.raises(NotClaimable):
        check_claim(320.01, 320, date(2026, 11, 1), TODAY)


def test_claim_paid_in_future_is_rejected():
    with pytest.raises(NotClaimable):
        check_claim(50, 320, date(2026, 11, 14), TODAY)


def test_claim_within_available_passes():
    check_claim(320, 320, TODAY, TODAY)
