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

    This is the size half on its own. A file downloaded from an archive
    mirror usually wants tools/clean-pdf.ps1 instead, which strips the
    database ids off the filename and then does exactly this to what is
    left.

    The Windows plumbing -- portable Ghostscript under its Windows name
    gswin64c.exe, a UTF-8 console so a book named
    南怀瑾选集-典藏版-第05卷-扫描版.pdf prints instead of raising
    UnicodeEncodeError, and whichever of python/python3/py actually runs
    -- is in tools/pdf-tools.ps1 and shared with tools/clean-pdf.ps1.
    Missing Ghostscript is an error here rather than a warning: there is
    nothing this script does without it.

    The tool is found from this script's own location and nothing changes
    directory, so a PDF path relative to wherever you are still resolves.

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

    [string] $GhostscriptDir,

    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]] $Extra
)

$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'pdf-tools.ps1')

$run = Initialize-PdfTool -Tool 'shrink-pdf.py' -GhostscriptDir $GhostscriptDir -RequireGhostscript

if ($Help) {
    & $run.Python $run.Tool '--help'
    exit $LASTEXITCODE
}

if (-not $Path) {
    Write-Error 'Give me a PDF. Run with -Help for the options.'
}

$files = @(Resolve-PdfInput -Path $Path)

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

& $run.Python $run.Tool @flags '--' @files
exit $LASTEXITCODE
