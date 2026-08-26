"""Correction as two jobs with a person between them.

CLAUDE.md section 7 forbids the AI editing source material on its own,
so the stage cannot be one job that reads a master and writes a better
one. It is a proposal, a human decision, and an application of exactly
what that human adopted — and what is pinned here is that the second
job cannot do anything the first did not offer and the human did not
tick.

Until this existed, `allow_third_party_ai` reached the runner and only
advanced a progress label: the correction stage lived in the CLI and
nothing in the pipeline called it.
"""

from __future__ import annotations

import json
from pathlib import Path

import httpx
import pytest

from app.docx.builder import build_docx
from app.handoff.poller import Poller, PollerConfig
from app.jobs.model import Job, JobKind, JobState
from app.jobs.runner import run
from app.models import Block, BlockKind, Document, Suggestion
from app.serialize import suggestion_to_dict


class FakeStore:
    """An object store that is a directory, so a job can be run for real."""

    def __init__(self, root: Path) -> None:
        self.root = root

    def _path(self, key: str) -> Path:
        path = self.root / key
        path.parent.mkdir(parents=True, exist_ok=True)
        return path

    def download(self, key: str, path: Path) -> Path:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(self._path(key).read_bytes())
        return path

    def upload(self, path: Path, key: str, *, content_type: str | None = None) -> str:
        self._path(key).write_bytes(path.read_bytes())
        return key


def document() -> Document:
    return Document(
        title="参禅日记",
        author="金满慈",
        blocks=[
            Block(kind=BlockKind.CHAPTER, lines=["第一章　初发心"], page=1),
            # One line on purpose. `build_docx` joins a BODY block's
            # lines into a paragraph and `read_docx` reads that paragraph
            # back as a single line, so a two-line fixture would address
            # a line that does not exist in the master being corrected.
            Block(kind=BlockKind.BODY, page=1, lines=["初坐半炷香，两腿酸麻难忍，不能自巳。"]),
        ],
    )


@pytest.fixture()
def store(tmp_path: Path) -> FakeStore:
    fake = FakeStore(tmp_path / "bucket")
    master = build_docx(document(), tmp_path / "master.docx", author="金满慈")
    fake.upload(master, "books/9/book/master.docx")
    return fake


def correct_job(**over) -> Job:
    fields = dict(
        source_key="",
        book_id="9",
        kind=JobKind.CORRECT,
        master_key="books/9/book/master.docx",
        title="参禅日记",
        allow_third_party_ai=True,
    )
    fields.update(over)
    return Job(**fields)


class StubClient:
    """Stands in for xAI. Proposes one real OCR repair."""

    model = "stub"

    def __init__(self, payload: str) -> None:
        self.payload = payload
        self.calls = 0

    def complete(self, system: str, user: str) -> str:
        self.calls += 1
        return self.payload

    def close(self) -> None:
        pass


def install_stub(monkeypatch, client: StubClient) -> None:
    import app.llm.client as llm_client

    monkeypatch.setattr(llm_client.LlmConfig, "from_env", classmethod(lambda cls: cls(
        provider="stub", base_url="https://stub.test", model="stub", api_key="k"
    )))
    monkeypatch.setattr(llm_client, "get_client", lambda config: client)


def test_correct_refuses_without_the_uploader_s_consent(store, monkeypatch):
    """The flag is a reader's answer about their own book, not a default.

    A job that proceeded without it would make the checkbox a lie, so
    this fails rather than quietly correcting.
    """
    client = StubClient('{"suggestions": []}')
    install_stub(monkeypatch, client)

    job = run(correct_job(allow_third_party_ai=False), store)

    assert job.state is JobState.FAILED
    assert client.calls == 0
    assert "third-party" in (job.error or "")


def test_correct_proposes_and_changes_nothing(store, monkeypatch):
    client = StubClient(
        json.dumps(
            {
                "suggestions": [
                    {
                        "id": "L1",
                        "suggested": "初坐半炷香，两腿酸麻难忍，不能自己。",
                        "reason": "OCR misread 己 as 巳",
                        "confidence": 0.98,
                    }
                ]
            }
        )
    )
    install_stub(monkeypatch, client)

    before = store._path("books/9/book/master.docx").read_bytes()
    job = run(correct_job(), store)

    # Waiting on a person, which is a different thing from finished.
    assert job.state is JobState.HUMAN_REVIEW
    assert job.suggestions_key == "books/9/book/suggestions.json"

    # The master is untouched. Nothing is applied without a human.
    assert store._path("books/9/book/master.docx").read_bytes() == before
    assert "docx" not in job.artifacts

    written = json.loads(store._path("books/9/book/suggestions.json").read_text("utf-8"))
    assert [s["suggested"] for s in written["suggestions"]] == [
        "初坐半炷香，两腿酸麻难忍，不能自己。"
    ]
    # The reviewer needs the before-text to judge the proposal at all.
    assert written["suggestions"][0]["original"] == "初坐半炷香，两腿酸麻难忍，不能自巳。"


