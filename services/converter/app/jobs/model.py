"""What a conversion job is, and the states it moves through.

The state names are fixed by CLAUDE.md section 13 and are part of the
API contract — the web application renders them to the uploader, so
renaming one is a breaking change, not a tidy-up.
"""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field
from enum import Enum


class JobState(str, Enum):
    QUEUED = "queued"
    OCR = "ocr"
    NORMALIZING = "normalizing"
    AI_PROCESSING = "ai_processing"
    DOCX_GENERATION = "docx_generation"
    HUMAN_REVIEW = "human_review"
    FORMAT_GENERATION = "format_generation"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


TERMINAL_STATES = {JobState.COMPLETED, JobState.FAILED, JobState.CANCELLED}


@dataclass
class Job:
    """One book being converted.

    `source_key` and the outputs are object-storage keys, never paths or
    URLs: the API hands work to a runner that may be on another machine,
    and a local path would be meaningless there.
    """

    source_key: str
    book_id: str | None = None
    title: str | None = None
    author: str | None = None
    # Whether this book may be sent to a third-party LLM for OCR
    # correction. Defaults to false, and the default is the safe one:
    # a reader's private upload must not go to xAI (CLAUDE.md section
    # 6.1). Only public-domain library material sets this.
    allow_third_party_ai: bool = False

    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    state: JobState = JobState.QUEUED
    error: str | None = None
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    # format -> storage key, filled in as generation completes.
    artifacts: dict[str, str] = field(default_factory=dict)
    page_count: int | None = None

    def advance(self, state: JobState, *, error: str | None = None) -> None:
        self.state = state
        self.error = error
        self.updated_at = time.time()

    def as_dict(self) -> dict:
        return {
            "job_id": self.id,
            "status": self.state.value,
            "book_id": self.book_id,
            "title": self.title,
            "error": self.error,
            "artifacts": self.artifacts,
            "page_count": self.page_count,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }
