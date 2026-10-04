import logging
import sys
import time
from collections.abc import Callable
from pathlib import Path

from playwright.sync_api import BrowserContext, Page

from kj.config import Config
from kj.urls import BASE_URL

log = logging.getLogger(__name__)

SIGN_IN_URL = f"{BASE_URL}/api/auth/signin"
LOGIN_FIELD = "#username"
CODE_WAIT_SECONDS = 600


class AuthError(Exception):
    pass


def is_signed_in(context: BrowserContext) -> bool:
    page = context.new_page()
    try:
        page.goto(f"{BASE_URL}/api/auth/session", wait_until="domcontentloaded")
        return '"user"' in page.inner_text("body")
    finally:
        page.close()


def code_from_file_or_prompt(code_file: Path) -> str:
    if sys.stdin.isatty():
        return input("Kijiji verification code: ").strip()
    deadline = time.monotonic() + CODE_WAIT_SECONDS
    while time.monotonic() < deadline:
        if code_file.exists() and code_file.read_text().strip():
            code = code_file.read_text().strip()
            code_file.unlink()
            return code
        time.sleep(2)
    raise AuthError("no verification code arrived")


def needs_verification(page: Page) -> bool:
    return "Email Verification" in page.inner_text("body")


def verify_email(page: Page, code_provider: Callable[[], str]) -> None:
    page.get_by_role("button", name="Send Code").click()
    log.info("verification code requested; waiting for it")
    code = code_provider()
    page.locator("input#token:visible").first.click()
    page.keyboard.type(code, delay=80)
    page.click("#otp-submit")


def sign_in(context: BrowserContext, config: Config, code_provider: Callable[[], str] | None = None) -> None:
    if is_signed_in(context):
        return
    page = context.new_page()
    page.goto(SIGN_IN_URL, wait_until="domcontentloaded")
    page.wait_for_selector(LOGIN_FIELD, timeout=45000)
    page.fill(LOGIN_FIELD, config.username)
    page.fill("#password", config.password)
    page.wait_for_timeout(1500)
    page.get_by_role("button", name="Sign in").click()
    page.wait_for_timeout(6000)
    if needs_verification(page):
        verify_email(page, code_provider or (lambda: code_from_file_or_prompt(config.code_file)))
        page.wait_for_timeout(8000)
    if not is_signed_in(context):
        raise AuthError(f"sign-in did not complete at {page.url.split('?')[0]}")
