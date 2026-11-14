import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from itertools import combinations
from math import floor

import holidays as holidays_lib

ENTRY_PATTERN = re.compile(
    r"(?P<name>[^\n(]+?) \((?P<days>[\d.]+) days?\)\s*\n"
    r"(?P<dates>[^\n]+)\n"
    r"(?P<status>Pending|Approved|Holiday|Cancellation Pending)"
)
BALANCE_PATTERN = re.compile(r"^\s*(?P<name>[^\t\n]+?)\t(?P<amount>-?[\d.:]+ (?:days?|hours?))", re.MULTILINE)
DATE_PATTERN = re.compile(r"([A-Z][a-z]{2}) (\d{1,2})")
YEAR_PATTERN = re.compile(r"(\d{4})")
VACATION = "Vacation"
FLOATING = "Floating Holiday"
ALREADY_REQUESTED = "already requested time off"


@dataclass(frozen=True)
class Entry:
    name: str
    days: float
    start: date
    end: date
    status: str

    @property
    def is_holiday(self) -> bool:
        return self.status == "Holiday"


@dataclass(frozen=True)
class Placement:
    start: date
    end: date
    days: float


@dataclass(frozen=True)
class QuotaPlan:
    edits: list[tuple[Entry, Placement]]
    shrinks: list[tuple[Entry, Placement]]
    new_requests: list[Placement]


@dataclass(frozen=True)
class Booking:
    name: str
    placement: Placement


@dataclass(frozen=True)
class Step:
    entry: Entry | None
    booking: Booking
    waits_for_move: bool


class NotBookable(Exception):
    pass


def canada_holidays(year: int) -> set[date]:
    return set(holidays_lib.Canada(years=year))


def parse_span(text: str) -> tuple[date, date]:
    year = int(YEAR_PATTERN.search(text).group(1))
    parts = [datetime.strptime(f"{m} {d} {year}", "%b %d %Y").date() for m, d in DATE_PATTERN.findall(text)]
    return parts[0], parts[-1]


def parse_entries(text: str) -> list[Entry]:
    entries = []
    for match in ENTRY_PATTERN.finditer(text):
        start, end = parse_span(match.group("dates"))
        entries.append(Entry(match.group("name").strip(), float(match.group("days")), start, end, match.group("status")))
    return entries


def parse_balances(text: str) -> dict[str, str]:
    return {match.group("name").strip(): match.group("amount") for match in BALANCE_PATTERN.finditer(text)}


def time_off(entries: list[Entry], leave_type: str | None = None, since: date | None = None) -> list[Entry]:
    return [
        entry
        for entry in entries
        if entry.status != "Holiday" and leave_type in (None, entry.name) and (since is None or entry.end >= since)
    ]


def days_in(start: date, end: date) -> list[date]:
    return [start + timedelta(days=offset) for offset in range((end - start).days + 1)]


def holiday_dates(entries: list[Entry]) -> set[date]:
    return {day for entry in entries if entry.is_holiday for day in days_in(entry.start, entry.end)}


def booked_dates(entries: list[Entry]) -> set[date]:
    return {day for entry in entries if not entry.is_holiday for day in days_in(entry.start, entry.end)}


def is_working_day(day: date, holidays: set[date]) -> bool:
    return day.weekday() < 5 and day not in holidays


def skip_reason(day: date, holidays: set[date], booked: set[date], today: date) -> str | None:
    if day < today:
        return "in the past"
    if day.weekday() >= 5:
        return "weekend"
    if day in holidays:
        return "public holiday"
    if day in booked:
        return "already booked"
    return None


def advance_working_days(start: date, count: int, holidays: set[date]) -> date:
    day = start
    for _ in range(count):
        day += timedelta(days=1)
        while not is_working_day(day, holidays):
            day += timedelta(days=1)
    return day


def split_days(days: float) -> tuple[int, bool]:
    if days <= 0 or days * 2 != floor(days * 2):
        raise NotBookable(f"days must be a positive multiple of 0.5, got {days:g}")
    return floor(days), days != floor(days)


def group_runs(days: list[date]) -> list[Placement]:
    runs: list[list[date]] = []
    for day in sorted(days):
        if runs and all(gap.weekday() >= 5 for gap in days_in(runs[-1][-1] + timedelta(days=1), day - timedelta(days=1))):
            runs[-1].append(day)
            continue
        runs.append([day])
    return [Placement(run[0], run[-1], float(len(run))) for run in runs]


