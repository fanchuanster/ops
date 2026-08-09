# Project: NobleBooks

## Overview
NobleBooks is a WordPress-based website for hosting and sharing essential and
noble books — especially traditional Chinese culture and history — that can
bring wisdom, life change, and upliftment to readers.

## Core Features

1. **View online and download** — Books can be read directly on the site
   (online viewer) or downloaded (e.g. as PDF).

2. **AI-assisted PDF production** — Leverage AI to create high-quality PDF
   versions of books, with priority given to books that are otherwise
   unavailable for free elsewhere on the internet.

3. **Donations** — The site accepts donations from visitors/readers to
   support the project.

4. **Staged/part-based release with paid unlock**
   - Books are split into multiple parts.
   - The first part is usually free to download.
   - Subsequent parts are locked for a delay period after the prior part's
     release/download — the delay is roughly the estimated time needed to
     finish reading the prior part.
   - Users can pay a small amount of money to unlock the next part early,
     as a "seriousness" gate rather than a primary revenue mechanism.

5. **Send to Kindle** — Users can send a book directly to their Kindle
   device from the web UI (no manual download + email step required).

6. **Download rate limiting / anti-abuse** — Each user has a limit on total
   downloads within a given period, to mitigate malicious or bulk
   downloading.

## Notes for Implementation
- Platform: WordPress.
- Consider plugins/custom development for: part-based content gating with
  time delays, payment integration for unlock fees, Send-to-Kindle
  integration (e.g. email-to-Kindle via SMTP), and per-user rate limiting
  on downloads.
- Favor reusing existing WordPress plugins where they meet requirements
  before building custom solutions.
