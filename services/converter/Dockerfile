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
# Deliberately installs requirements-service.txt, not requirements.txt:
# the local OCR engine is the better part of a gigabyte and this service
# no longer runs it. Books from the portal are read by Google Document AI
# on the web side and arrive here as text. See requirements-service.txt.

FROM python:3.12-slim-bookworm

# WeasyPrint renders the PDF for sources with no layout of their own and
# links against these at runtime. It needs no browser and no display, which is what keeps this
# image small enough to run anywhere — but Pango and Cairo are not
# optional, and their absence shows up as an import error rather than as
# a missing-font warning.
RUN apt-get update \
    && apt-get install --no-install-recommends -y \
        libpango-1.0-0 \
        libpangoft2-1.0-0 \
        libharfbuzz0b \
        libcairo2 \
        libgdk-pixbuf-2.0-0 \
        libffi8 \
        fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*

# Noto CJK above is not decoration. This project's centre of gravity is
# Chinese, and a PDF rendered without a CJK face silently produces a
# document of empty boxes — valid, openable, and unreadable.

# LibreOffice, for the one job WeasyPrint cannot do: rendering a DOCX
# with the DOCX's own layout. A book's PDF has to mirror its original,
# and when the original is a Word document that means laying it out the
# way a word processor would — see app/pdf/docx_pdf.py.
#
# `libreoffice-writer` rather than the full suite: this converts text
# documents and nothing else, and the meta-package would pull in Calc,
# Impress, Draw and a Java runtime for no reason. `--no-install-recommends`
# is doing real work here.
RUN apt-get update \
    && apt-get install --no-install-recommends -y \
        libreoffice-writer \
        libreoffice-core \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependencies before source, so editing a Python file does not reinstall
# WeasyPrint.
COPY requirements-service.txt ./
RUN pip install --no-cache-dir -r requirements-service.txt

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
