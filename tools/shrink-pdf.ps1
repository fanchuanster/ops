<#
.SYNOPSIS
    Shrinks an oversized scan until NobleSee will take it, on Windows.

.DESCRIPTION
    A wrapper around tools/shrink-pdf.py. The PDF is the first argument
    and everything else has a default, so the ordinary run is just the
    path:

        .\tools\shrink-pdf.ps1 C:\Users\me\Downloads\scan.pdf

    Those defaults are deliberately not repeated here. Nothing is passed
    to the Python tool unless you asked for it, so the defaults are
    whatever shrink-pdf.py says they are and the two cannot drift apart.
    Run -Help to read them from the tool itself.

    Three things have to be arranged before any of this runs on Windows,
    and getting one wrong looks like a different fault:

    Ghostscript is called gswin64c.exe there and is not on PATH when it
    has been unzipped rather than installed, so this prepends the
    portable directory; the Python tool looks for gs, gswin64c and
    gswin32c in that order and says what it looked for when it finds
    none.

    The console is code page 1252 by default, so a book named
    南怀瑾选集-典藏版-第05卷-扫描版.pdf prints as question marks and a
    UnicodeEncodeError can end the run before any work happens.
    PYTHONIOENCODING, PYTHONUTF8 and the console encoding are all set to
    UTF-8.

    Python is called python, python3 or py depending on how it was
    installed, and on a machine carrying the Store stub, python3 exists
    and does nothing. Each is tried until one reports a version.

    The tool is found from this script's own location, under either name
    it goes by, and nothing changes directory -- so a PDF path relative
    to wherever you are still resolves.

    This file is saved with a UTF-8 byte order mark, because Windows
    PowerShell 5.1 reads a .ps1 as ANSI without one and turns the Chinese
    above into mojibake.

.PARAMETER Path
    The PDF, or several. Exact names are matched first and wildcards
    after, so a filename containing brackets still resolves.

.PARAMETER Quality
    Image quality, 0-100, lower being smaller. The one lever that still
    works when the scan is already below every resolution on the ladder.

.PARAMETER MinDpi
    How far the resolution ladder may descend. Below 200 Adobe starts
    losing dense traditional Chinese glyphs; the tool says so on the way
    past.

.PARAMETER MonoDpi
    Resolution floor for bitonal pages, which are ruined by resampling
    and so are held above the ladder.

.PARAMETER Margin
    Headroom under the upload limit, in MB.

.PARAMETER Gray
    Discard colour. Often a large win, and it takes the red seals with
    it.

.PARAMETER Inspect
    Report what is in the file and change nothing.

.PARAMETER Force
    Re-encode even a file already under the limit.

.PARAMETER Output
    Where to write the result. One input only; -OutDir takes several.

.PARAMETER OutDir
    Write results here instead of beside each input.

.PARAMETER GhostscriptDir
    The portable Ghostscript bin directory. Skipped when it does not
    exist, on the assumption Ghostscript was installed properly.

.PARAMETER Help
    Print the Python tool's own usage, defaults included, and stop.

.EXAMPLE
    .\tools\shrink-pdf.ps1 $env:USERPROFILE\Downloads\南怀瑾选集-第05卷-扫描版.pdf

.EXAMPLE
    .\tools\shrink-pdf.ps1 C:\scans\book.pdf -Inspect

.EXAMPLE
    .\tools\shrink-pdf.ps1 C:\scans\book.pdf -Quality 40 -Gray

.EXAMPLE
    .\tools\shrink-pdf.ps1 C:\scans\*.pdf -OutDir C:\ready
#>

[CmdletBinding()]
param(
    [Parameter(Position = 0, ValueFromPipeline = $true)]
    [string[]] $Path,

    [int] $Quality,
    [int] $MinDpi,
    [int] $MonoDpi,
    [double] $Margin,
    [switch] $Gray,
    [switch] $Inspect,
    [switch] $Force,
    [string] $Output,
    [string] $OutDir,
    [switch] $Help,

    [string] $GhostscriptDir = (Join-Path $env:USERPROFILE 'ghostscript-portable\bin'),

    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]] $Extra
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

if ($Help) {
    & $python $tool '--help'
    exit $LASTEXITCODE
}

if (-not $Path) {
    Write-Error 'Give me a PDF. Run with -Help for the options.'
}

$files = @()
foreach ($item in $Path) {
    if (Test-Path -LiteralPath $item) {
        $files += (Resolve-Path -LiteralPath $item).Path
        continue
    }
    $matched = @(Resolve-Path -Path $item -ErrorAction SilentlyContinue)
    if ($matched) {
        $files += $matched.Path
        continue
    }
    Write-Error "No such file: $item"
}

& $python '-c' 'import pymupdf' 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Warning "PyMuPDF is missing, so the ladder cannot be trimmed to the scan's own resolution: $python -m pip install pymupdf"
}

$flags = @()
if ($PSBoundParameters.ContainsKey('Quality')) { $flags += @('--quality', $Quality) }
if ($PSBoundParameters.ContainsKey('MinDpi'))  { $flags += @('--min-dpi', $MinDpi) }
if ($PSBoundParameters.ContainsKey('MonoDpi')) { $flags += @('--mono-dpi', $MonoDpi) }
if ($PSBoundParameters.ContainsKey('Margin'))  { $flags += @('--margin', $Margin) }
if ($PSBoundParameters.ContainsKey('Output'))  { $flags += @('--output', $Output) }
if ($PSBoundParameters.ContainsKey('OutDir'))  { $flags += @('--out-dir', $OutDir) }
if ($Gray)    { $flags += '--gray' }
if ($Inspect) { $flags += '--inspect' }
if ($Force)   { $flags += '--force' }
if ($Extra)   { $flags += $Extra }

& $python $tool @flags '--' @files
exit $LASTEXITCODE
