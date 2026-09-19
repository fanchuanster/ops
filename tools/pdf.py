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
GLYPH_SAMPLE_CHARS = 20000
"""How much of a book is read before judging whether it renders.

A book that is broken is broken on every page, since a font is embedded
once for the whole file — so a sample well short of the whole book
answers the question as well as reading all of it would. The budget is
generous because nothing is rendered to spend it: counting characters
is cheap, and a vocabulary measured over thousands of them separates a
real text from a collapsed one by a wider margin than one measured over
hundreds. Divided across the sampled pages rather than run down in one
go, so a title page that repeats one or two characters hundreds of
times can't burn through the whole budget before a page with real
variety is ever reached.
"""

IDEOGRAPH_MIN_SAMPLE = 200
"""Ideographs a file must draw before its vocabulary is judged at all.

A cover, a colophon or a two-line epigraph is legitimately repetitive,
and a handful of characters says nothing either way. Below this count
the check abstains rather than guesses.
"""

IDEOGRAPH_MIN_DISTINCT = 20
"""Distinct ideographs below which a stretch of Chinese is not Chinese.

Chinese prose of any real length draws on hundreds of characters -- the
smallest healthy sample measured here, sixty-nine ideographs of a seed
book, still used forty-two distinct ones. A file that draws thousands
of ideographs from a vocabulary under twenty is not a book rendering
badly; it is a text layer that collapsed, every character carrying the
same code point because the conversion that produced it lost the
mapping and wrote one glyph everywhere.
"""

IDEOGRAPH_VARIETY_SAMPLE = 2000
IDEOGRAPH_VARIETY_FLOOR = 0.01
"""Vocabulary-to-volume ratio a long stretch of ideographs must clear.

The absolute floor above catches a text layer that collapsed onto one
character. This catches one that collapsed onto a few dozen: over a
long sample a real text keeps introducing characters, so its ratio
stays an order of magnitude clear of this even as it falls with length.
The Gandhi biography, nine thousand ideographs deep, sits at 0.13, and
the floor is set a hundredfold below that.
"""

DEFAULT_MISSING_GLYPH_THRESHOLD = 0.3
"""Share of sampled characters a collapse has to cover to fail the file.

Every ideograph in a collapsed text layer counts as missing, so this is
the second and final threshold: how much of the *whole sampled page*
has to be that collapse before the file is called unreadable. Set well
above zero because a book with one broken decorative font and a sound
body is not the claim being made — a book is only actually unusable
when most of what a reader would look at is tofu.
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
    """Whether a PDF's text is a text, or one character wearing a book's clothes.

    Three indirect measures were tried and rejected before this one,
    each confirmed wrong against a rendered page rather than argued
    away. Asking a font's Unicode cmap `has_glyph()` gets a confident,
    wrong no for a CJK font addressed by glyph index rather than code
    point (SimSun subsetted for Identity-H, the ordinary case for an
    exported Chinese book), which draws perfectly well and has no such
    cmap to ask. Asking for a glyph's *bounding box* sounds more direct
    and still isn't: PyMuPDF returns one identical box for dozens of
    genuinely different, correctly-rendering Latin letters. Rendering
    every character and comparing shape signatures is the right
    question asked of the wrong evidence -- it can only fire when
    several *distinct* code points share one shape, and the book it was
    built to catch had already collapsed every character onto a single
    code point, leaving nothing to collide. It called that book clean
    and a healthy one 74% broken.

    What is asked instead is the vocabulary. A Chinese book draws on
    hundreds to thousands of distinct characters and keeps finding new
    ones as it runs; a collapsed text layer draws thousands of
    characters from a vocabulary of one. That is not a proxy for the
    tofu a reader sees -- it is the same fault, read off the text layer
    instead of the screen, and it costs no rendering at all.
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


