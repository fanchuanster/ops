import argparse
import logging
import os
import re
import sys
from datetime import date, datetime
from pathlib import Path

from playwright.sync_api import Page, sync_playwright

from leaves import (
    ALREADY_REQUESTED,
    FLOATING,
    VACATION,
    Booking,
    Entry,
    NotBookable,
    Placement,
    Step,
    balance_days,
    bookable_span,
    booked_dates,
    canada_holidays,
    floating_left,
    holiday_dates,
    parse_entries,
    parse_balances,
    plan_paid_year_end,
    plan_quota,
    take_whole_days,
    time_off,
    year_end_entries,
    year_end_runs,
)

CENTRAL_URL = "https://central.opentext.com/"
PROFILE_DIR = Path(__file__).parent / ".profile"
SCREENSHOT_DIR = Path(__file__).parent.parent / "tmp"
LEAVE_TYPES = [
    VACATION,
    FLOATING,
    "Sickness",
    "Bereavement Leave",
    "Volunteer Hours",
    "Parental Leave (Non-birth Parent)",
    "Family Care Leave",
]
DEFAULT_TYPE = LEAVE_TYPES[0]
STEP_MS = 1500
LISTING_ATTEMPTS = 10

logger = logging.getLogger("ot.book_leaves")


def format_date(day: date) -> str:
    return day.strftime("%b %d, %Y")


def describe(placement: Placement) -> str:
    span = format_date(placement.start)
    if placement.end != placement.start:
        span += f" - {format_date(placement.end)}"
    return f"{placement.days:g} day(s) {span}"


def visible(page: Page, label: str):
    combo = page.get_by_role("combobox", name=label)
    text = page.get_by_role("textbox", name=label)
    return combo.or_(text).locator("visible=true").first


def open_home(page: Page) -> None:
    page.goto(CENTRAL_URL)
    page.get_by_role("link", name="Tools & Services").first.hover()
    page.get_by_role("link", name="Talent Central").first.click()
    page.wait_for_url("**sapsf.com/**", timeout=60000)
    page.get_by_role("searchbox").wait_for(timeout=60000)
    page.wait_for_timeout(STEP_MS * 3)


def open_time_off(page: Page) -> None:
    page.get_by_role("searchbox").fill("Time Off")
    page.get_by_text("Update time off").first.click(timeout=15000)
    page.get_by_text("Show All", exact=True).last.wait_for(timeout=60000)


def read_listing(page: Page) -> list[Entry]:
    page.get_by_text("Show All", exact=True).last.click()
    page.get_by_role("dialog").wait_for(timeout=15000)
    for _ in range(LISTING_ATTEMPTS):
        page.wait_for_timeout(STEP_MS)
        entries = parse_entries(page.get_by_role("dialog").inner_text())
        if entries:
            return list(dict.fromkeys(entries))
    raise NotBookable("the absences listing did not load; try again")


def close_dialog(page: Page) -> None:
    page.get_by_role("button", name="Close").locator("visible=true").first.click()
    page.get_by_role("dialog").wait_for(state="hidden", timeout=15000)
    page.wait_for_timeout(STEP_MS)


def set_date(page: Page, label: str, day: date) -> None:
    field = visible(page, label)
    field.click()
    page.keyboard.press("Control+A")
    page.keyboard.type(format_date(day))
    page.keyboard.press("Enter")
    page.wait_for_timeout(STEP_MS * 2)


def choose_time_type(page: Page, name: str) -> None:
    field = visible(page, "Time Type")
    if field.input_value() == name:
        return
    field.click()
    page.keyboard.press("Control+A")
    page.keyboard.type(name)
    page.get_by_text(name, exact=True).locator("visible=true").first.click()
    page.wait_for_timeout(STEP_MS)


def choose_requesting(page: Page, days: float) -> None:
    visible(page, "Requesting").click()
    page.keyboard.press("Alt+ArrowDown")
    label = f"{days:g} day" if days == 1 else f"{days:g} days"
    page.locator("[role=option]:visible").filter(has_text=re.compile(rf"^{re.escape(label)}$")).first.click()
    page.wait_for_timeout(STEP_MS)