def bookable_span(
    start: date, end: date, half_day: bool, holidays: set[date], booked: set[date], today: date
) -> tuple[list[Placement], list[tuple[date, str]]]:
    if end < start:
        raise NotBookable(f"end date {end} is before start date {start}")
    if half_day and end != start:
        raise NotBookable("a half day must start and end on the same date")
    free: list[date] = []
    skipped: list[tuple[date, str]] = []
    for day in days_in(start, end):
        reason = skip_reason(day, holidays, booked, today)
        if reason:
            skipped.append((day, reason))
            continue
        free.append(day)
    if not free:
        reasons = ", ".join(f"{day} {reason}" for day, reason in skipped)
        raise NotBookable(f"nothing bookable between {start} and {end}: {reasons}")
    if half_day:
        return [Placement(start, start, 0.5)], skipped
    return group_runs(free), skipped


def year_end_runs(days: float, year: int, holidays: set[date], booked: set[date], today: date) -> list[Placement]:
    whole, half = split_days(days)
    picked: list[date] = []
    half_day: date | None = None
    day = date(year, 12, 31)
    while len(picked) < whole or (half and half_day is None):
        if day < today:
            raise NotBookable(f"not enough bookable days left in {year} for {days:g} day(s)")
        if skip_reason(day, holidays, booked, today) is None:
            if half and half_day is None:
                half_day = day
            else:
                picked.append(day)
        day -= timedelta(days=1)
    runs = group_runs(picked)
    if half_day:
        runs.append(Placement(half_day, half_day, 0.5))
    return runs


def year_end_entries(entries: list[Entry], name: str, year: int, start: date, end: date) -> list[Entry]:
    return sorted(
        (
            e
            for e in entries
            if e.name == name
            and not e.is_holiday
            and e.start.year == year
            and e.start.month == 12
            and (e.end < start or e.start > end)
        ),
        key=lambda e: e.start,
        reverse=True,
    )


def shrink_cuts(entry: Entry) -> range:
    if entry.days != floor(entry.days):
        return range(0)
    return range(1, int(entry.days))


def plan_quota(runs: list[Placement], remaining: float, candidates: list[Entry], holidays: set[date]) -> QuotaPlan:
    need = sum(run.days for run in runs) - max(remaining, 0)
    if need <= 0:
        return QuotaPlan([], [], runs)
    options = []
    for size in range(min(len(runs), len(candidates)) + 1):
        for chosen in combinations(candidates, size):
            freed = sum(entry.days for entry in chosen)
            options.append((chosen, None, freed))
            for entry in candidates:
                if entry in chosen:
                    continue
                options.extend((chosen, (entry, cut), freed + cut) for cut in shrink_cuts(entry))
    feasible = [option for option in options if option[2] >= need]
    if not feasible:
        movable = sum(entry.days for entry in candidates)
        raise NotBookable(
                    f"no remaining quota: {max(remaining, 0):g} day(s) left and {movable:g} booked at year end to move, "
            f"{sum(run.days for run in runs):g} needed"
        )
    chosen, shrink, _ = min(feasible, key=lambda o: (o[2] - need, len(o[0]) + (o[1] is not None)))
    shrinks = []
    if shrink:
        entry, cut = shrink
        keep = int(entry.days - cut)
        shrinks.append((entry, Placement(entry.start, advance_working_days(entry.start, keep - 1, holidays), float(keep))))
    return QuotaPlan(list(zip(chosen, runs)), shrinks, runs[len(chosen):])

def balance_days(amount: str | None) -> float:
    if not amount or "day" not in amount:
        return 0.0
    return float(amount.split()[0])


def floating_left(annual: float, entries: list[Entry], year: int) -> float:
    return annual - sum(e.days for e in entries if e.name == FLOATING and e.start.year == year)


def whole_and_half(days: float) -> tuple[int, bool]:
    halves = floor(max(days, 0) * 2)
    return halves // 2, halves % 2 == 1


def year_end_placeholders(entries: list[Entry], year: int) -> list[Entry]:
    return sorted(
        (e for e in entries if e.name in (VACATION, FLOATING) and not e.is_holiday and e.start.year == year and e.start.month == 12),
        key=lambda e: e.start,
        reverse=True,
    )


def latest_free_day(day: date, holidays: set[date], booked: set[date], today: date, year: int) -> date:
    while skip_reason(day, holidays, booked, today) is not None:
        if day < today:
            raise NotBookable(f"not enough bookable days left in {year}")
        day -= timedelta(days=1)
    return day


