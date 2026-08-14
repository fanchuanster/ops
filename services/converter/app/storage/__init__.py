"""Object storage. R2 over the S3 API — the converter has no binding."""

from .r2 import ObjectStore, artifact_key, conversion_key

__all__ = ["ObjectStore", "artifact_key", "conversion_key"]