def check_readability(
    path: Path, pages: int = GLYPH_SAMPLE_PAGES, max_chars: int = GLYPH_SAMPLE_CHARS
) -> Readability | None:
    """Sample a book's ideographs and ask how many of them are different.

    Three more direct-sounding measures were tried before this one and
    all three answered a different question than the one being asked;
    `Readability` records what each got wrong. What survives is the
    observation that a text is a text because it says many things. A
    Chinese book draws on a vocabulary of hundreds to thousands of
    characters and keeps reaching for new ones the longer it runs. A
    file whose text layer has collapsed cannot do that: every character
    on the page carries one code point, because the conversion that
    produced it lost the glyph-to-character mapping and wrote the same
    one everywhere.

    That collapse is not a proxy for the tofu a reader sees; it is the
    same fault seen from the other side. The book this was built
    against draws forty-five thousand ideographs from a vocabulary of
    exactly one, through a Lisu font and a Latin monospace font that
    contain no ideographs at all, and renders as page after page of
    empty rectangles. Nothing needs to be rendered to know that, which
    is why nothing is.

    Latin text is left alone. Twenty-six letters carry English the way
    three thousand characters carry Chinese, so a small vocabulary
    there is ordinary rather than evidence, and this check has nothing
    to say about it.

    max_chars is a budget divided evenly across the sampled pages, not
    a single running total -- a title page that repeats one or two
    characters hundreds of times would otherwise spend the whole budget
    before a page with any variety was ever read.

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
        ideographs = 0
        vocabulary: set[str] = set()
        sample_chars: list[str] = []

        for index in range(0, doc.page_count, step):
            if checked >= max_chars:
                break
            page = doc[index]

            try:
                traces = page.get_texttrace()
            except Exception:
                continue

            page_checked = 0
            for item in traces:
                if checked >= max_chars or page_checked >= per_page_cap:
                    break
                for char in item.get("chars", ()):
                    if checked >= max_chars or page_checked >= per_page_cap:
                        break
                    ch = chr(char[0])
                    if ch.isspace():
                        continue

                    checked += 1
                    page_checked += 1
                    if len(sample_chars) < 40:
                        sample_chars.append(ch)
                    if _is_ideograph(ch):
                        ideographs += 1
                        vocabulary.add(ch)

        collapsed = _collapsed(ideographs, len(vocabulary))

        return Readability(
            pages_checked=min(checked_pages, doc.page_count),
            chars_checked=checked,
            chars_missing=ideographs if collapsed else 0,
            unembedded_fonts=[],
            sample="".join(sample_chars),
        )


def _is_ideograph(ch: str) -> bool:
    """Whether a character is a Han ideograph, the script this check reads.

    Kana, hangul, Latin and punctuation are excluded deliberately: each
    has its own natural vocabulary size, and only Han has one large
    enough for a collapsed text layer to stand out against.
    """
    point = ord(ch)
    return (
        0x4E00 <= point <= 0x9FFF
        or 0x3400 <= point <= 0x4DBF
        or 0xF900 <= point <= 0xFAFF
        or 0x20000 <= point <= 0x2FA1F
    )


def _collapsed(instances: int, distinct: int) -> bool:
    """Whether this many ideographs from this small a vocabulary can be a text.

    Two ways of failing, one absolute and one proportional, because a
    text layer can collapse completely or only mostly.
    """
    if instances < IDEOGRAPH_MIN_SAMPLE:
        return False
    if distinct < IDEOGRAPH_MIN_DISTINCT:
        return True
    return (
        instances >= IDEOGRAPH_VARIETY_SAMPLE
        and distinct / instances < IDEOGRAPH_VARIETY_FLOOR
    )


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
        print("  No text layer to read — nothing was drawn as text on the sampled")
        print("  pages, so this is a scan and the OCR stage is what answers for it.")
        return

    ratio = found.missing_ratio
    if found.readable():
        verdict = "renders"
    else:
        verdict = f"DOES NOT RENDER — {ratio:.0%} of sampled characters are one repeated code point"
    print(
        f"  Text check: {verdict}, over {found.chars_checked} characters"
        f" across {found.pages_checked} pages"
    )
    if not found.readable():
        print("  The text layer has collapsed: the file draws thousands of ideographs")
        print("  from a vocabulary of a handful, which no real book does. Copy-paste and")
        print("  OCR will not rescue it either — the characters are simply not in the")
        print("  file, and every viewer shows tofu boxes where they should be.")
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
