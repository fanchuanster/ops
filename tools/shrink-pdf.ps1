<#
.SYNOPSIS
    Runs tools/shrink-pdf.py on Windows with a portable Ghostscript and a
    console that can print Chinese filenames.

.DESCRIPTION
    Three things have to be arranged before the shrinker can run on
    Windows, and getting any of them wrong looks like a different fault:

    Ghostscript is called gswin64c.exe there and is not on PATH when it
    has been unzipped rather than installed, so this prepends the portable
    directory; the Python tool looks for gs, gswin64c and gswin32c in that
    order and reports what it looked for when it finds none.

    The console is code page 1252 by default, so a book named
    南怀瑾选集-典藏版-第05卷-扫描版.pdf prints as question marks and a
    UnicodeEncodeError can take the run down before any work happens.
    PYTHONIOENCODING and the console encoding are both set to UTF-8.

    Python is called python, python3 or py depending on how it was
    installed, and on a machine with the Store stub, python3 exists and
    does nothing. Each is tried until one reports a version.

    The tool is found from this script's own location, under either name
    it goes by, and nothing changes directory — so a PDF path relative to
    wherever you are still resolves.

    This file is saved with a UTF-8 byte order mark because Windows
    PowerShell 5.1 reads a .ps1 as ANSI without one, which turns the
    Chinese in this help text into mojibake.

.PARAMETER Arguments
    Passed through to shrink-pdf.py unchanged: the PDF or PDFs, and any of
    --inspect, --quality, --gray, --min-dpi, --mono-dpi, -o, --out-dir.

.PARAMETER GhostscriptDir
    The portable Ghostscript bin directory. Defaults to
    $env:USERPROFILE\ghostscript-portable\bin, and is skipped when it does
    not exist, on the assumption that Ghostscript was installed properly.

.EXAMPLE
    .\tools\shrink-pdf.ps1 $env:USERPROFILE\Downloads\南怀瑾选集-第05卷-扫描版.pdf

.EXAMPLE
    .\tools\shrink-pdf.ps1 --inspect C:\scans\book.pdf

.EXAMPLE
    .\tools\shrink-pdf.ps1 C:\scans\book.pdf --quality 40 --gray
#>

[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]] $Arguments,

    [string] $GhostscriptDir = (Join-Path $env:USERPROFILE 'ghostscript-portable\bin')
)

$ErrorActionPreference = 'Stop'

if (Test-Path -LiteralPath $GhostscriptDir) {
    $env:PATH = "$GhostscriptDir;$env:PATH"
}
elseif (-not (Get-Command 'gswin64c', 'gswin32c', 'gs' -ErrorAction SilentlyContinue)) {
    Write-Error "No Ghostscript found. Unzip the portable build into $GhostscriptDir, or pass -GhostscriptDir."
}

$env:PYTHONIOENCODING = 'utf-8'
$env:PYTHONUTF8 = '1'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
if (Get-Command chcp.com -ErrorAction SilentlyContinue) { $null = chcp.com 65001 }

$tool = @('shrink-pdf.py', 'clean-pdf.py') |
    ForEach-Object { Join-Path $PSScriptRoot $_ } |
    Where-Object { Test-Path -LiteralPath $_ } |
    Select-Object -First 1
if (-not $tool) {
    Write-Error "Neither shrink-pdf.py nor clean-pdf.py is in $PSScriptRoot."
}

$python = $null
foreach ($candidate in @('python', 'python3', 'py')) {
    $found = Get-Command $candidate -ErrorAction SilentlyContinue
    if (-not $found) { continue }
    & $found.Source '--version' 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) { $python = $found.Source; break }
}
if (-not $python) {
    Write-Error 'No working Python found. Install it from python.org, not the Microsoft Store stub.'
}

& $python '-c' 'import pymupdf' 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Warning "PyMuPDF is missing, so the ladder cannot be trimmed to the scan's own resolution: $python -m pip install pymupdf"
}

& $python $tool @Arguments
exit $LASTEXITCODE
