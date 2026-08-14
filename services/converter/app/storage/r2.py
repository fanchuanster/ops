"""R2, over the S3 API.

The web application reaches R2 through a Worker *binding* and therefore
holds no credentials at all. This service is not a Worker, so it is the
one component that legitimately holds an R2 access key (CLAUDE.md
section 14). Keeping that fact in one small module is the point: nothing
else in the pipeline should know a credential exists.

Configured entirely from the environment. Never hard-code an endpoint or
a key — the same rule as the LLM client next door.

    R2_ACCOUNT_ID=...
    R2_ACCESS_KEY_ID=...
    R2_SECRET_ACCESS_KEY=...
    R2_BUCKET=noblesee            (default)
    R2_ENDPOINT=...               (derived from the account id if unset)
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def conversion_key(job_id: str, *parts: str) -> str:
    """Scratch space for one job: input, intermediate, output."""
    return "/".join(["conversion", job_id, *parts])


def artifact_key(book_id: str | int, filename: str) -> str:
    """Where a finished artifact lives, matching the catalog's layout."""
    return f"books/{book_id}/book/{filename}"


@dataclass
class ObjectStore:
    bucket: str
    _client: object

    @classmethod
    def from_env(cls) -> "ObjectStore | None":
        """None when storage is not configured, rather than raising.

        The CLI runs against local files and needs no bucket at all; only
        the job runner does. Returning None lets the caller decide, and
        keeps `import` from failing on a developer machine with no
        credentials.
        """
        account = os.getenv("R2_ACCOUNT_ID")
        key = os.getenv("R2_ACCESS_KEY_ID")
        secret = os.getenv("R2_SECRET_ACCESS_KEY")
        if not (key and secret and (account or os.getenv("R2_ENDPOINT"))):
            return None

        import boto3
        from botocore.config import Config

        endpoint = os.getenv("R2_ENDPOINT") or f"https://{account}.r2.cloudflarestorage.com"
        client = boto3.client(
            "s3",
            endpoint_url=endpoint,
            aws_access_key_id=key,
            aws_secret_access_key=secret,
            # R2 ignores the region but the SDK insists on one, and
            # "auto" is what Cloudflare's own documentation uses.
            region_name="auto",
            config=Config(signature_version="s3v4", retries={"max_attempts": 3}),
        )
        return cls(bucket=os.getenv("R2_BUCKET", "noblesee"), _client=client)

    def download(self, key: str, path: Path) -> Path:
        path.parent.mkdir(parents=True, exist_ok=True)
        self._client.download_file(self.bucket, key, str(path))  # type: ignore[attr-defined]
        return path

    def upload(self, path: Path, key: str, *, content_type: str | None = None) -> str:
        extra = {"ContentType": content_type} if content_type else None
        self._client.upload_file(str(path), self.bucket, key, ExtraArgs=extra)  # type: ignore[attr-defined]
        return key


CONTENT_TYPES = {
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".epub": "application/epub+zip",
    ".pdf": "application/pdf",
}
