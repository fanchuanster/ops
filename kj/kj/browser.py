import json
from collections.abc import Iterator
from contextlib import contextmanager

from playwright.sync_api import BrowserContext, sync_playwright

from kj.config import Config

USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)


@contextmanager
def open_context(config: Config, headless: bool = True) -> Iterator[BrowserContext]:
    with sync_playwright() as playwright:
        context = playwright.chromium.launch_persistent_context(
            str(config.profile_dir),
            headless=headless,
            locale="en-CA",
            user_agent=USER_AGENT,
            viewport={"width": 1280, "height": 900},
        )
        if config.state_file.exists():
            context.add_cookies(json.loads(config.state_file.read_text())["cookies"])
        try:
            yield context
        finally:
            config.state_file.write_text(json.dumps(context.storage_state()))
            config.state_file.chmod(0o600)
            context.close()
