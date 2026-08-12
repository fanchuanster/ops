# NobleSee web service — Django + PostgreSQL.
#
# Slim rather than alpine: psycopg's binary wheels are built against
# glibc, and alpine would force a source build of the C extension for no
# real size win.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Dependencies first, so edits to application code don't invalidate the
# pip layer on every rebuild.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Non-root: nothing here needs to write outside /app.
RUN useradd --create-home --uid 10001 noblesee \
    && chown -R noblesee:noblesee /app
USER noblesee

EXPOSE 8000

# The entrypoint applies migrations before serving. Safe to re-run and
# safe on a fresh volume, which is what the WordPress provisioning race
# taught us — see provisioning/provision.sh.
COPY --chown=noblesee:noblesee entrypoint.sh /app/entrypoint.sh
ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["gunicorn", "--bind", "0.0.0.0:8000", "--workers", "3", "noblesee.wsgi:application"]
