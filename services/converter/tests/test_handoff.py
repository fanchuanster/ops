"""The two-phase handoff, from the converter's side.

The web application and this service each own half of a contract neither
can test end to end. What is pinned here is the half this side is
responsible for: reading the phase off a claimed job, and echoing it
back on completion.

That echo carries real weight. The phase decides where the book lands —
phase 1 finishing queues phase 2, phase 2 finishing makes the book
readable — so reporting the wrong one either publishes a book with no
EPUB or rebuilds it forever.
"""

from __future__ import annotations

import httpx
import pytest

from app.handoff.poller import Poller, PollerConfig
from app.jobs.model import Job, JobKind, JobState


def poller_answering(handler) -> Poller:
    config = PollerConfig(base_url="https://noblesee.test", secret="s" * 16)
    poller = Poller(config, store=None)
    poller._client = httpx.Client(
        base_url=config.base_url,
        transport=httpx.MockTransport(handler),
        headers={"Authorization": f"Bearer {config.secret}"},
    )
    return poller


def serving(job: dict | None):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"job": job})

    return handler


def test_claims_a_phase_one_job():
    poller = poller_answering(
        serving(
            {
                "book_id": "7",
                "kind": "master",
                "ocr_key": "books/7/ocr/pages.json",
                "source_key": "conversion/abc/input/source.pdf",
                "master_key": None,
                "title": "論語別裁",
            }
        )
    )

    job = poller.claim()
    assert job is not None
    assert job.kind is JobKind.MASTER
    assert job.ocr_key == "books/7/ocr/pages.json"
    assert job.title == "論語別裁"


def test_claims_a_phase_two_job_with_no_source():
    # A formats job has nothing to say about the original -- it reads the
    # master. The absent source_key must not fail the claim.
    poller = poller_answering(
        serving(
            {
                "book_id": "7",
                "kind": "formats",
                "master_key": "books/7/book/master.docx",
                "ocr_key": None,
            }
        )
    )

    job = poller.claim()
    assert job is not None
    assert job.kind is JobKind.FORMATS
    assert job.master_key == "books/7/book/master.docx"
    assert job.source_key == ""


def test_an_older_web_application_still_hands_out_work():
    # No `kind` at all: the deployment predates the split. Doing the
    # whole of production is the right reading of that.
    poller = poller_answering(
        serving({"book_id": "7", "source_key": "conversion/abc/input/source.pdf"})
    )

    job = poller.claim()
    assert job is not None
    assert job.kind is JobKind.FULL


def test_refuses_a_phase_it_does_not_know():
    # A newer web application asking for something this build cannot do
    # must say so, not silently convert the book the wrong way.
    poller = poller_answering(serving({"book_id": "7", "kind": "translate"}))

    with pytest.raises(RuntimeError, match="newer than this build"):
        poller.claim()


def test_no_work_is_not_an_error():
    poller = poller_answering(serving(None))
    assert poller.claim() is None


def test_a_404_names_the_likely_cause():
    # The endpoint fails closed when the web application has no secret,
    # so this is the likeliest misconfiguration and should not read as
    # "no work".
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404)

    poller = poller_answering(handler)
    with pytest.raises(RuntimeError, match="CONVERTER_SECRET"):
        poller.claim()


def test_reports_the_phase_it_finished():
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        import json

        seen.update(json.loads(request.content))
        return httpx.Response(200, json={"ok": True})

    poller = poller_answering(handler)
    job = Job(source_key="", book_id="7", kind=JobKind.MASTER)
    job.artifacts["docx"] = "books/7/book/master.docx"
    job.page_count = 412
    job.advance(JobState.COMPLETED)

    poller.report(job)

    assert seen["kind"] == "master"
    assert seen["state"] == "completed"
    assert seen["artifacts"] == {"docx": "books/7/book/master.docx"}
    assert seen["page_count"] == 412


def test_reports_a_failure_with_its_phase():
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        import json

        seen.update(json.loads(request.content))
        return httpx.Response(200, json={"ok": True})

    poller = poller_answering(handler)
    job = Job(source_key="", book_id="7", kind=JobKind.FORMATS)
    job.advance(JobState.FAILED, error="the master could not be read")

    poller.report(job)

    assert seen["kind"] == "formats"
    assert seen["state"] == "failed"
    assert seen["message"] == "the master could not be read"


def test_formats_absent_means_build_everything():
    """An older web application sends no `formats` at all.

    None rather than an empty list, so the converter keeps producing the
    whole set and the two sides may be deployed in either order.
    """
    from app.handoff.poller import _formats

    assert _formats(None) is None
    assert _formats("epub") is None
    assert _formats({"epub": True}) is None


def test_formats_list_is_taken_as_given():
    from app.handoff.poller import _formats

    assert _formats(["epub", "pdf_large"]) == ["epub", "pdf_large"]
    # An empty list is a real instruction, not a missing one.
    assert _formats([]) == []


def test_formats_drops_non_strings():
    from app.handoff.poller import _formats

    assert _formats(["epub", 7, None]) == ["epub"]


def test_wanted_formats_defaults_to_all():
    from app.jobs.model import Job
    from app.jobs.runner import ALL_READER_FORMATS, _wanted_formats

    assert _wanted_formats(Job(source_key="x")) == set(ALL_READER_FORMATS)


def test_wanted_formats_honours_an_explicit_empty_list():
    """`[]` must not be read as "the caller said nothing"."""
    from app.jobs.model import Job
    from app.jobs.runner import _wanted_formats

    assert _wanted_formats(Job(source_key="x", formats=[])) == set()


def test_wanted_formats_ignores_names_we_do_not_build():
    from app.jobs.model import Job
    from app.jobs.runner import _wanted_formats

    job = Job(source_key="x", formats=["epub", "mobi", "docx"])
    # `docx` is the input to this phase, never its output.
    assert _wanted_formats(job) == {"epub"}
