# kj

Python and Playwright client for kijiji.ca, run in a container. Kijiji has no
public API, so a real Chromium drives the site and listings are read from the
`__NEXT_DATA__` Apollo state embedded in its pages.

```
echo 'KJ_USER=you@example.com' >> .env && echo 'KJ_PWD=...' >> .env
./run.sh login
./run.sh search scooter --category 644 --location 1700273
./run.sh listing <id>
```

`./run.sh` builds the image and runs it with the `kj-data` volume mounted at `/data`.
`docker run --rm --entrypoint python kj -m pytest -q` runs the tests.

## Decisions

- **A real browser, not HTTP.** The sign-in page loads ThreatMetrix device
  fingerprinting and a plain HTTP client is refused with no reason given.
  Chromium passes.
- **First sign-in needs an emailed code.** Kijiji treats the container as a new
  device. Run `./run.sh login` interactively and type the code, or when not on a
  tty write it to `/data/code.txt` in the container (`docker exec <name> sh -c
  'echo 123456 > /data/code.txt'`). It waits ten minutes.
- **Cookies are saved to `/data/state.json`.** Chromium drops session cookies when
  it closes, so a bare persistent profile signed out every run. The file is a live
  credential: mode 0600, in the volume, never in the repo.
- **Credentials come from `.env`** (`KJ_USER`, `KJ_PWD`), which is gitignored.
- **Throttled** to one page load per 1.5 s. Do not lower it for bulk crawling.
- **Prices are cents** (`price_cents=27500` is $275.00).
- **Pagination is the `page-N/` path segment.** `?page=N` is silently ignored and
  answered with page 1.
- **Brittle by nature.** A `KijijiParseError` means the embedded state changed;
  `parse.py` is the one file to fix.
- **Posting and messaging are not built.** When they are, they send nothing
  unless explicitly confirmed.
- Kijiji's terms restrict automated use. This is for a few of one's own ads and
  replies, not bulk posting or messaging.
