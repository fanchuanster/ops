"""Liveness/readiness endpoint.

Checks the database rather than just returning 200, so that a web
container that is up but cannot reach PostgreSQL reports unhealthy —
that distinction is what makes `depends_on: service_healthy` useful.
"""

from django.db import connection
from django.http import JsonResponse


def healthz(request):
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            cursor.fetchone()
    except Exception as exc:  # noqa: BLE001 — report any failure as unhealthy
        return JsonResponse({"status": "unhealthy", "database": str(exc)}, status=503)
    return JsonResponse({"status": "ok", "database": "ok"})
