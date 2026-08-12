/* NobleSee in-browser reader.
 *
 * Thin layer over epub.js: paging, type size, reading themes, contents,
 * and remembering where the reader got to. Preferences are per-device
 * (localStorage) rather than per-account — they're about this screen in
 * this light, not about the person. */
(function () {
    'use strict';

    var cfg = window.NR_READER;
    if (!cfg || typeof ePub !== 'function') {
        return;
    }

    var FONT_MIN = 80;
    var FONT_MAX = 220;
    var FONT_STEP = 10;
    var THEMES = ['light', 'sepia', 'dark'];

    var PREF_FONT = 'nr-reader-font';
    var PREF_THEME = 'nr-reader-theme';

    var viewer = document.getElementById('nr-viewer');
    var progressEl = document.getElementById('nr-progress');
    var tocPanel = document.getElementById('nr-toc');
    var tocList = document.getElementById('nr-toc-list');
    var tocToggle = document.getElementById('nr-toc-toggle');

    function store(key, value) {
        try { localStorage.setItem(key, value); } catch (e) { /* private mode */ }
    }
    function recall(key, fallback) {
        try {
            var v = localStorage.getItem(key);
            return v === null ? fallback : v;
        } catch (e) { return fallback; }
    }

    var fontSize = parseInt(recall(PREF_FONT, '100'), 10) || 100;
    var theme = recall(PREF_THEME, 'light');
    if (THEMES.indexOf(theme) === -1) { theme = 'light'; }

    var book = ePub(cfg.url);
    var rendition = book.renderTo(viewer, {
        width: '100%',
        height: '100%',
        spread: 'none',
        flow: 'paginated'
    });

    // Text colours have to be applied inside the book's own iframe, so
    // they're registered with epub.js rather than set in our stylesheet.
    rendition.themes.register('light', { body: { color: '#1b1917', background: '#ffffff' } });
    rendition.themes.register('sepia', { body: { color: '#3b3227', background: '#f6efe2' } });
    rendition.themes.register('dark', { body: { color: '#ddd8cf', background: '#16150f' } });

    function applyTheme() {
        document.body.setAttribute('data-theme', theme);
        rendition.themes.select(theme);
        store(PREF_THEME, theme);
    }

    function applyFont() {
        rendition.themes.fontSize(fontSize + '%');
        store(PREF_FONT, String(fontSize));
    }

    rendition.display(recall(cfg.key, undefined) || undefined).then(function () {
        applyTheme();
        applyFont();
    }).catch(function () {
        viewer.innerHTML = '<p class="nr-reader-error">' + cfg.strings.loadError + '</p>';
    });

    // Remember the exact spot, so returning re-opens where you stopped.
    rendition.on('relocated', function (location) {
        if (location && location.start) {
            store(cfg.key, location.start.cfi);
            var pct = book.locations && book.locations.length()
                ? Math.round(book.locations.percentageFromCfi(location.start.cfi) * 100)
                : null;
            if (progressEl && pct !== null && !isNaN(pct)) {
                progressEl.textContent = pct + '%';
            }
        }
    });

    book.ready.then(function () {
        return book.locations.generate(1200);
    }).catch(function () { /* progress is optional */ });

    book.loaded.navigation.then(function (nav) {
        if (!nav || !nav.toc || !nav.toc.length || !tocList) { return; }
        nav.toc.forEach(function (item) {
            var li = document.createElement('li');
            var a = document.createElement('a');
            a.textContent = item.label.trim();
            a.href = '#';
            a.addEventListener('click', function (e) {
                e.preventDefault();
                rendition.display(item.href);
                closeToc();
            });
            li.appendChild(a);
            tocList.appendChild(li);
        });
    }).catch(function () { /* some EPUBs have no navigation */ });

    function openToc() {
        tocPanel.hidden = false;
        tocToggle.setAttribute('aria-expanded', 'true');
    }
    function closeToc() {
        tocPanel.hidden = true;
        tocToggle.setAttribute('aria-expanded', 'false');
    }

    function next() { rendition.next(); }
    function prev() { rendition.prev(); }

    document.getElementById('nr-next').addEventListener('click', next);
    document.getElementById('nr-prev').addEventListener('click', prev);

    tocToggle.addEventListener('click', function () {
        if (tocPanel.hidden) { openToc(); } else { closeToc(); }
    });

    document.getElementById('nr-font-larger').addEventListener('click', function () {
        fontSize = Math.min(FONT_MAX, fontSize + FONT_STEP);
        applyFont();
    });
    document.getElementById('nr-font-smaller').addEventListener('click', function () {
        fontSize = Math.max(FONT_MIN, fontSize - FONT_STEP);
        applyFont();
    });
    document.getElementById('nr-theme-toggle').addEventListener('click', function () {
        theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
        applyTheme();
    });

    function onKey(e) {
        if (e.key === 'ArrowRight' || e.key === 'PageDown') { next(); }
        if (e.key === 'ArrowLeft' || e.key === 'PageUp') { prev(); }
        if (e.key === 'Escape' && !tocPanel.hidden) { closeToc(); }
    }
    document.addEventListener('keyup', onKey);
    // Key events inside the book iframe never reach the parent document,
    // so the same handler is attached to each rendered view.
    rendition.on('keyup', onKey);

    // Swipe paging for touch, which is where most reading happens.
    var touchStartX = null;
    rendition.on('touchstart', function (e) {
        touchStartX = e.changedTouches[0].screenX;
    });
    rendition.on('touchend', function (e) {
        if (touchStartX === null) { return; }
        var delta = e.changedTouches[0].screenX - touchStartX;
        if (Math.abs(delta) > 60) { delta > 0 ? prev() : next(); }
        touchStartX = null;
    });
}());