def paid_targets(floating: float, vacation: float, year: int, holidays: set[date], booked: set[date], today: date) -> list[Booking]:
    floating_whole, floating_half = whole_and_half(floating)
    vacation_whole, vacation_half = whole_and_half(vacation)
    units = (
        [(FLOATING, 1.0)] * floating_whole
        + [(FLOATING, 0.5)] * floating_half
        + [(VACATION, 0.5)] * vacation_half
        + [(VACATION, 1.0)] * vacation_whole
    )
    whole: dict[str, list[date]] = {FLOATING: [], VACATION: []}
    bookings: list[Booking] = []
    day = date(year, 12, 31)
    for name, amount in units:
        day = latest_free_day(day, holidays, booked, today, year)
        if amount == 1.0:
            whole[name].append(day)
        else:
            bookings.append(Booking(name, Placement(day, day, 0.5)))
        day -= timedelta(days=1)
    for name in (FLOATING, VACATION):
        bookings.extend(Booking(name, run) for run in group_runs(whole[name]))
    return bookings


def overlap(entry: Entry, placement: Placement) -> int:
    return len(set(days_in(entry.start, entry.end)) & set(days_in(placement.start, placement.end)))


def unchanged(entry: Entry, booking: Booking) -> bool:
    placement = booking.placement
    return (entry.name, entry.start, entry.end, entry.days) == (booking.name, placement.start, placement.end, placement.days)


def pair_targets(targets: list[Booking], placeholders: list[Entry]) -> list[tuple[Entry | None, Booking]]:
    free = list(placeholders)
    pairs: list[tuple[Entry | None, Booking]] = []
    unmatched: list[Booking] = []
    for target in sorted(targets, key=lambda t: t.placement.days, reverse=True):
        best = max(free, key=lambda e: overlap(e, target.placement), default=None)
        if best is None or overlap(best, target.placement) == 0:
            unmatched.append(target)
            continue
        free.remove(best)
        pairs.append((best, target))
    for target in unmatched:
        pairs.append((free.pop(0) if free else None, target))
    if free:
        raise NotBookable(f"{len(free)} year-end booking(s) would have to be cancelled; cancel them in Talent Central first")
    return [(entry, target) for entry, target in pairs if entry is None or not unchanged(entry, target)]


def order_steps(pairs: list[tuple[Entry | None, Booking]]) -> list[Step]:
    moving = [entry for entry, _ in pairs if entry is not None]
    pending = list(pairs)
    moved: list[Entry] = []
    steps: list[Step] = []
    while pending:
        ready = next(
            (
                pair
                for pair in pending
                if not any(other is not pair[0] and other not in moved and overlap(other, pair[1].placement) for other in moving)
            ),
            None,
        )
        if ready is None:
            raise NotBookable("year-end bookings would swap dates with each other; reschedule them in Talent Central")
        entry, booking = ready
        pending.remove(ready)
        waits = any(overlap(other, booking.placement) for other in moved)
        steps.append(Step(entry, booking, waits))
        if entry is not None:
            moved.append(entry)
    return steps


def plan_paid_year_end(
    entries: list[Entry],
    floating_left: float,
    vacation_left: float,
    extra_days: float | None,
    year: int,
    holidays: set[date],
    today: date,
) -> list[Step]:
    placeholders = year_end_placeholders(entries, year)
    held = {name: sum(e.days for e in placeholders if e.name == name) for name in (FLOATING, VACATION)}
    floating_total = max(floating_left, 0) + held[FLOATING]
    vacation_total = max(vacation_left + held[VACATION], 0)
    held_total = held[FLOATING] + held[VACATION]
    available = floating_total + vacation_total
    wanted = available if extra_days is None else held_total + extra_days
    if wanted > available:
        raise NotBookable(
            f"no remaining quota: {available - held_total:g} paid day(s) left (Floating Holiday, then Vacation), {extra_days:g} requested"
        )
    if wanted < held_total:
        raise NotBookable(f"year-end bookings exceed the paid leave left by {held_total - wanted:g} day(s); cancel some in Talent Central")
    if wanted <= 0:
        raise NotBookable("no remaining quota: no Floating Holiday or Vacation left to book")
    floating = min(floating_total, wanted)
    others = booked_dates([e for e in entries if e not in placeholders])
    targets = paid_targets(floating, wanted - floating, year, holidays, others, today)
    return order_steps(pair_targets(targets, placeholders))


def take_whole_days(runs: list[Placement], amount: float, holidays: set[date]) -> tuple[list[Placement], list[Placement]]:
    taken: list[Placement] = []
    rest: list[Placement] = []
    left = floor(max(amount, 0))
    for run in runs:
        if left <= 0 or run.days != floor(run.days):
            rest.append(run)
            continue
        count = min(left, int(run.days))
        left -= count
        taken.append(Placement(run.start, advance_working_days(run.start, count - 1, holidays), float(count)))
        if count < run.days:
            rest.append(Placement(advance_working_days(run.start, count, holidays), run.end, run.days - count))
    return taken, rest
