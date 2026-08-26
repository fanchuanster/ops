# The conversion service.
#
# Runs the handoff poller by default: it asks the web application for
# work, converts, and reports back. There is no EXPOSE and no server,
# because the converter has no inbound port — that is what lets it run
# behind a filtered egress, on a host that accepts no connections.
#
# The job API (`app/api`) is in the image and can be run instead with a
# different command, for a deployment that wants to push work in rather
# than have it pulled.
#
# **Plain `python:slim`, with no apt layer at all.** It had two until
# 2026-08-26: Pango, Cairo, libffi and a CJK font set for WeasyPrint,
# and `libreoffice-writer` for rendering a DOCX with its own layout.
# Both went with the generated PDF (CLAUDE.md section 11), and the OCR
# engine that would have added a gigabyte of models went with them. What
# is left — parse a DOCX, write an EPUB, talk HTTP — is pure Python.

FROM python:3.12-slim-bookworm

WORKDIR /app

# Dependencies before source, so editing a Python file does not
# reinstall them.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

# Not root. The service reads and writes only a temporary directory, so
# there is nothing it needs privileges for.
RUN useradd --create-home --uid 10001 converter \
    && chown -R converter:converter /app
USER converter

# Unbuffered, so `docker logs` shows what it is doing while it is doing
# it rather than when the buffer fills.
ENV PYTHONUNBUFFERED=1

CMD ["python", "-m", "app.handoff"]
