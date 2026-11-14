import re
from datetime import date

EXPENSE_TYPES = [
    "Fitness Activities",
    "Weight Loss Programs",
    "Individual & Team Sports",
    "Other Programs",
    "Fitness Wearable Technology",
]
DEFAULT_EXPENSE_TYPE = EXPENSE_TYPES[0]


class NotClaimable(ValueError):
    pass


def parse_amount(text: str) -> float:
    cleaned = re.sub(r"[^\d.]", "", text)
    if not cleaned:
        raise NotClaimable(f"no amount in {text!r}")
    return float(cleaned)


def format_amount(amount: float) -> str:
    return f"{amount:.2f}".removesuffix(".00")


def fiscal_year_start(day: date) -> date:
    year = day.year if day.month >= 7 else day.year - 1
    return date(year, 7, 1)


def expense_option(expense_type: str, options: list[str]) -> str:
    matches = [option for option in options if option.startswith(expense_type)]
    if len(matches) != 1:
        raise NotClaimable(f"expense type {expense_type!r} matches {len(matches)} of {options}")
    return matches[0]


def check_claim(amount: float, available: float, paid: date, today: date) -> None:
    if amount <= 0:
        raise NotClaimable("the amount must be positive")
    if amount > available:
        raise NotClaimable(f"{format_amount(amount)} is more than the {format_amount(available)} available")
    if paid > today:
        raise NotClaimable(f"the payment date {paid} is in the future")