def choose_half_day(page: Page) -> None:
    if requested_days(page) == 0.5:
        return
    choose_requesting(page, 0.5)


def choose_full_days(page: Page, days: float) -> None:
    choose_requesting(page, days)


def requested_days(page: Page) -> float:
    return float(visible(page, "Requesting").input_value().split()[0])


def form_error(page: Page) -> str | None:
    match = re.search(r"Message Strip Error\s*\n([^\n]+)", page.locator("body").inner_text())
    return match.group(1).strip() if match else None


def fill_span(page: Page, placement: Placement, waits_for_move: bool = False) -> None:
    set_date(page, "Start Date", placement.start)
    set_date(page, "End Date", placement.end)
    error = form_error(page)
    if error and waits_for_move and ALREADY_REQUESTED in error:
        logger.info("%s overlaps a booking moved by an earlier step; checked again when submitting", describe(placement))
        return
    if placement.days == 0.5:
        choose_half_day(page)
        error = form_error(page)
    if error:
        raise NotBookable(f"{describe(placement)}: {error}")
    if placement.days != 0.5 and requested_days(page) == 0.5:
        choose_full_days(page, placement.days)
    actual = requested_days(page)
    if actual != placement.days:
        raise NotBookable(f"{describe(placement)}: form counts {actual:g} day(s)")


def finish_form(page: Page, label: str, dry_run: bool) -> None:
    if dry_run:
        SCREENSHOT_DIR.mkdir(exist_ok=True)
        slug = re.sub(r"[^A-Za-z0-9]+", "_", label)[:80]
        page.screenshot(path=str(SCREENSHOT_DIR / f"ot_dry_run_{slug}.png"))
        page.get_by_role("button", name="Cancel").locator("visible=true").first.click()
        page.wait_for_timeout(STEP_MS)
        logger.info("dry run, not submitted: %s", label)
        return
    page.get_by_role("button", name="Submit").locator("visible=true").first.click()
    page.get_by_role("button", name="Submit").locator("visible=true").first.wait_for(state="hidden", timeout=30000)
    page.wait_for_timeout(STEP_MS * 2)
    logger.info("submitted: %s", label)


def open_request_dialog(page: Page, leave_type: str) -> None:
    page.locator("text=Request Time Off >> visible=true").first.click(timeout=30000)
    visible(page, "Time Type").wait_for(timeout=30000)
    page.wait_for_timeout(STEP_MS)
    choose_time_type(page, leave_type)


def request_leave(page: Page, leave_type: str, placement: Placement, dry_run: bool, waits_for_move: bool = False) -> None:
    open_request_dialog(page, leave_type)
    fill_span(page, placement, waits_for_move)
    finish_form(page, f"request {leave_type} {describe(placement)}", dry_run)


def remaining_balance(page: Page, leave_type: str, start: date) -> float:
    open_request_dialog(page, leave_type)
    set_date(page, "Start Date", start)
    balance = float(visible(page, "Remaining Balance").input_value())
    page.get_by_role("button", name="Cancel").locator("visible=true").first.click()
    page.wait_for_timeout(STEP_MS)
    return balance


def read_balances(page: Page) -> dict[str, str]:
    page.get_by_text("Show All", exact=True).first.click()
    page.get_by_role("dialog").wait_for(timeout=15000)
    page.wait_for_timeout(STEP_MS)
    balances = parse_balances(page.get_by_role("dialog").inner_text())
    close_dialog(page)
    return balances


def report(page: Page, heading: str, leave_type: str | None = None) -> None:
    open_home(page)
    open_time_off(page)
    balances = read_balances(page)
    entries = read_listing(page)
    close_dialog(page)
    year_end = date(date.today().year, 12, 31)
    logger.info("== %s ==", heading)
    logger.info("available leave:")
    if leave_type in (None, DEFAULT_TYPE) or leave_type not in balances:
        balance_type = leave_type or DEFAULT_TYPE
        open_home(page)
        remaining = remaining_balance(page, balance_type, year_end)
        logger.info("  %s: %g day(s) not yet booked, as of %s", balance_type, remaining, format_date(year_end))
    for name, amount in balances.items():
        if name == DEFAULT_TYPE or leave_type not in (None, name):
            continue
        if name == FLOATING:
            left = floating_left(balance_days(amount), entries, year_end.year)
            logger.info("  %s: %g day(s) not yet booked, of %s a year", name, left, amount)
            continue
        logger.info("  %s: %s", name, amount)
    logger.info("booked time off:")
    booked = time_off(entries, leave_type, date.today())
    for entry in booked:
        logger.info("  %s, %s, %s", entry.name, describe(Placement(entry.start, entry.end, entry.days)), entry.status)
    if not booked:
        logger.info("  none")


def edit_booking(page: Page, entry: Entry, booking: Booking, dry_run: bool, waits_for_move: bool = False) -> None:
    placement = booking.placement
    open_home(page)
    open_time_off(page)
    read_listing(page)
    row = page.get_by_role("dialog").get_by_role("listitem").filter(has_text=f"({entry.days:g} day").filter(
        has_text=entry.start.strftime("%b %d").replace(" 0", " ")
    )
    row.first.click()
    page.get_by_role("button", name="Edit").locator("visible=true").first.click()
    visible(page, "Start Date").wait_for(timeout=30000)
    page.wait_for_timeout(STEP_MS)
    choose_time_type(page, booking.name)
    fill_span(page, placement, waits_for_move)
    label = f"edit {entry.name} {describe(Placement(entry.start, entry.end, entry.days))} -> {booking.name} {describe(placement)}"
    finish_form(page, label, dry_run)


def parse_day(text: str) -> date:
    return datetime.strptime(text, "%Y%m%d").date()


def read_bookings(page: Page) -> tuple[list[Entry], set[date], set[date], float]:
    open_home(page)
    open_time_off(page)
    annual_floating = balance_days(read_balances(page).get(FLOATING))
    entries = read_listing(page)
    close_dialog(page)
    year = date.today().year
    floating = floating_left(annual_floating, entries, year)
    holidays = holiday_dates(entries) | canada_holidays(year) | canada_holidays(year + 1)
    return entries, holidays, booked_dates(entries), floating


def request_all(page: Page, leave_type: str, placements: list[Placement], dry_run: bool) -> None:
    if not placements:
        return
    open_home(page)
    for placement in placements:
        request_leave(page, leave_type, placement, dry_run)


def run_steps(page: Page, steps: list[Step], dry_run: bool) -> None:
    for step in steps:
        if step.entry is None:
            open_home(page)
            request_leave(page, step.booking.name, step.booking.placement, dry_run, step.waits_for_move)
            continue
        edit_booking(page, step.entry, step.booking, dry_run, step.waits_for_move)


def describe_step(step: Step) -> str:
    target = f"{step.booking.name} {describe(step.booking.placement)}"
    if step.entry is None:
        return f"request {target}"
    return f"edit {step.entry.name} {describe(Placement(step.entry.start, step.entry.end, step.entry.days))} -> {target}"


def book_paid_year_end(page: Page, args: argparse.Namespace, dry_run: bool) -> None:
    entries, holidays, _, floating_left = read_bookings(page)
    today = date.today()
    open_home(page)
    vacation_left = remaining_balance(page, VACATION, date(today.year, 12, 31))
    logger.info("paid leave left: %s %g day(s), %s %g day(s)", FLOATING, floating_left, VACATION, vacation_left)
    steps = plan_paid_year_end(entries, floating_left, vacation_left, args.days, today.year, holidays, today)
    if not steps:
        logger.info("year-end bookings already use all paid leave; nothing to change")
        return
    for step in steps:
        logger.info("plan: %s", describe_step(step))
    run_steps(page, steps, dry_run)


def book_year_end(page: Page, args: argparse.Namespace, dry_run: bool) -> None:
    if args.type == VACATION:
        book_paid_year_end(page, args, dry_run)
        return
    _, holidays, booked, _ = read_bookings(page)
    today = date.today()
    runs = year_end_runs(args.days, today.year, holidays, booked, today)
    request_all(page, args.type, runs, dry_run)


