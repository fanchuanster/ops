"""Shared engine behind tools/clean-pdf.py and tools/shrink-pdf.py.

Both tools work on the same file at the same point of intake — a scan
pulled from an archive mirror — and until now each carried its own copy
of the size ladder, the upload limit, and the PyMuPDF plumbing that
reads what is actually in a PDF. clean-pdf.py reached across the hyphen
in shrink-pdf.py's filename with `importlib` to borrow that copy rather
than duplicate it, which worked but meant one of the two tools could
never be imported normally. This module is the thing that was actually
shared: both CLIs import it by its ordinary name, and the ladder, the
limit and the survey exist in exactly one place.

Nothing here talks to argparse or prints a CLI's own banner — that stays
in the two scripts, which differ in what they ask for and how they
report it. What is here is what they agreed on: the upload limit, the
resolution ladder, the Ghostscript invocation, what a survey of a scan
looks like, and now a companion question neither used to answer —
whether a PDF that survives a text extraction will actually render.

A book can pass every check here and still be wrong for the library:
this module answers "can Ghostscript rewrite it" and "does its own
embedded font actually draw its own text", not "is this worth
publishing".
"""

import argparse
import os
import re
import shutil
import statistics
import subprocess
import sys
import tempfile
import time
from pathlib import Path

MIB = 1024 * 1024
REPO_ROOT = Path(__file__).resolve().parent.parent
LIMIT_SOURCE = REPO_ROOT / "apps" / "web" / "src" / "domain" / "publication.ts"

DPI_LADDER = (400, 300, 250, 200, 150, 120, 96)
"""Descending, because the first rung that fits is the answer.

400 is here for the 600dpi bitonal scans libraries produce. The run at
the top rung is frequently a no-op for resolution and still wins, by
re-encoding images a scanner wrote at quality 95.
"""

DEFAULT_MIN_DPI = 200
DEFAULT_QUALITY = 60
DEFAULT_MARGIN_MIB = 1
DEFAULT_MONO_DPI = 300


def qfactor(quality: int) -> float:
    """Turn a 0-100 quality into the JPEG QFactor pdfwrite actually reads.

    `-dJPEGQ` is inert here: it belongs to the jpeg output device, and
    pdfwrite ignores it. Measured on a 5 MB scan at a resolution that
    downsamples nothing, q75 and q30 produced byte-identical output —
    which made --quality a placebo, and made the advice to lower it a
    waste of somebody's afternoon. The knob pdfwrite reads is QFactor in
    ColorImageDict/GrayImageDict, where *lower* means better, and on the
    same file it is a real lever: 0.9 returned the input size, 1.3 took
    10% off and 2.0 took 41% off, with no downsampling at all.

    The scale is anchored so that the default, 60, is QFactor 0.9 —
    Ghostscript's own default, and therefore what every result measured
    before this mapping existed was produced with.
    """
    return max(0.1, min(2.4, 2.4 - quality * 0.025))


RESPONSE_FLOOR = 0.97
"""How much smaller an attempt must be before the rung counts as working.

A rung that returns 97% of the input has not downsampled anything and has
re-encoded into roughly the bytes it read. Treating that as a measurement
is what broke a real run: two unchanged rungs were extrapolated into
confident estimates, and the estimate skipped the one rung that might
have helped.
"""

SKIP_SLACK = 1.15
"""How far over target a rung may be predicted before it is skipped untried.

Each rung costs a full Ghostscript pass — a minute or more on a 100 MB
book — so a rung the last result says cannot fit is not worth measuring.
The prediction scales with image area, which holds only between two rungs
that both actually downsample, so it is made only from a rung measurably
smaller than the rung above it and discarded the moment one is not.

Which is why the first rung never predicts anything. Measured against the
input it always looks like it worked — re-encoding a scanner's quality-95
JPEGs takes a third off on its own — and a prediction extrapolated from
that reads a re-encoding as a downsample and skips the rung that would
have fit. One rung is not two measurements, whatever it returned.
"""

GS_BINARIES = ("gs", "gswin64c", "gswin32c")
"""What Ghostscript is called, in the order to try.

Windows builds ship `gswin64c.exe` — the console variant — and no `gs`
at all, so a portable Ghostscript unzipped into a directory on PATH is
invisible to a tool that only looks for `gs`.
"""

COLOUR_PAGES = 0.25
COLOUR_SAMPLES = 4
COLOUR_SPREAD = 24
COLOUR_POINTS = 0.02
"""What counts as a scan --gray has something to take away from.

Not "does this book contain colour", which is the question that made
--gray the advice for every scan and a win for almost none of them. A
225 MB book of grey pages with a colour cover came back 163.7 MB with
--gray and 163.7 MB without, for a hundred seconds of Ghostscript each
way: the pages were DeviceGray already and the cover is one leaf.

So the test is whether colour is *most of the book*. Under COLOUR_PAGES
of the sampled images being multi-channel, there is nothing to drop
however vivid the cover is.

Above it, the colourspace still has to be checked against the pixels,
because a grey book photographed on a colour sensor is stored as RGB and
declares itself colour. Chroma planes over grey paper are flat, subsample
4:2:0 and compress to almost nothing, so dropping them saves almost
nothing. A few images are decoded and sampled, and the scan counts as
colour when more than COLOUR_POINTS of the points have channels spread
further apart than COLOUR_SPREAD — wide enough to pass over JPEG ringing
around black type, narrow enough to catch a red seal.
"""

FILTERS = (
    b"/JPXDecode",
    b"/DCTDecode",
    b"/JBIG2Decode",
    b"/CCITTFaxDecode",
    b"/FlateDecode",
    b"/RunLengthDecode",
    b"/LZWDecode",
)

LEADING = re.compile(r"^[0-9\-]+")
TRAILING = re.compile(r"[0-9\-]+$")
SEPARATORS = " \t._"

GLYPH_SAMPLE_PAGES = 16
GLYPH_SAMPLE_CHARS = 1500
"""How much of a book is read before judging whether it renders.

A book that is broken is broken on every page, since a font is embedded
once for the whole file — so a sample well short of the whole book
answers the question as well as reading all of it would. Divided across
more pages than the render itself strictly needs, so a title page that
repeats one or two characters hundreds of times can't burn through the
whole budget before a page with real variety is ever reached.
"""

GLYPH_GRID = 4
"""Side length of the grid each rendered character is reduced to.

Comparing raw pixels would fail on legitimate anti-aliasing noise
between two renders of what is genuinely the same shape; a 4x4 grid of
averaged intensities is coarse enough to survive that noise and still
tell a Chinese character's stroke pattern apart from another's, or from
a blank tile.
"""

SHAPE_QUANTUM = 32
"""Grey levels collapsed into one bucket when a glyph's shape is hashed.

Rounds two renders of the same shape to the same signature despite
sub-pixel positioning differences, without rounding two actually
different shapes into one.
"""

SHAPE_COLLISION_MIN = 3
"""Distinct characters that must share one rendered shape to count as one.

Two different characters can coincidentally render to a similar 4x4
signature — a period and the dot of an "i", say. Three or more
unrelated characters sharing an identical signature is not a
coincidence; it is the same tile being drawn for characters that are
supposed to look nothing alike, which is what a broken subset font
does for its entire alphabet.
"""

SHAPE_MIN_SAMPLES = 8
"""Characters a font must contribute before its collision rate is judged.

A font only sampled a handful of times hasn't given the check enough
occurrences for "everything collided" to mean anything.
"""

DEFAULT_MISSING_GLYPH_THRESHOLD = 0.3
"""Share of sampled characters drawn by a broken font before a PDF fails.

Every character rendered through a font TOFU_BBOX_SHARE has already
condemned counts as missing, so this is the second and final threshold:
how much of the *whole sampled page* has to come from a broken font
before the file as a whole is called unreadable. Set well above zero
because a broken decorative font used for a chapter number or two is
not the same claim as a broken body font — a book is only actually
unusable when most of what a reader would look at is tofu.
"""


def human(n: float) -> str:
    if n < MIB:
        return f"{n / 1024:.0f} KB"
    return f"{n / MIB:.1f} MB"


def size_label(n: int) -> str:
    """The size as a filename wears it: `28MB`.

    Whole megabytes, to the nearest. The tool only ever runs on a book
    over the 100 MB limit, so a result is tens of megabytes and the
    difference between 28 and 28.2 is not a fact worth carrying in a
    filename.
    """
    return f"{round(n / MIB)}MB"


def upload_limit() -> tuple[int, str]:
    """The site's own limit, read from the constant the site enforces.

    Hard-coding it here would be a second copy of a number that has
    already moved once — 64 MB until 2026-08-24 — and the copy that is
    wrong is always the one nobody is looking at. If the source is not
    beside us, because the script was copied somewhere on its own, fall
    back to the published Adobe ceiling and say which was used.
    """
    try:
        text = LIMIT_SOURCE.read_text(encoding="utf-8")
    except OSError:
        return 100 * MIB, "Adobe's published ceiling"

    match = re.search(r"MAX_UPLOAD_BYTES\s*=\s*([\d\s*]+)", text)
    if not match:
        return 100 * MIB, "Adobe's published ceiling"

    size = 1
    for factor in match.group(1).split("*"):
        size *= int(factor.strip())
    return size, "domain/publication.ts"


class Survey:
    """What is actually in a PDF, when PyMuPDF is here to say."""

    def __init__(
        self,
        pages: int,
        images: int,
        dpi: list[float],
        multichannel: int,
        bitonal: int,
        saturated: bool | None = None,
    ):
        self.pages = pages
        self.images = images
        self.dpi = dpi
        self.multichannel = multichannel
        self.bitonal = bitonal
        self.saturated = saturated

    @property
    def median_dpi(self) -> float | None:
        return statistics.median(self.dpi) if self.dpi else None

    @property
    def mostly_bitonal(self) -> bool:
        return self.images > 0 and self.bitonal * 2 > self.images

    @property
    def colour(self) -> bool:
        return self.multichannel > 0

    @property
    def colour_share(self) -> float:
        return self.multichannel / self.images if self.images else 0.0

    @property
    def mostly_colour(self) -> bool:
        return self.colour_share >= COLOUR_PAGES

    @property
    def grey_in_all_but_name(self) -> bool:
        """Colour --gray cannot take away: a few plates, or none at all."""
        if self.images == 0:
            return False
        return not self.mostly_colour or self.saturated is False


