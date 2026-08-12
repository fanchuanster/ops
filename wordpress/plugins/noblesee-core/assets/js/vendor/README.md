# Vendored libraries

Bundled rather than loaded from a CDN so the reader works offline, keeps
working if a CDN changes or disappears, and doesn't disclose what our
readers are reading to a third party.

| Library | Version | License | Source |
|---|---|---|---|
| epub.js (`epub.min.js`) | 0.3.93 | BSD-2-Clause | https://github.com/futurepress/epub.js |
| JSZip (`jszip.min.js`) | 3.10.1 | MIT or GPL-3.0 | https://github.com/Stuk/jszip |

JSZip is a hard dependency of epub.js — epub.js needs it to unpack the
EPUB container, and must be loaded first.

To update, re-download the pinned version and update the table above:

    curl -sL -o epub.min.js  https://cdn.jsdelivr.net/npm/epubjs@<v>/dist/epub.min.js
    curl -sL -o jszip.min.js https://cdn.jsdelivr.net/npm/jszip@<v>/dist/jszip.min.js