def book_span(page: Page, args: argparse.Namespace, dry_run: bool) -> None:
    entries, holidays, booked, floating_left = read_bookings(page)
    today = date.today()
    runs, skipped = bookable_span(args.start, args.end, args.half_day, holidays, booked, today)
    for day, reason in skipped:
        if day.weekday() < 5:
            logger.info("skipping %s: %s", day, reason)
    logger.info("bookable: %s", ", ".join(describe(run) for run in runs))
    if args.type != VACATION:
        request_all(page, args.type, runs, dry_run)
        return
    floating, rest = take_whole_days([run for run in runs if run.end.year == today.year], floating_left, holidays)
    runs = rest + [run for run in runs if run.end.year != today.year]
    if floating:
        logger.info("using %s first (%g day(s) left, lost at year end): %s", FLOATING, floating_left, ", ".join(describe(run) for run in floating))
    request_all(page, FLOATING, floating, dry_run)
    if not runs:
        return
    open_home(page)
    remaining = remaining_balance(page, VACATION, runs[0].start)
    candidates = year_end_entries(entries, VACATION, today.year, args.start, args.end)
    plan = plan_quota(runs, remaining, candidates, holidays)
    logger.info("remaining %s: %g day(s); year-end bookings to move: %d, to shorten: %d", VACATION, remaining, len(plan.edits), len(plan.shrinks))
    for entry, placement in plan.edits + plan.shrinks:
        edit_booking(page, entry, Booking(VACATION, placement), dry_run)
    request_all(page, VACATION, plan.new_requests, dry_run)


def plan_and_run(page: Page, args: argparse.Namespace, dry_run: bool) -> None:
    if args.start is None:
        book_year_end(page, args, dry_run)
        return
    book_span(page, args, dry_run)


def book(page: Page, args: argparse.Namespace) -> None:
    if args.report:
        report(page, f"{args.type} leave", args.type)
        return
    report(page, "before booking")
    logger.info("checking every step without submitting")
    plan_and_run(page, args, dry_run=True)
    if args.dry_run:
        return
    logger.info("checks passed, submitting")
    plan_and_run(page, args, dry_run=False)
    report(page, "after booking")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Book leave in OpenText Talent Central")
    parser.add_argument("--type", choices=LEAVE_TYPES, default=DEFAULT_TYPE, help=f"leave type, default {DEFAULT_TYPE}")
    parser.add_argument("--start", type=parse_day, help="first day, yyyymmdd")
    parser.add_argument("--end", type=parse_day, help="last day, yyyymmdd; defaults to --start")
    parser.add_argument("--half-day", action="store_true", help="book half of a single day")
    parser.add_argument(
        "--days", type=float, help=f"without --start: days to book at the end of this year; for {VACATION}, defaults to all paid leave left"
    )
    parser.add_argument("--dry-run", action="store_true", help="fill the forms but do not submit")
    parser.add_argument("--headed", action="store_true", help="show the browser")
    parser.add_argument("--report", action="store_true", help="only show available and booked days of --type")
    args = parser.parse_args()
    if args.report:
        return args
    if args.start is None and args.days is None and args.type != VACATION:
        parser.error("give --start (and optionally --end), or --days to book at year end")
    if args.start is not None and args.days is not None:
        parser.error("--days only applies without --start; a range books its bookable days")
    if args.start is None and (args.end is not None or args.half_day):
        parser.error("--end and --half-day need --start")
    args.end = args.end or args.start
    return args


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    args = parse_args()
    with sync_playwright() as playwright:
        context = playwright.chromium.launch_persistent_context(
            os.fspath(PROFILE_DIR), channel="chrome", headless=not args.headed, viewport={"width": 1400, "height": 1000}
        )
        try:
            book(context.pages[0] if context.pages else context.new_page(), args)
        except NotBookable as error:
            logger.error("not bookable: %s", error)
            sys.exit(1)
        finally:
            context.close()


if __name__ == "__main__":
    main()