def decisions(store, items: list[Suggestion]) -> str:
    key = "books/9/book/decisions.json"
    store._path(key).write_text(
        json.dumps({"suggestions": [suggestion_to_dict(s) for s in items]}, ensure_ascii=False),
        encoding="utf-8",
    )
    return key


def suggestion(approved: bool | None, **over) -> Suggestion:
    base = dict(
        block=1,
        line=0,
        original="初坐半炷香，两腿酸麻难忍，不能自巳。",
        suggested="初坐半炷香，两腿酸麻难忍，不能自己。",
        reason="OCR misread 己 as 巳",
        confidence=0.98,
        category="characters",
        approved=approved,
    )
    base.update(over)
    return Suggestion(**base)


def apply_job(store, items: list[Suggestion]) -> Job:
    return Job(
        source_key="",
        book_id="9",
        kind=JobKind.APPLY,
        master_key="books/9/book/master.docx",
        decisions_key=decisions(store, items),
        title="参禅日记",
    )


def read_master_lines(store, tmp_path: Path) -> list[str]:
    from app.sources.docx_in import read_docx

    local = tmp_path / "check.docx"
    store.download("books/9/book/master.docx", local)
    return [line for block in read_docx(local).blocks for line in block.lines]


def test_apply_writes_only_what_was_adopted(store, tmp_path):
    job = run(apply_job(store, [suggestion(approved=True)]), store)

    assert job.state is JobState.COMPLETED
    assert job.artifacts["docx"] == "books/9/book/master.docx"
    assert "初坐半炷香，两腿酸麻难忍，不能自己。" in read_master_lines(store, tmp_path)


def test_apply_leaves_the_master_alone_when_nothing_was_adopted(store, tmp_path):
    before = store._path("books/9/book/master.docx").read_bytes()

    job = run(apply_job(store, [suggestion(approved=False)]), store)

    assert job.state is JobState.COMPLETED
    # No artifact reported, so the web application attaches nothing and
    # the book is left exactly as it stands.
    assert "docx" not in job.artifacts
    assert store._path("books/9/book/master.docx").read_bytes() == before


def test_apply_refuses_a_line_that_has_moved_on(store, tmp_path):
    """An edit between the proposal and the decision costs that one line.

    The alternative is overwriting text somebody wrote after the model
    read the book, which is exactly the silent rewrite section 7 forbids.
    """
    stale = suggestion(approved=True, original="a line the master has never contained")

    job = run(apply_job(store, [stale]), store)

    assert job.state is JobState.COMPLETED
    assert "docx" not in job.artifacts
    assert "不能自巳" in "".join(read_master_lines(store, tmp_path))


def test_apply_needs_somewhere_to_read_the_decisions_from(store):
    job = Job(
        source_key="",
        book_id="9",
        kind=JobKind.APPLY,
        master_key="books/9/book/master.docx",
    )
    assert run(job, store).state is JobState.FAILED


def test_the_poller_carries_both_keys_in_each_direction():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "job": {
                    "book_id": "9",
                    "kind": "apply",
                    "master_key": "books/9/book/master.docx",
                    "decisions_key": "books/9/book/decisions.json",
                }
            },
        )

    config = PollerConfig(base_url="https://noblesee.test", secret="s" * 16)
    poller = Poller(config, store=None)
    poller._client = httpx.Client(
        base_url=config.base_url, transport=httpx.MockTransport(handler)
    )

    job = poller.claim()
    assert job is not None
    assert job.kind is JobKind.APPLY
    assert job.decisions_key == "books/9/book/decisions.json"


def test_a_correct_job_reports_its_suggestions_key_back():
    sent: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        sent.update(json.loads(request.content))
        return httpx.Response(200, json={"ok": True})

    config = PollerConfig(base_url="https://noblesee.test", secret="s" * 16)
    poller = Poller(config, store=None)
    poller._client = httpx.Client(
        base_url=config.base_url, transport=httpx.MockTransport(handler)
    )

    job = correct_job()
    job.suggestions_key = "books/9/book/suggestions.json"
    job.advance(JobState.HUMAN_REVIEW)
    poller.report(job)

    # Waiting on a person is reported as a completion: which state the
    # book lands in is the server's decision, from the kind it asked for.
    assert sent["state"] == "completed"
    assert sent["kind"] == "correct"
    assert sent["suggestions_key"] == "books/9/book/suggestions.json"
