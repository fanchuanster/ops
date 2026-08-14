"""Where jobs live while they run.

In memory, with a lock. That is a deliberate choice and not a shortcut
waiting to be replaced by Redis: the durable record of a conversion is
the Book row in the web application's database, which the runner
updates as it goes. This store only has to answer "what is job X doing
right now" for the seconds-to-hours a job is in flight, and a restart
losing that is recoverable — the Book row still says `converting`, and
the job can be re-queued from the same source key.

Adding Redis here would mean a second stateful service to run for
information that is already written down somewhere durable.
"""

from __future__ import annotations

import threading
from collections import OrderedDict

from .model import Job, JobState, TERMINAL_STATES

# Finished jobs are kept so a client that polls a moment late still gets
# an answer rather than a 404. Oldest are evicted first.
MAX_REMEMBERED = 500


class JobStore:
    def __init__(self, capacity: int = MAX_REMEMBERED) -> None:
        self._jobs: OrderedDict[str, Job] = OrderedDict()
        self._lock = threading.Lock()
        self._capacity = capacity

    def add(self, job: Job) -> Job:
        with self._lock:
            self._jobs[job.id] = job
            self._evict()
        return job

    def get(self, job_id: str) -> Job | None:
        with self._lock:
            return self._jobs.get(job_id)

    def list(self, limit: int = 50) -> list[Job]:
        with self._lock:
            return list(self._jobs.values())[-limit:][::-1]

    def cancel(self, job_id: str) -> Job | None:
        """Cancels a job that has not started, and reports honestly.

        A job already running is *not* stopped — the pipeline has no safe
        interruption point mid-OCR — so this refuses rather than
        pretending. Saying "cancelled" while the work continues would be
        worse than saying no.
        """
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None or job.state is not JobState.QUEUED:
                return None
            job.advance(JobState.CANCELLED)
            return job

    def _evict(self) -> None:
        while len(self._jobs) > self._capacity:
            for job_id, job in self._jobs.items():
                if job.state in TERMINAL_STATES:
                    del self._jobs[job_id]
                    break
            else:
                # Everything remembered is still running. Better to grow
                # past the cap than to forget a live job.
                return
