<#
.SYNOPSIS
    Prepares a downloaded book source for NobleSee on Windows: clean
    name, size under the upload limit, a text layer that actually
    renders.

.DESCRIPTION
    A wrapper around tools/pdf.py, which is both the engine and the one
    CLI for this now -- there used to be a second script, shrink-pdf.py,
    for the size half alone, but once both were thin wrappers doing
    nothing but forwarding flags to the same module, keeping two in sync
    for one job stopped earning its keep. Everything shrink-pdf.ps1 used
    to offer (-Inspect, -Output, -OutDir, -Force) is a flag here instead.

    Despite the module it wraps being named for PDFs, both this script
    and tools/pdf.py take a .txt source exactly as well as a .pdf one --
    a mirror site hangs the same digit-and-byte-range cruft off a
    plain-text download as it does off a scan, and NobleSee takes either
    as a source. The file is the first argument and everything else has
    a default, so the ordinary run is just the path:

        .\tools\clean-book.ps1 C:\Users\me\Downloads\619294728-13230487-南怀瑾选集-第9卷-2013-03-P699.pdf

    Renaming, shrinking and the glyph check are independent passes:
    -SkipShrink only renames, -SkipRename only checks the size and text
    layer. -DryRun says what would happen and changes nothing, which is
    the way to look at a folder full of mirror filenames before
    committing to them. -Inspect stands apart from both -- it renames
    nothing and reports what the ladder and the glyph check see, the way
    shrink-pdf.ps1 -Inspect used to. A .txt input has no ladder or font to
    inspect and no page images to shrink, so it only ever gets the rename
    and the 1 KB size floor.

    Defaults are deliberately not repeated here. Nothing is passed to the
    Python tool unless you asked for it, so the defaults are whatever
    pdf.py says they are and the two cannot drift apart. Run -Help to
    read them from the tool itself.

    The Windows plumbing -- portable Ghostscript, a UTF-8 console, and
    whichever of python/python3/py actually runs -- is in
    tools/pdf-tools.ps1. Ghostscript missing is a warning rather than an
    error here, because renaming does not need it and most files do not
    need shrinking at all.

    The tool is found from this script's own location and nothing changes
    directory, so a path relative to wherever you are still resolves.

    This file is saved with a UTF-8 byte order mark, because Windows
    PowerShell 5.1 reads a .ps1 as ANSI without one and turns the Chinese
    above into mojibake.

.PARAMETER Path
    The PDF or .txt source, or several. Exact names are matched first and
    wildcards after, so a filename containing brackets still resolves.

.PARAMETER DryRun
    Report every pass and change nothing -- no rename, no re-encoding.

.PARAMETER SkipRename
    Leave the filename alone and only deal with the size and text layer.

.PARAMETER SkipShrink
    Clean the filename and leave an oversized file oversized.

.PARAMETER KeepOriginal
    Leave the input where it is and write the shrunk copy beside it,
    named for the size it came out at. Without this the shrunk file
    replaces the original, so one file at one clean name is what is left.

.PARAMETER Inspect
    Report what is in each file -- the ladder's rungs, the glyph check --
    and change nothing. No rename, no re-encoding.

.PARAMETER Output
    Where to write the shrunk result. One input only; -OutDir takes
    several.

.PARAMETER OutDir
    Write results here instead of beside each input.

.PARAMETER Force
    Re-encode even a file already under the limit.

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

.PARAMETER GhostscriptDir
    The portable Ghostscript bin directory. Skipped when it does not
    exist, on the assumption Ghostscript was installed properly.

.PARAMETER Help
    Print the Python tool's own usage, defaults included, and stop.

.EXAMPLE
    .\tools\clean-book.ps1 $env:USERPROFILE\Downloads\619294728-南怀瑾选集-第9卷-P699.pdf

.EXAMPLE
    .\tools\clean-book.ps1 C:\scans\*.pdf -DryRun

.EXAMPLE
    .\tools\clean-book.ps1 C:\scans\book.pdf -Inspect

.EXAMPLE
    .\tools\clean-book.ps1 C:\scans\book.pdf -Gray -Quality 40

.EXAMPLE
    .\tools\clean-book.ps1 C:\scans\book.pdf -KeepOriginal

.EXAMPLE
    .\tools\clean-book.ps1 C:\scans\619294728-book.txt
#>

[CmdletBinding()]
param(
    [Parameter(Position = 0, ValueFromPipeline = $true)]
    [string[]] $Path,

    [switch] $DryRun,
    [switch] $SkipRename,
    [switch] $SkipShrink,
    [switch] $KeepOriginal,
    [switch] $Inspect,
    [string] $Output,
    [string] $OutDir,
    [switch] $Force,
    [int] $Quality,
    [int] $MinDpi,
    [int] $MonoDpi,
    [double] $Margin,
    [switch] $Gray,
    [switch] $Help,

    [string] $GhostscriptDir,

    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]] $Extra
)

$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'pdf-tools.ps1')

$run = Initialize-PdfTool -Tool 'pdf.py' -GhostscriptDir $GhostscriptDir

if ($Help) {
    & $run.Python $run.Tool '--help'
    exit $LASTEXITCODE
}

if (-not $Path) {
    Write-Error 'Give me a PDF or .txt file. Run with -Help for the options.'
}

$files = @(Resolve-PdfInput -Path $Path)

$flags = @()
if ($PSBoundParameters.ContainsKey('Quality')) { $flags += @('--quality', $Quality) }
if ($PSBoundParameters.ContainsKey('MinDpi'))  { $flags += @('--min-dpi', $MinDpi) }
if ($PSBoundParameters.ContainsKey('MonoDpi')) { $flags += @('--mono-dpi', $MonoDpi) }
if ($PSBoundParameters.ContainsKey('Margin'))  { $flags += @('--margin', $Margin) }
if ($PSBoundParameters.ContainsKey('Output'))  { $flags += @('--output', $Output) }
if ($PSBoundParameters.ContainsKey('OutDir'))  { $flags += @('--out-dir', $OutDir) }
if ($DryRun)       { $flags += '--dry-run' }
if ($SkipRename)   { $flags += '--skip-rename' }
if ($SkipShrink)   { $flags += '--skip-shrink' }
if ($KeepOriginal) { $flags += '--keep-original' }
if ($Inspect)      { $flags += '--inspect' }
if ($Force)        { $flags += '--force' }
if ($Gray)         { $flags += '--gray' }
if ($Extra)        { $flags += $Extra }

& $run.Python $run.Tool @flags '--' @files
exit $LASTEXITCODE
