import argparse
import logging
import os
import sys
from datetime import date, datetime
from pathlib import Path

from playwright.sync_api import Page, sync_playwright

from wellness import (
    DEFAULT_EXPENSE_TYPE,
    EXPENSE_TYPES,
    NotClaimable,
    check_claim,
    expense_option,
    fiscal_year_start,
    format_amount,
    parse_amount,
)

HOME_URL = "https://help.opentext.com/homepage"
OFFERING_URL = "https://help.opentext.com/saw/ess/offeringPage/2267531"
PROFILE_DIR = Path(__file__).parent / ".profile"
SCREENSHOT_DIR = Path(__file__).parent.parent / "tmp"
PREVIEW_TOP = SCREENSHOT_DIR / "ot_wellness_preview_1.png"
PREVIEW_BOTTOM = SCREENSHOT_DIR / "ot_wellness_preview_2.png"
SUBMITTED = SCREENSHOT_DIR / "ot_wellness_submitted.png"
FIELD = "#smax-basic-form-0-{}"
MAXIMUM = FIELD.format("Test_c")
AVAILABLE = FIELD.format("Available_c")
DATE_PAID = FIELD.format("DAteMembership_c")
AMOUNT = FIELD.format("Reimbursementamtrequested_c")
EXPENSE_TYPE = FIELD.format("ExpenseType_c")
STEP_MS = 1500
SIGN_IN_ATTEMPTS = 30

logger = logging.getLogger("ot.reimburse_wellness")


def signed_in(page: Page) -> bool:
    return page.url.startswith("https://help.opentext.com/") and "login" not in page.url


def sign_in(page: Page, user: str) -> None:
    page.goto(HOME_URL)
    for _ in range(SIGN_IN_ATTEMPTS):
        page.wait_for_timeout(STEP_MS)
        if signed_in(page):
            return
        account = page.get_by_text(user, exact=True)
        if account.count():
            account.first.click()
            continue
        email = page.locator("input[type=email]:visible")
        if email.count():
            email.fill(user)
            page.get_by_role("button", name="Next").click()
    raise NotClaimable(f"sign-in did not reach help.opentext.com, stuck at {page.url}; try --headed")


def open_form(page: Page) -> None:
    page.goto(OFFERING_URL)
    page.locator(AMOUNT).wait_for(timeout=60000)
    page.wait_for_function(f"document.querySelector('{AVAILABLE}').value !== ''", timeout=60000)


def read_allowance(page: Page) -> tuple[float, float]:
    return parse_amount(page.locator(MAXIMUM).input_value()), parse_amount(page.locator(AVAILABLE).input_value())


def report(page: Page) -> float:
    maximum, available = read_allowance(page)
    logger.info("Wellness allowance this fiscal year (from %s): %s", fiscal_year_start(date.today()), format_amount(maximum))
    logger.info("Available to claim: %s", format_amount(available))
    logger.info("Claims are limited to two per fiscal year (Jul 1 - Jun 30)")
    return available


def fill_description(page: Page, text: str) -> None:
    editor = page.locator("[contenteditable=true]:visible").first
    editor.click()
    editor.fill(text)


def close_overlay(page: Page) -> None:
    backdrop = page.locator(".cdk-overlay-backdrop-showing")
    if backdrop.count():
        backdrop.first.click()
    backdrop.first.wait_for(state="detached", timeout=15000)


def fill_date(page: Page, paid: date) -> None:
    field = page.locator(DATE_PAID)
    field.fill(paid.strftime("%m/%d/%Y"))
    field.press("Enter")
    page.wait_for_timeout(STEP_MS)
    close_overlay(page)
    if not field.input_value():
        raise NotClaimable("the form did not accept the payment date")


def choose_expense_type(page: Page, expense_type: str) -> str:
    page.locator(EXPENSE_TYPE).click()
    page.locator("[role=option]:visible").first.wait_for(timeout=15000)
    options = [option.inner_text().strip() for option in page.locator("[role=option]:visible").all()]
    chosen = expense_option(expense_type, options)
    page.get_by_role("option", name=chosen, exact=True).click()
    page.wait_for_timeout(STEP_MS)
    return chosen


def attach(page: Page, receipts: list[Path]) -> None:
    page.locator("input[type=file]").set_input_files([os.fspath(receipt) for receipt in receipts])
    for receipt in receipts:
        page.get_by_text(receipt.name).first.wait_for(timeout=60000)
    page.wait_for_timeout(STEP_MS * 2)