class Readability:
    """Whether a PDF's own embedded fonts draw real glyphs or a shared box.

    Two indirect measures were tried and rejected before this one. Asking
    a font's Unicode cmap `has_glyph()` gets a confident, wrong no for a
    CJK font addressed by glyph index rather than code point (SimSun
    subsetted the ordinary way, for one), which draws perfectly well and
    has no such cmap to ask. Asking a font for a glyph's *bounding box*
    sounds more direct and still isn't: PyMuPDF's `glyph_bbox()` returns
    the same box for dozens of genuinely different, correctly-rendering
    Latin letters in an ordinary embedded font — confirmed by rendering
    one such file and reading it, cleanly, off the page — so a box
    collision there proves nothing either.

    What is actually asked here is the only thing that cannot lie: the
    page is rendered, same as a reader's screen would render it, and
    each sampled character's own rectangle of that rendering is reduced
    to a coarse shape signature. A real font draws a different shape for
    every differently-shaped character. A broken subset — given the
    wrong outlines, or none — draws unrelated characters as the same
    tile, because that tile (a tofu box, or its blank cousin) is
    genuinely all that got rendered. Three or more distinct characters
    landing on one signature is that tile, not a coincidence; this is
    the literal, visual answer to whether a book has tofu boxes in it.
    """

    def __init__(
        self,
        pages_checked: int,
        chars_checked: int,
        chars_missing: int,
        unembedded_fonts: list[str],
        sample: str,
    ):
        self.pages_checked = pages_checked
        self.chars_checked = chars_checked
        self.chars_missing = chars_missing
        self.unembedded_fonts = unembedded_fonts
        self.sample = sample

    @property
    def missing_ratio(self) -> float:
        return self.chars_missing / self.chars_checked if self.chars_checked else 0.0

    def readable(self, threshold: float = DEFAULT_MISSING_GLYPH_THRESHOLD) -> bool:
        if self.chars_checked == 0:
            return True
        return self.missing_ratio < threshold


def pymupdf_module():
    """PyMuPDF under either name it goes by, or None if it is not installed.

    Asked rather than assumed, because "not installed" and "installed and
    could not open the file" are the same missing survey downstream and
    want opposite advice: one is a pip install, the other is a file
    Ghostscript may well rewrite anyway.
    """
    try:
        import pymupdf

        return pymupdf
    except ImportError:
        pass
    try:
        import fitz

        return fitz
    except ImportError:
        return None


