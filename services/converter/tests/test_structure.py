"""Tests for the structure pass.

These build synthetic pages with the geometry measured off the real scan,
so a threshold that drifts fails here rather than silently mangling a book
three hours into a conversion.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.models import BlockKind, Box, OcrPage, OcrSpan  # noqa: E402
from app.pipeline.lines import group_lines  # noqa: E402
from app.pipeline.normalize import (  # noqa: E402
    NormalizationLog,
    normalize_attribution,
    normalize_text,
)
from app.pipeline.render import OutlineEntry  # noqa: E402
from app.pipeline.structure import build_document, extract_ref  # noqa: E402

# The scan's usual page box.
W, H = 1634, 2400


def span(text: str, x0f: float, y0f: float, *, wf: float, hf: float = 0.027, conf=1.0):
    """A span placed by fraction of the page, as the real geometry is."""
    return OcrSpan(
        text=text,
        confidence=conf,
        box=Box(x0f * W, y0f * H, (x0f + wf) * W, (y0f + hf) * H),
    )


def page(index: int, spans: list[OcrSpan]) -> OcrPage:
    return OcrPage(index=index, width=W, height=H, spans=spans)


def kinds(doc):
    return [b.kind for b in doc.blocks]


class TestLineGrouping:
    def test_reference_joins_the_verse_line_it_sits_beside(self):
        # Measured from page 200: the verse box is taller than the
        # reference box and their centres differ, but they are one line.
        verse = span("且听屠门夜半声。", 0.343, 0.278, wf=0.264, hf=0.029)
        ref = span("(见第 211 页)", 0.687, 0.286, wf=0.159, hf=0.022)
        lines = group_lines(page(200, [verse, ref]))
        assert len(lines) == 1
        assert lines[0].spans[0].text.startswith("且听")

    def test_separate_printed_lines_stay_separate(self):
        a = span("举头望明月，", 0.374, 0.232, wf=0.191)
        b = span("低头思故乡。", 0.375, 0.268, wf=0.191)
        assert len(group_lines(page(12, [a, b]))) == 2


class TestReferences:
    @pytest.mark.parametrize(
        "text,expected",
        [
            ("——唐·李商隐《隋宫》（见第76页）", "（见第76页）"),
            ("且听屠门夜半声。 (见第 211 页)", "(见第 211 页)"),
            ("不能容物只容身。 （同上）", "（同上）"),
        ],
    )
    def test_reference_is_split_off(self, text, expected):
        body, ref = extract_ref(text)
        assert ref == expected
        assert "见" not in body and "同上" not in body

    def test_line_without_a_reference_is_untouched(self):
        body, ref = extract_ref("举头望明月，")
        assert ref is None
        assert body == "举头望明月，"


class TestNormalization:
    def test_parentheses_around_chinese_become_full_width(self):
        assert normalize_text("(一)") == "（一）"

    def test_ascii_parentheses_around_latin_are_left_alone(self):
        assert normalize_text("ISBN 7-309-01482-0 (B)") == "ISBN 7-309-01482-0 (B)"

    def test_letterspaced_digits_are_closed_up(self):
        assert normalize_text("(见第 927 页)") == "（见第927页）"

    def test_attribution_dash_is_restored(self):
        assert normalize_attribution("—南怀瑾") == "——南怀瑾"
        assert normalize_attribution("——宋徽宗") == "——宋徽宗"

    def test_every_change_is_logged(self):
        log = NormalizationLog()
        normalize_text("(一)", log)
        assert len(log) == 1
        rule, before, after = log.changes[0]
        assert (before, after) == ("(一)", "（一）")

    def test_an_empty_log_is_still_recorded_into(self):
        # Regression: NormalizationLog defines __len__, so an empty log is
        # falsy. A truthiness guard in normalize_text silently disabled the
        # audit trail for the whole run.
        log = NormalizationLog()
        assert not log
        normalize_text("(二)", log)
        assert len(log) == 1


class TestStructure:
    outline = [OutlineEntry(1, "《论语别裁》诗词", 9)]

    def build(self, pages):
        return build_document(pages, self.outline, "南怀瑾著作诗词辑录")

    def test_running_head_is_dropped(self):
        doc, report = self.build(
            [
                page(
                    10,
                    [
                        span("• 32•", 0.144, 0.069, wf=0.070, hf=0.022),
                        span("南怀瑾著作诗词辑录", 0.589, 0.070, wf=0.237, hf=0.020),
                        span("翩然一只云中鹤，", 0.352, 0.133, wf=0.259),
                    ],
                )
            ]
        )
        assert [b.text for b in doc.blocks] == ["翩然一只云中鹤，"]
        # Page number and book title share a y-band, so they are one line.
        assert len(report.dropped_furniture) == 1
        assert "南怀瑾著作诗词辑录" in report.dropped_furniture[0][1]

    def test_verse_line_breaks_survive(self):
        doc, _ = self.build(
            [
                page(
                    10,
                    [
                        span("举头望明月，", 0.374, 0.232, wf=0.191),
                        span("低头思故乡。", 0.375, 0.268, wf=0.191),
                    ],
                )
            ]
        )
        assert kinds(doc) == [BlockKind.VERSE]
        assert doc.blocks[0].lines == ["举头望明月，", "低头思故乡。"]

    def test_a_poem_continues_across_a_page_break(self):
        doc, _ = self.build(
            [
                page(10, [span("皇恐滩头说皇恐，", 0.347, 0.845, wf=0.260)]),
                page(11, [span("零丁洋里叹零丁。", 0.347, 0.130, wf=0.260)]),
            ]
        )
        assert kinds(doc) == [BlockKind.VERSE]
        assert len(doc.blocks[0].lines) == 2

    def test_prose_wrapping_onto_a_dash_is_not_an_attribution(self):
        # Page 5. The line begins with an em-dash but runs the full
        # measure, so it is prose continuing, not a source.
        doc, _ = self.build(
            [
                page(
                    10,
                    [
                        span("通”。一通学问涵盖儒释道，博古通今；二通", 0.113, 0.396, wf=0.738),
                        span("—老师著作通俗易懂，把深奥的古代经典，用现", 0.119, 0.470, wf=0.733),
                    ],
                )
            ]
        )
        assert kinds(doc) == [BlockKind.BODY]

    def test_a_verse_line_with_a_stray_dash_is_not_an_attribution(self):
        doc, _ = self.build(
            [
                page(
                    10,
                    [
                        span("直到天门最高处，", 0.345, 0.232, wf=0.260),
                        span("——不能容物只容身。", 0.345, 0.268, wf=0.290),
                    ],
                )
            ]
        )
        assert kinds(doc) == [BlockKind.VERSE]

    def test_a_real_attribution_is_recognised(self):
        doc, _ = self.build(
            [
                page(
                    10,
                    [
                        span("目断天南无雁飞。", 0.370, 0.439, wf=0.260),
                        span("——宋徽宗", 0.472, 0.480, wf=0.131, hf=0.022),
                    ],
                )
            ]
        )
        assert kinds(doc) == [BlockKind.VERSE, BlockKind.ATTRIBUTION]

    def test_indent_starts_a_new_prose_paragraph(self):
        doc, _ = self.build(
            [
                page(
                    10,
                    [
                        span("于世，功德无量，当今学界，似尚无人出其右。", 0.119, 0.543, wf=0.663),
                        span("读了南老师那么多的书，我有一个“预言”：", 0.186, 0.580, wf=0.666),
                        span("“南怀瑾”三个字将会成为一门学问。本人苦于才", 0.115, 0.615, wf=0.735),
                    ],
                )
            ]
        )
        assert kinds(doc) == [BlockKind.BODY, BlockKind.BODY]
        assert doc.blocks[1].text.startswith("读了南老师")

    def test_chapter_title_comes_from_the_outline_not_ocr(self):
        # OCR loses the first character of widely-spaced display type, so
        # the printed heading reads 「录」 rather than 「目录」. The outline
        # is authoritative.
        doc, _ = self.build(
            [
                page(
                    9,
                    [
                        span("裁》诗词", 0.338, 0.161, wf=0.281, hf=0.032),
                        span("(一)", 0.452, 0.253, wf=0.071, hf=0.024),
                        span("古道微茫致曲全，", 0.357, 0.307, wf=0.259),
                    ],
                )
            ]
        )
        assert doc.blocks[0].kind is BlockKind.CHAPTER
        assert doc.blocks[0].text == "《论语别裁》诗词"
        assert "裁》诗词" not in [b.text for b in doc.blocks]

    def test_footnote_does_not_split_a_poem_that_continues_overleaf(self):
        doc, _ = self.build(
            [
                page(
                    10,
                    [
                        span("此中空洞原无物，", 0.355, 0.782, wf=0.259),
                        span("注：出处页码据复旦大学出版社1990年9月版。", 0.174, 0.852, wf=0.409, hf=0.020),
                    ],
                ),
                page(11, [span("何止容卿数百人。", 0.355, 0.130, wf=0.259)]),
            ]
        )
        assert kinds(doc) == [BlockKind.VERSE, BlockKind.FOOTNOTE]
        assert doc.blocks[0].lines == ["此中空洞原无物，", "何止容卿数百人。"]

    def test_reference_attaches_to_the_poem_not_the_attribution(self):
        doc, _ = self.build(
            [
                page(
                    10,
                    [
                        span("近来湖面亦收租。", 0.357, 0.450, wf=0.260),
                        span("——宋·范成大《四时田园杂兴》", 0.241, 0.484, wf=0.498, hf=0.020),
                        span("(见第 568 页)", 0.698, 0.513, wf=0.159, hf=0.021),
                    ],
                )
            ]
        )
        verse = next(b for b in doc.blocks if b.kind is BlockKind.VERSE)
        attribution = next(b for b in doc.blocks if b.kind is BlockKind.ATTRIBUTION)
        assert verse.source_ref == "（见第568页）"
        assert attribution.source_ref is None

    def test_front_matter_is_skipped(self):
        outline = [
            OutlineEntry(1, "目录", 7),
            OutlineEntry(1, "《论语别裁》诗词", 9),
        ]
        doc, report = build_document(
            [page(7, [span("《孟子旁通》诗词……", 0.111, 0.351, wf=0.306)])],
            outline,
            "南怀瑾著作诗词辑录",
        )
        assert doc.blocks == []
        assert report.skipped_pages == [7]