def fill_form(page: Page, args: argparse.Namespace) -> str:
    fill_description(page, args.description)
    fill_date(page, args.paid)
    page.locator(AMOUNT).fill(format_amount(args.amount))
    chosen = choose_expense_type(page, args.type)
    attach(page, args.receipt)
    page.locator("body").click(position={"x": 5, "y": 300})
    page.wait_for_timeout(STEP_MS)
    return chosen


def log_filled(page: Page, args: argparse.Namespace, expense: str) -> None:
    logger.info("Date paid: %s", page.locator(DATE_PAID).input_value())
    logger.info("Amount requested: %s", page.locator(AMOUNT).input_value())
    logger.info("Expense type: %s", expense)
    logger.info("Description: %s", args.description)
    logger.info("Receipts: %s", ", ".join(receipt.name for receipt in args.receipt))


def preview(page: Page) -> None:
    SCREENSHOT_DIR.mkdir(exist_ok=True)
    page.get_by_text("Claim Description").first.scroll_into_view_if_needed()
    page.screenshot(path=PREVIEW_TOP)
    page.get_by_role("button", name="Submit", exact=True).locator("visible=true").last.scroll_into_view_if_needed()
    page.screenshot(path=PREVIEW_BOTTOM)
    logger.info("Preview: %s and %s", PREVIEW_TOP, PREVIEW_BOTTOM)


def submit(page: Page) -> None:
    page.get_by_role("button", name="Submit", exact=True).locator("visible=true").last.click()
    page.wait_for_url(lambda url: "offeringPage" not in url, timeout=60000)
    page.wait_for_timeout(STEP_MS * 4)
    SCREENSHOT_DIR.mkdir(exist_ok=True)
    page.screenshot(path=SUBMITTED, full_page=True)
    logger.info("Submitted: %s", page.url)
    logger.info("Screenshot: %s", SUBMITTED)


def claim(page: Page, args: argparse.Namespace) -> None:
    sign_in(page, os.environ["OT_USERNAME"])
    open_form(page)
    available = report(page)
    if args.report:
        return
    check_claim(args.amount, available, args.paid, date.today())
    fill_form_and_preview(page, args)
    if not args.submit:
        logger.info("not submitted; re-run with --submit to file the claim")
        return
    submit(page)


def fill_form_and_preview(page: Page, args: argparse.Namespace) -> None:
    expense = fill_form(page, args)
    log_filled(page, args, expense)
    preview(page)


def parse_day(text: str) -> date:
    return datetime.strptime(text, "%Y%m%d").date()


def existing_file(text: str) -> Path:
    path = Path(text)
    if not path.is_file():
        raise argparse.ArgumentTypeError(f"no such file: {text}")
    return path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Claim the Well+Being Fitness reimbursement on help.opentext.com")
    parser.add_argument("--paid", type=parse_day, help="date the membership or fee was paid, yyyymmdd")
    parser.add_argument("--amount", type=parse_amount, help="amount requested, local currency")
    parser.add_argument("--type", choices=EXPENSE_TYPES, default=DEFAULT_EXPENSE_TYPE, help=f"expense type, default {DEFAULT_EXPENSE_TYPE}")
    parser.add_argument("--description", help="claim description, e.g. what was paid for and the period")
    parser.add_argument("--receipt", type=existing_file, action="append", default=[], help="receipt file; repeat for several")
    parser.add_argument("--submit", action="store_true", help="submit the claim; without it the form is only filled and previewed")
    parser.add_argument("--headed", action="store_true", help="show the browser")
    parser.add_argument("--report", action="store_true", help="only show the allowance and what is available")
    args = parser.parse_args()
    if args.report:
        return args
    if args.paid is None or args.amount is None or not args.description or not args.receipt:
        parser.error("give --paid, --amount, --description and at least one --receipt")
    return args


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    args = parse_args()
    with sync_playwright() as playwright:
        context = playwright.chromium.launch_persistent_context(
            os.fspath(PROFILE_DIR), channel="chrome", headless=not args.headed, viewport={"width": 1400, "height": 1000}
        )
        try:
            claim(context.pages[0] if context.pages else context.new_page(), args)
        except NotClaimable as error:
            logger.error("not claimable: %s", error)
            sys.exit(1)
        finally:
            context.close()


if __name__ == "__main__":
    main()