def saturation(doc, xrefs: list[int], pymupdf) -> bool | None:
    """Whether the pages actually have colour in them, or None if unreadable.

    Decoding is the only way to know, so a handful of images are decoded
    and sampled rather than every one of them: the question is whether
    --gray has anything to take away, and a book that carries colour
    carries it on more pages than four.
    """
    checked = 0
    for xref in xrefs:
        if checked >= COLOUR_SAMPLES:
            break
        try:
            pix = pymupdf.Pixmap(doc, xref)
        except Exception:
            continue
        checked += 1

        channels = pix.n - pix.alpha
        if channels == 1:
            continue
        if channels != 3:
            try:
                pix = pymupdf.Pixmap(pymupdf.csRGB, pix)
            except Exception:
                continue

        data = pix.samples
        stride = pix.n
        points = len(data) // stride
        if not points:
            continue
        step = max(1, points // 2000) * stride

        seen = wide = 0
        for at in range(0, points * stride - stride + 1, step):
            seen += 1
            channel = data[at:at + 3]
            if max(channel) - min(channel) > COLOUR_SPREAD:
                wide += 1
        if seen and wide > seen * COLOUR_POINTS:
            return True

    return False if checked else None


def survey(path: Path, sample: int = 40) -> Survey | None:
    """Sample the pages for image resolution, or None if it cannot be read.

    A file too broken to survey may still be one Ghostscript can rewrite,
    and rewriting is often what repairs it — so an unreadable file costs
    the report rather than the run. Which of the two Nones this is, a
    caller settles with pymupdf_module().
    """
    pymupdf = pymupdf_module()
    if not pymupdf:
        return None

    try:
        with pymupdf.open(path) as doc:
            pages = doc.page_count
            step = max(1, pages // sample)
            dpi: list[float] = []
            images = 0
            bitonal = 0
            multichannel = 0
            xrefs: list[int] = []
            for index in range(0, pages, step):
                for info in doc[index].get_image_info(xrefs=True):
                    images += 1
                    if info.get("xref"):
                        xrefs.append(info["xref"])
                    width = info.get("bbox", (0, 0, 0, 0))[2] - info["bbox"][0]
                    if width > 1 and info.get("width"):
                        dpi.append(info["width"] / (width / 72))
                    if info.get("bpc", 8) == 1:
                        bitonal += 1
                    if info.get("cs-name", "") not in ("DeviceGray", ""):
                        multichannel += 1
            found = Survey(pages, images, dpi, multichannel, bitonal)
            if not found.mostly_colour:
                return found
            return Survey(
                pages, images, dpi, multichannel, bitonal, saturation(doc, xrefs, pymupdf)
            )
    except Exception:
        return None


SUBSET_TAG = re.compile(r"^[A-Z]{6}\+")


def _strip_subset_tag(basefont: str) -> str:
    """Undo the "ABCDEF+" subset prefix a PDF gives an embedded font.

    `page.get_fonts()` reports the raw basefont, tag included, but the
    span dict PyMuPDF hands back for actual text (`get_text("dict")`)
    already reports the font by its name with that tag stripped -- the
    two are the same font under two different spellings, and matching
    the tagged name against the untagged span would silently match
    nothing.
    """
    return SUBSET_TAG.sub("", basefont)


def check_readability(
    path: Path, pages: int = GLYPH_SAMPLE_PAGES, max_chars: int = GLYPH_SAMPLE_CHARS
) -> Readability | None:
    """Render sampled pages and ask whether distinct characters look alike.

    `page.get_text()` is not asked here — it reads the `ToUnicode` CMap,
    which answers "what character is this", not "what did the font draw
    for it". Neither is a font's own `has_glyph()` or `glyph_bbox()`: the
    first is blind to CID-keyed fonts (SimSun subsetted for Identity-H
    text, the ordinary case for an exported Chinese book) that carry no
    Unicode cmap at all despite drawing correctly, and the second was
    tried and caught giving one identical box to dozens of genuinely
    different, correctly-rendering Latin letters in a real book — both
    looked like the right question and were actually a different one.

    What is rendered instead is the page itself, exactly as a reader
    would see it, via `page.get_pixmap()`. `page.get_texttrace()` gives
    the on-page rectangle each sampled character was actually drawn
    into; that rectangle is cropped out of the rendered page and reduced
    to a coarse GLYPH_GRID x GLYPH_GRID signature (SHAPE_QUANTUM below),
    coarse enough to survive anti-aliasing but not so coarse that two
    different ideographs' stroke patterns wash out to the same average.
    Three or more distinct characters (SHAPE_COLLISION_MIN) landing on
    one signature is the tofu box itself, not a coincidence -- an
    ordinary font never draws unrelated characters identically, and a
    broken subset does exactly that for however much of its alphabet was
    never given real outlines.

    max_chars is a budget divided evenly across the sampled pages, not a
    single running total -- a title page or cover that repeats one or
    two characters hundreds of times would otherwise spend the whole
    budget before a page with any variety was ever read.

    Returns None if PyMuPDF is not installed or the file cannot be
    opened; the difference is what `pymupdf_module()` is for, same as
    `survey()`.
    """
    pymupdf = pymupdf_module()
    if not pymupdf:
        return None

    try:
        doc = pymupdf.open(path)
    except Exception:
        return None

    with doc:
        checked_pages = min(pages, doc.page_count)
        step = max(1, doc.page_count // checked_pages) if checked_pages else 1
        per_page_cap = max(1, max_chars // checked_pages) if checked_pages else max_chars
        checked = 0
        sample_chars: list[str] = []
        shapes: list[tuple] = []
        chars_by_shape: dict[tuple, set[str]] = {}

        for index in range(0, doc.page_count, step):
            if checked >= max_chars:
                break
            page = doc[index]

            try:
                traces = page.get_texttrace()
            except Exception:
                continue
            if not traces:
                continue

            try:
                pix = page.get_pixmap(colorspace=pymupdf.csGRAY)
            except Exception:
                continue

            page_checked = 0
            for item in traces:
                if checked >= max_chars or page_checked >= per_page_cap:
                    break
                for char in item.get("chars", ()):
                    if checked >= max_chars or page_checked >= per_page_cap:
                        break
                    unicode_point, _glyph_id, _origin, bbox = char[0], char[1], char[2], char[3]
                    ch = chr(unicode_point)
                    if ch.isspace():
                        continue

                    shape = _render_shape(pix, bbox)
                    if shape is None:
                        continue

                    checked += 1
                    page_checked += 1
                    if len(sample_chars) < 40:
                        sample_chars.append(ch)
                    shapes.append(shape)
                    chars_by_shape.setdefault(shape, set()).add(ch)

        collisions = {
            shape for shape, chars in chars_by_shape.items() if len(chars) >= SHAPE_COLLISION_MIN
        }
        missing = sum(1 for shape in shapes if shape in collisions) if len(shapes) >= SHAPE_MIN_SAMPLES else 0

        return Readability(
            pages_checked=min(checked_pages, doc.page_count),
            chars_checked=checked,
            chars_missing=missing,
            unembedded_fonts=[],
            sample="".join(sample_chars),
        )


def _render_shape(pix, bbox) -> tuple | None:
    """Reduce one character's rendered rectangle to a coarse grey signature.

    Returns None for a rectangle too small to say anything -- a space
    glyph's box, or a rendering artefact -- rather than let a
    near-empty crop pass as a legitimate shape one way or the other.
    """
    x0 = max(0, min(pix.width, int(bbox[0])))
    x1 = max(0, min(pix.width, int(bbox[2]) + 1))
    y0 = max(0, min(pix.height, int(bbox[1])))
    y1 = max(0, min(pix.height, int(bbox[3]) + 1))
    if x1 - x0 < 2 or y1 - y0 < 2:
        return None

    samples = pix.samples
    stride = pix.stride
    cell_w = (x1 - x0) / GLYPH_GRID
    cell_h = (y1 - y0) / GLYPH_GRID
    cells = []
    for grid_y in range(GLYPH_GRID):
        cy0 = y0 + int(grid_y * cell_h)
        cy1 = max(cy0 + 1, y0 + int((grid_y + 1) * cell_h))
        for grid_x in range(GLYPH_GRID):
            cx0 = x0 + int(grid_x * cell_w)
            cx1 = max(cx0 + 1, x0 + int((grid_x + 1) * cell_w))
            total = 0
            count = 0
            for py in range(cy0, min(cy1, pix.height)):
                row = py * stride
                for px in range(cx0, min(cx1, pix.width)):
                    total += samples[row + px]
                    count += 1
            cells.append((total // count // SHAPE_QUANTUM) if count else 255 // SHAPE_QUANTUM)
    return tuple(cells)


def _load_span_font(doc, font_info, pymupdf):
    """Build a `Font` from the font a text span actually names, or None.

    None means "cannot check", not "cannot draw" — a font the PDF does
    not embed (the common case for a plain Latin body font) has no
    program here to load, so a span using it is skipped rather than
    counted as broken.
    """
    if font_info is None:
        return None
    xref = font_info[0]
    try:
        extracted = doc.extract_font(xref)
    except Exception:
        return None
    buffer = extracted[3] if len(extracted) > 3 else None
    if not buffer:
        return None
    try:
        return pymupdf.Font(fontbuffer=buffer)
    except Exception:
        return None


def describe_readability(path: Path, found: Readability | None) -> None:
    """Print what check_readability found, in the voice describe() uses."""
    if found is None:
        if pymupdf_module():
            print("  Could not check whether the embedded fonts render — the file would")
            print("  not open for this pass either.")
        else:
            print("  PyMuPDF is not installed, so glyph coverage cannot be checked —")
            print("  pip install pymupdf")
        return

    if found.chars_checked == 0:
        print("  No text found to check glyph coverage against.")
        return

    ratio = found.missing_ratio
    if found.readable():
        verdict = "renders" if ratio == 0 else f"renders ({ratio:.0%} of sampled glyphs are shared tofu boxes)"
    else:
        verdict = f"DOES NOT RENDER — {ratio:.0%} of sampled characters draw as a shared blank box"
    print(
        f"  Glyph check: {verdict}, over {found.chars_checked} characters"
        f" across {found.pages_checked} pages"
    )
    if not found.readable():
        print("  The text layer (ToUnicode) is likely correct — copy-paste and OCR")
        print("  both read fine — but the embedded font draws many unrelated characters")
        print("  as the exact same rectangle, so every viewer shows tofu boxes instead of")
        print("  text.")
        print("  Treat the PDF as unusable for reading; a paired .txt/.docx source, or")
        print("  a fresh export from the original, is the one to keep.")
    if found.unembedded_fonts:
        names = ", ".join(found.unembedded_fonts)
        print(f"  Not embedded, so not checked: {names}")


def compression(path: Path) -> dict[str, int]:
    """Tally the compression filters named in the raw bytes.

    The fallback for a file PyMuPDF cannot open, or a machine where it is
    not installed — which is where the diagnosis is needed most, since
    without it nothing else can say why a scan will not shrink. A PDF that
    keeps its object dictionaries in compressed object streams hides them
    from this, so an empty tally means "cannot tell", never "no images".
    """
    found = {name.decode().lstrip("/"): 0 for name in FILTERS}
    try:
        with path.open("rb") as handle:
            tail = b""
            while True:
                chunk = handle.read(4 * MIB)
                if not chunk:
                    break
                window = tail + chunk
                for name in FILTERS:
                    found[name.decode().lstrip("/")] += window.count(name)
                tail = window[-32:]
    except OSError:
        return {}
    return {name: count for name, count in found.items() if count}


def page_count(path: Path) -> int | None:
    found = survey(path, sample=1)
    return found.pages if found else None


def ghostscript_binary() -> str | None:
    for name in GS_BINARIES:
        found = shutil.which(name)
        if found:
            return found
    return None


def ghostscript(
    src: Path, dst: Path, dpi: int, quality: int, gray: bool, mono_dpi: int
) -> str | None:
    """Re-encode `src` into `dst`. Returns an error message, or None.

    Three of these are traps rather than tuning. The two pass-through
    switches default on, which hands an existing JPEG or JPEG 2000 image
    through untouched; with passthrough left on, QFactor 2.0 returned a
    5034 KB scan as 5041 KB, and with it off the same call returned
    2981 KB, so the flag gates the whole quality lever rather than
    trimming it. The JPX one matters on Ghostscript 10, where it is the
    difference between a re-encoded scan and a copy. And Ghostscript
    leaves an image alone until it is half again over target, which makes
    the requested resolution a suggestion and the resulting size
    unpredictable, so the downsample thresholds are pinned to 1.0 to get
    what was asked for.
    """
    binary = ghostscript_binary()
    if not binary:
        return f"ghostscript not found on PATH (looked for {', '.join(GS_BINARIES)})"

    args = [
        binary,
        "-q",
        "-dSAFER",
        "-dBATCH",
        "-dNOPAUSE",
        "-sDEVICE=pdfwrite",
        "-dCompatibilityLevel=1.7",
        "-dAutoRotatePages=/None",
        "-dDetectDuplicateImages=true",
        "-dCompressFonts=true",
        "-dSubsetFonts=true",
        "-dPassThroughJPEGImages=false",
        "-dPassThroughJPXImages=false",
        "-dAutoFilterColorImages=false",
        "-dAutoFilterGrayImages=false",
        "-dColorImageFilter=/DCTEncode",
        "-dGrayImageFilter=/DCTEncode",
        "-dDownsampleColorImages=true",
        "-dColorImageDownsampleType=/Bicubic",
        f"-dColorImageResolution={dpi}",
        "-dDownsampleGrayImages=true",
        "-dGrayImageDownsampleType=/Bicubic",
        f"-dGrayImageResolution={dpi}",
        "-dDownsampleMonoImages=true",
        "-dMonoImageDownsampleType=/Subsample",
        f"-dMonoImageResolution={max(dpi, mono_dpi)}",
        "-dColorImageDownsampleThreshold=1.0",
        "-dGrayImageDownsampleThreshold=1.0",
        "-dMonoImageDownsampleThreshold=1.0",
    ]
    if gray:
        args += ["-sColorConversionStrategy=Gray", "-dProcessColorModel=/DeviceGray"]

    sampling = "/Blend 1 /HSamples [2 1 1 2] /VSamples [2 1 1 2]"
    image_dict = (
        f"<</ColorImageDict <</QFactor {qfactor(quality)} {sampling}>>"
        f" /GrayImageDict <</QFactor {qfactor(quality)} {sampling}>>>> setdistillerparams"
    )
    args += [f"-sOutputFile={dst}", "-c", image_dict, "-f", str(src)]

    try:
        done = subprocess.run(args, capture_output=True, text=True)
    except OSError as failure:
        return f"could not run {binary}: {failure}"

    if done.returncode != 0:
        detail = (done.stderr or done.stdout or "").strip().splitlines()
        return detail[-1] if detail else f"ghostscript exited {done.returncode}"
    if not dst.exists() or dst.stat().st_size == 0:
        return "ghostscript wrote nothing"
    return None


def rungs_for(min_dpi: int, found: Survey | None) -> list[int]:
    """The ladder to walk, trimmed to what the scan can answer.

    Ghostscript will not invent detail, so a rung above the scan's own
    resolution is the same file written out again — minutes of work for a
    result the next rung down beats on every axis. Without PyMuPDF there
    is nothing to trim against and the whole ladder is walked, which is
    why the unchanged-rung rule has to carry the same job empirically.

    A scan below *every* rung --min-dpi allows gets exactly one, the
    floor. This is the case the trimming exists for and the one it used
    to miss: a 150 dpi book under a 200 dpi floor left nothing "within"
    the scan, and falling back to the whole ladder walked 400, 300, 250
    and 200 to prove four times that the images are not 400 dpi — five
    minutes of Ghostscript on a 200 MB book for four identical files.
    One pass still re-encodes, which is the only lever left at that
    floor, and the report says so rather than implying a rung helped.
    """
    ladder = [d for d in DPI_LADDER if d >= min_dpi] or [min_dpi]

    median = found.median_dpi if found else None
    if not median:
        return ladder

    within = [d for d in ladder if d <= median * 1.05]
    return within or ladder[-1:]


def describe(path: Path, found: Survey | None, readability: Readability | None = None) -> None:
    print(f"{path.name}: {human(path.stat().st_size)}")
    filters = compression(path)

    if not found:
        if pymupdf_module():
            print("  PyMuPDF is installed and could not open this file, so the ladder")
            print("  cannot be trimmed to the scan's own resolution. Ghostscript rewrites")
            print("  a file this broken often enough that the run is still worth making.")
        else:
            print("  PyMuPDF is not installed, so the ladder cannot be trimmed to this")
            print("  scan's own resolution — pip install pymupdf")
        if filters:
            print("  compression: " + ", ".join(f"{k} x{v}" for k, v in filters.items()))
        if readability is not None:
            describe_readability(path, readability)
        return

    plural = "" if found.pages == 1 else "s"
    print(f"  {found.pages} page{plural}, {found.images} images sampled", end="")
    if found.median_dpi:
        print(f", around {found.median_dpi:.0f} dpi", end="")
    if not found.colour:
        print(", greyscale or bitonal")
    elif found.saturated is False:
        print(", stored as colour but grey on the page")
    elif not found.mostly_colour:
        print(f", grey pages and some colour ({found.colour_share:.0%} of the images)")
    else:
        print(", colour")
    if filters:
        print("  compression: " + ", ".join(f"{k} x{v}" for k, v in filters.items()))
    if found.mostly_bitonal:
        print("  Mostly bitonal pages, held at --mono-dpi rather than following the")
        print("  ladder: resampling a 1-bit scan destroys it. Lower --mono-dpi to move them.")
    if found.images == 0:
        print("  No raster content — this is not a scan, and resampling has")
        print("  nothing to work on. Look at embedded fonts or attachments.")
    if readability is not None:
        describe_readability(path, readability)


def shrink(
    src: Path, out_dir: Path, explicit: Path | None, target: int, args: argparse.Namespace
) -> bool:
    """Walk the ladder until something fits, then put it in place.

    Attempts are written beside the destination so the winner is a rename
    rather than a copy, and so a 200 MB attempt cannot fill a small /tmp.

    A rung that does not shrink the file is recorded as unchanged and
    poisons nothing: the predictor is dropped, so the next rung is
    measured rather than guessed at. Skipping on an estimate is only
    sound while the estimate comes from a rung that actually worked, and
    "worked" is measured against the rung above rather than against the
    input — otherwise the re-encoding every rung does is read as a
    downsample, and a ladder that is doing nothing looks like one that
    is working. Whether the file moved at all is the separate question,
    and it is the one the advice at the end answers.

    Two rungs returning the same size say the images are below both of
    them and resolution is not engaging, which is said on the line rather
    than left for somebody to notice in a column of identical numbers.
    The ladder still descends one rung at a time, because the rung that
    finally engages is the best one that can, and only PyMuPDF can say
    where that is without measuring.
    """
    size = src.stat().st_size
    found = survey(src)
    describe(src, found)

    if size <= target and not args.force:
        print(f"  Already under {human(target)}. Nothing to do.\n")
        return True

    ladder = rungs_for(args.min_dpi, found)
    median = found.median_dpi if found else None
    if median and ladder[-1] >= median:
        print(f"  Around {median:.0f} dpi already, under every rung --min-dpi allows, so")
        print(f"  this is one pass at {ladder[-1]} dpi that re-encodes and downsamples nothing.")
    if args.min_dpi < DEFAULT_MIN_DPI:
        print(
            f"  Ladder goes down to {args.min_dpi} dpi, below the {DEFAULT_MIN_DPI} dpi"
            " OCR floor — check a page before trusting the master."
        )

    workdir = Path(tempfile.mkdtemp(prefix=".shrink-", dir=out_dir))
    attempt = workdir / "attempt.pdf"
    tried: list[tuple[int, int, bool]] = []
    last: tuple[int, int] | None = None
    previous: int | None = None
    responded = False

    try:
        for dpi in ladder:
            if last:
                predicted = last[1] * (dpi / last[0]) ** 2
                if predicted > target * SKIP_SLACK:
                    print(f"  {dpi:>4} dpi  skipped, ≈{human(predicted)} by the last result")
                    tried.append((dpi, int(predicted), False))
                    continue

            started = time.monotonic()
            error = ghostscript(src, attempt, dpi, args.quality, args.gray, args.mono_dpi)
            if error:
                print(f"  {dpi:>4} dpi  failed: {error}")
                return False

            made = attempt.stat().st_size
            elapsed = time.monotonic() - started
            fits = made <= target
            moved = made <= size * RESPONSE_FLOOR
            engaged = previous is not None and made <= previous * RESPONSE_FLOOR
            note = "fits" if fits else "still too big" if moved else "unchanged by this rung"
            if previous and abs(made - previous) < previous * 0.01:
                note += ", same as the last rung"
            print(f"  {dpi:>4} dpi  {human(made):>9}  {elapsed:.0f}s  {note}")
            previous = made
            tried.append((dpi, made, True))

            if fits:
                return finish(src, attempt, out_dir, explicit, dpi, made, size)

            responded = responded or moved
            last = (dpi, made) if engaged else None

        report_failure(tried, args, found, responded, size)
        return False
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


def report_failure(
    tried: list[tuple[int, int, bool]],
    args: argparse.Namespace,
    found: Survey | None,
    responded: bool,
    size: int,
) -> None:
    """Say how close the ladder got, and what is left to try.

    Only what is not already in play is offered: telling somebody to try
    the flag they just used is how a tool teaches you to stop reading it.

    Three endings, not two. A file no rung moved, a file the ladder
    shrank and not far enough, and — the one that reads as the second
    but is not — a file that got smaller without a single rung
    downsampling anything, because the scan is already below the floor.
    Reporting that as "smallest was 163.6 MB at 250 dpi" credits a rung
    that did nothing and sends the next run down a ladder that cannot
    help. What helped was the re-encoding, and what is left is the
    flags that re-encode harder.
    """
    floor = min(tried, key=lambda rung: rung[1])
    measured = min((r for r in tried if r[2]), key=lambda rung: rung[1])
    lowest = min(r[0] for r in tried if r[2])
    median = found.median_dpi if found else None
    flat = median is not None and lowest >= median

    if not responded:
        print(f"  No rung changed the file, so resolution is not the lever here.")
        print(f"  The images are at or below {lowest} dpi, or already compressed")
        print(f"  harder than quality {args.quality}, so downsampling them does nothing.")
    elif flat:
        off = 100 - (measured[1] * 100 // max(size, 1))
        print(f"  Re-encoding alone took {off}% off, to {human(measured[1])}, and that is all")
        print(f"  the ladder had: around {median:.0f} dpi, this scan is under the {lowest} dpi")
        print(f"  floor, so no rung downsampled anything and none of them could have.")
    else:
        print(
            f"  Nothing on the ladder fits. Smallest was {human(measured[1])} at {measured[0]} dpi",
            end="",
        )
        if floor is not measured:
            print(f", and {floor[0]} dpi would be around {human(floor[1])}.")
        else:
            print(".")

    under = [d for d in DPI_LADDER if median and d < median]

    options = []
    if args.quality > 50:
        options.append(
            f"--quality under {args.quality}, which recompresses the images even"
            " when nothing downsamples"
        )
    if not args.gray and not (found and found.grey_in_all_but_name):
        options.append(
            "--gray, this scan carries real colour and the text almost certainly does not"
            if found and found.mostly_colour
            else "--gray, if the book is black-and-white and the scan is not"
        )
    elif not args.gray:
        print("  --gray is not one of them: the pages are already grey, and dropping")
        print("  colour planes that hold no colour saves nothing.")
    if flat and under:
        options.append(
            f"--min-dpi {under[0]}, the first rung under this scan's own {median:.0f} dpi"
            f" and the point where resolution starts to do anything — below the"
            f" {DEFAULT_MIN_DPI} dpi OCR floor, so read a page before trusting it"
        )
    elif args.min_dpi > min(DPI_LADDER) and responded and not flat:
        options.append(f"--min-dpi under {args.min_dpi}, checking a page afterwards")
    if (found is None or found.mostly_bitonal) and args.mono_dpi > min(DPI_LADDER):
        options.append(f"--mono-dpi under {args.mono_dpi}, if the pages are bitonal")
    if found is None and not pymupdf_module():
        options.append("pip install pymupdf, so the next run can say what is in the file")
    for option in options:
        print(f"    {option}")
    print("  A book too large for any of those wants rescanning, not splitting —")
    print("  a book is whole, and half a scan is not a book.")


def finish(
    src: Path,
    attempt: Path,
    out_dir: Path,
    explicit: Path | None,
    dpi: int,
    made: int,
    was: int,
) -> bool:
    """Check the result is the same book, then put it in place.

    The name carries the size it came out at, which is the one fact you
    want when the whole point was getting under a number, and it is only
    knowable once the work is done — so the destination is settled here
    rather than before the ladder is walked.
    """
    dst = explicit or out_dir / f"{src.stem}-{size_label(made)}{src.suffix}"
    if dst.resolve() == src.resolve():
        print(f"  Refusing it: that would write over {src.name}.")
        return False

    before, after = page_count(src), page_count(attempt)
    if before is not None and after is not None and before != after:
        print(f"  Refusing it: {before} pages in, {after} out. Ghostscript lost pages.")
        return False

    os.replace(attempt, dst)
    saved = 100 - (made * 100 // max(was, 1))
    print(f"  -> {dst} at {dpi} dpi, {human(was)} to {human(made)} ({saved}% off)\n")
    return True


def clean_stem(stem: str) -> str:
    """Strip a leading/trailing run of digits and '-' from a file's stem.

    Applied once, as a single contiguous run from each edge -- not
    repeatedly and not token-by-token -- so a title that legitimately
    starts or ends with a number in the middle of other characters is
    left alone.

    The separator the digits were hanging off goes with them, or the
    tidied name ends in the dot that used to introduce a volume number
    and "...出版社.19.pdf" becomes "...出版社..pdf". A leading one matters
    for a second reason: a name starting with '.' is a hidden file.
    """
    cleaned = TRAILING.sub("", LEADING.sub("", stem))
    return cleaned.strip(SEPARATORS)


def unique_path(path: Path) -> Path:
    """Avoid clobbering an unrelated file already at the clean name.

    Numbered the same way NobleSee's own storage numbers a repeated stem
    (docs/STORAGE.md section 14): stem, stem-2, stem-3, ...
    """
    if not path.exists():
        return path
    n = 2
    while True:
        candidate = path.with_name(f"{path.stem}-{n}{path.suffix}")
        if not candidate.exists():
            return candidate
        n += 1


def _cli_error(message: str) -> int:
    print(message, file=sys.stderr)
    return 2


def _main() -> int:
    """`python tools/pdf.py --check-readable file.pdf [...]`.

    The library has no CLI banner of its own by design (clean-pdf.py and
    shrink-pdf.py own that), but the glyph check is useful standalone —
    this is the one entry point kept here, for exactly that.
    """
    parser = argparse.ArgumentParser(
        description="Shared PDF engine for clean-pdf.py and shrink-pdf.py.",
    )
    parser.add_argument("pdf", nargs="+", type=Path)
    parser.add_argument(
        "--check-readable",
        action="store_true",
        help="check whether the embedded fonts can draw the file's own text",
    )
    args = parser.parse_args()

    if not args.check_readable:
        return _cli_error("Nothing to do — pdf.py is a library; try --check-readable.")

    failed = 0
    for path in args.pdf:
        if not path.is_file():
            print(f"{path}: no such file")
            failed += 1
            continue
        found = check_readability(path)
        print(f"{path.name}")
        describe_readability(path, found)
        if found is not None and not found.readable():
            failed += 1
        print()

    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(_main())
