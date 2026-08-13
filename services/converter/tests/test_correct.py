"""Tests for the AI correction stage.

No network. The model is the untrusted input here, so what is worth
testing is the layer that refuses it: a canned response stands in for the
endpoint and the guardrails are exercised directly.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.llm.apply import apply_suggestions  # noqa: E402
from app.llm.client import LlmConfig, LlmError, _extract_content  # noqa: E402
from app.llm.correct import (  # noqa: E402
    _Candidate,
    classify,
    collect_candidates,
    parse_response,
    suggest_corrections,
    vet,
)
from app.models import Block, BlockKind, Document, Suggestion  # noqa: E402
from app.serialize import (  # noqa: E402
    document_from_dict,
    document_to_dict,
    suggestion_from_dict,
    suggestion_to_dict,
)

LINE = "子曰:學而時習之,不亦説乎?"


def candidate(text: str = LINE, kind: BlockKind = BlockKind.BODY) -> _Candidate:
    return _Candidate(block=0, line=0, kind=kind, text=text)


def vet_ok(suggested: str, *, original: str = LINE, confidence: float = 0.95):
    return vet(candidate(original), suggested, "reason", confidence, min_confidence=0.7)


# --------------------------------------------------------------------------
# The guardrails
# --------------------------------------------------------------------------


def test_punctuation_repair_is_accepted_and_categorized():
    suggestion, refused = vet_ok("子曰：學而時習之，不亦説乎？")
    assert refused is None
    assert suggestion.category == "punctuation"
    assert suggestion.suggested == "子曰：學而時習之，不亦説乎？"


def test_character_repair_is_accepted_but_flagged_as_a_content_change():
    # 説 -> 說 is a real OCR confusion, and it changes what the reader
    # reads, so it must not be filed under punctuation.
    suggestion, refused = vet_ok("子曰:學而時習之,不亦說乎?")
    assert refused is None
    assert suggestion.category == "characters"


def test_identical_suggestion_is_refused():
    _, refused = vet_ok(LINE)
    assert refused == "no change"


def test_empty_suggestion_is_refused():
    _, refused = vet_ok("   ")
    assert refused == "empty suggestion"


def test_low_confidence_is_refused():
    _, refused = vet_ok("子曰：學而時習之，不亦説乎？", confidence=0.5)
    assert "below" in refused


def test_confidence_outside_the_unit_range_is_refused():
    _, refused = vet_ok("子曰：學而時習之，不亦説乎？", confidence=95)
    assert "out of range" in refused


def test_missing_confidence_counts_as_none():
    # An absent confidence must not read as certainty.
    suggestion, refused = vet(
        candidate(), "子曰：學而時習之，不亦説乎？", "", 0.0, min_confidence=0.7
    )
    assert suggestion is None and "below" in refused


def test_paraphrase_is_refused():
    _, refused = vet_ok("孔子說：學習並時常複習，不也是很快樂的事嗎？")
    assert refused is not None


def test_completing_a_truncated_line_is_refused():
    # The model "helpfully" finishing a printed line that legitimately
    # continues overleaf is the failure mode this limit exists for.
    _, refused = vet_ok(LINE + "有朋自遠方來，不亦樂乎？")
    assert "length changed" in refused


def test_rewriting_more_than_two_characters_is_refused():
    _, refused = vet_ok("子曰:學而時温之,不亦樂哉?")
    assert "content characters changed" in refused


def test_traditional_to_simplified_conversion_is_refused():
    # Same length, so only the content-edit budget catches it.
    _, refused = vet_ok("子曰:学而时习之,不亦説乎?")
    assert "content characters changed" in refused


def test_two_character_repair_is_still_allowed():
    suggestion, refused = vet_ok("子曰:學而時習之,不亦說乎!")
    assert refused is None
    assert suggestion.category == "characters"


@pytest.mark.parametrize(
    "original,suggested,expected",
    [
        ("甲，乙。", "甲、乙。", ("punctuation", 0)),
        ("甲(乙)", "甲（乙）", ("punctuation", 0)),
        ("甲乙丙", "甲丙丙", ("characters", 2)),
        ("甲乙", "甲乙丙", ("characters", 1)),
    ],
)
def test_classify(original, suggested, expected):
    assert classify(original, suggested) == expected


# --------------------------------------------------------------------------
# Talking to a model
# --------------------------------------------------------------------------


class FakeClient:
    """Returns canned completions, and records what it was asked."""

    model = "fake"

    def __init__(self, responses: list[str]):
        self._responses = list(responses)
        self.prompts: list[str] = []

    def complete(self, system: str, user: str) -> str:
        self.prompts.append(user)
        return self._responses.pop(0)


def doc_with(*lines: str) -> Document:
    return Document(
        title="test",
        blocks=[Block(kind=BlockKind.BODY, lines=list(lines), page=0)],
    )


def test_parse_response_tolerates_a_code_fence():
    fenced = '```json\n{"suggestions": [{"id": "L1"}]}\n```'
    assert parse_response(fenced) == [{"id": "L1"}]


def test_parse_response_accepts_a_bare_list():
    assert parse_response('[{"id": "L1"}]') == [{"id": "L1"}]


def test_parse_response_rejects_prose():
    with pytest.raises(ValueError):
        parse_response("Sure! Here are the corrections:")


def test_chapter_headings_are_never_sent_to_the_model():
    # They come from the PDF outline, not from OCR — authoritative.
    doc = Document(
        title="t",
        blocks=[
            Block(kind=BlockKind.CHAPTER, lines=["第一章"], page=0),
            Block(kind=BlockKind.BODY, lines=["正文"], page=0),
        ],
    )
    assert [c.text for c in collect_candidates(doc)] == ["正文"]


def test_blank_lines_are_not_sent():
    assert collect_candidates(doc_with("有字", "   ")) == collect_candidates(
        doc_with("有字")
    )


def test_suggest_corrections_never_edits_the_document():
    doc = doc_with(LINE)
    client = FakeClient(
        [json.dumps({"suggestions": [{"id": "L1", "suggested": "子曰：學而時習之，不亦説乎？", "reason": "full-width", "confidence": 0.95}]})]
    )
    report = suggest_corrections(doc, client)

    assert len(report.suggestions) == 1
    assert doc.blocks[0].lines[0] == LINE, "the correction pass must not mutate"


def test_an_invented_line_id_is_refused():
    doc = doc_with(LINE)
    client = FakeClient(
        [json.dumps({"suggestions": [{"id": "L99", "suggested": "…", "confidence": 1.0}]})]
    )
    report = suggest_corrections(doc, client)

    assert report.suggestions == []
    assert "invented a reference" in report.rejected[0].rejected_because


def test_an_unparseable_batch_does_not_lose_the_rest_of_the_book():
    doc = doc_with("第一行", "第二行")
    client = FakeClient(
        [
            "I'm afraid I can't do that.",
            json.dumps(
                {"suggestions": [{"id": "L1", "suggested": "第二行。", "reason": "", "confidence": 0.95}]}
            ),
        ]
    )
    report = suggest_corrections(doc, client, batch_chars=3)

    assert report.batches == 2
    assert len(report.suggestions) == 1
    assert "was not JSON" in report.rejected[0].rejected_because


def test_batches_carry_the_line_kind_as_context():
    doc = Document(
        title="t", blocks=[Block(kind=BlockKind.VERSE, lines=["床前明月光"], page=0)]
    )
    client = FakeClient([json.dumps({"suggestions": []})])
    suggest_corrections(doc, client)

    assert "[verse]" in client.prompts[0]


# --------------------------------------------------------------------------
# Applying what a human approved
# --------------------------------------------------------------------------


def approved(original: str, suggested: str, decision: bool | None) -> Suggestion:
    return Suggestion(
        block=0,
        line=0,
        original=original,
        suggested=suggested,
        reason="",
        confidence=0.9,
        category="punctuation",
        approved=decision,
    )


def test_only_approved_suggestions_are_applied():
    doc = doc_with("甲,乙")
    report = apply_suggestions(doc, [approved("甲,乙", "甲，乙", True)])

    assert doc.blocks[0].lines[0] == "甲，乙"
    assert len(report.applied) == 1


def test_unreviewed_suggestions_are_left_alone():
    doc = doc_with("甲,乙")
    report = apply_suggestions(doc, [approved("甲,乙", "甲，乙", None)])

    assert doc.blocks[0].lines[0] == "甲,乙"
    assert report.pending == 1 and report.applied == []


def test_declined_suggestions_are_left_alone():
    doc = doc_with("甲,乙")
    report = apply_suggestions(doc, [approved("甲,乙", "甲，乙", False)])

    assert doc.blocks[0].lines[0] == "甲,乙"
    assert report.rejected == 1


def test_a_line_that_moved_on_is_skipped_rather_than_overwritten():
    doc = doc_with("這行已經改過了")
    report = apply_suggestions(doc, [approved("甲,乙", "甲，乙", True)])

    assert doc.blocks[0].lines[0] == "這行已經改過了"
    assert len(report.drifted) == 1 and not report.ok


def test_a_suggestion_pointing_past_the_end_is_skipped():
    doc = doc_with("甲")
    stale = approved("甲", "乙", True)
    stale.line = 7
    report = apply_suggestions(doc, [stale])

    assert report.unresolved == [stale] and not report.ok


# --------------------------------------------------------------------------
# Persistence
# --------------------------------------------------------------------------


def test_document_survives_a_round_trip():
    doc = Document(
        title="論語",
        author="孔子",
        low_confidence_pages=[3],
        blocks=[
            Block(
                kind=BlockKind.VERSE,
                lines=["床前明月光", "疑是地上霜"],
                page=2,
                confidence=0.82,
                source_ref="（見第 71 頁）",
                starts_paragraph=True,
            )
        ],
    )
    restored = document_from_dict(document_to_dict(doc))

    assert restored == doc


def test_a_document_from_a_different_schema_is_refused():
    data = document_to_dict(Document(title="t"))
    data["schema"] = 99
    with pytest.raises(ValueError, match="schema"):
        document_from_dict(data)


def test_suggestion_survives_a_round_trip():
    suggestion = approved("甲,乙", "甲，乙", True)
    assert suggestion_from_dict(suggestion_to_dict(suggestion)) == suggestion


# --------------------------------------------------------------------------
# Configuration
# --------------------------------------------------------------------------


def test_xai_is_the_default_provider():
    config = LlmConfig.from_env({"XAI_API_KEY": "k"})
    assert config.provider == "xai"
    assert config.base_url == "https://api.x.ai/v1"
    assert config.api_key == "k"


def test_a_missing_xai_key_is_a_clear_error():
    with pytest.raises(LlmError, match="XAI_API_KEY"):
        LlmConfig.from_env({})


def test_vllm_needs_an_endpoint_but_no_key():
    # The self-hosted endpoint is usually unauthenticated, but its
    # address is deployment configuration and has no default.
    with pytest.raises(LlmError, match="VLLM_BASE_URL"):
        LlmConfig.from_env({"LLM_PROVIDER": "vllm"})

    config = LlmConfig.from_env(
        {"LLM_PROVIDER": "vllm", "VLLM_BASE_URL": "http://10.211.51.231:8000/v1/"}
    )
    assert config.base_url == "http://10.211.51.231:8000/v1"
    assert config.api_key == ""
    assert config.model.startswith("google/gemma")


def test_llm_vars_override_the_provider_defaults():
    config = LlmConfig.from_env(
        {"XAI_API_KEY": "k", "LLM_BASE_URL": "http://tunnel/v1", "LLM_MODEL": "m"}
    )
    assert config.base_url == "http://tunnel/v1" and config.model == "m"


def test_an_unknown_provider_is_refused():
    with pytest.raises(LlmError, match="unknown LLM_PROVIDER"):
        LlmConfig.from_env({"LLM_PROVIDER": "banana"})


def test_only_content_is_read_never_the_models_scratch_work():
    body = {
        "choices": [
            {"message": {"content": '{"suggestions": []}', "reasoning_content": "hmm"}}
        ]
    }
    assert _extract_content(body) == '{"suggestions": []}'


def test_an_empty_completion_is_an_error():
    with pytest.raises(LlmError):
        _extract_content({"choices": [{"message": {"content": ""}}]})
