<#
.SYNOPSIS
    Prepares a downloaded scan for NobleSee on Windows: clean name, size
    under the upload limit.

.DESCRIPTION
    A wrapper around tools/clean-pdf.py, which does the two things a file
    pulled from an archive mirror always needs -- strips the database ids
    and byte-range digits off the filename, then shrinks the scan if it
    is over the 100 MB limit. The PDF is the first argument and
    everything else has a default, so the ordinary run is just the path:

        .\tools\clean-pdf.ps1 C:\Users\me\Downloads\619294728-13230487-南怀瑾选集-第9卷-2013-03-P699.pdf

    Both passes are independent: -SkipShrink only renames, -SkipRename
    only checks the size. -DryRun says what would happen and changes
    nothing, which is the way to look at a folder full of mirror
    filenames before committing to them.

    Defaults are deliberately not repeated here. Nothing is passed to the
    Python tool unless you asked for it, so the defaults are whatever
    clean-pdf.py says they are and the two cannot drift apart. Run -Help
    to read them from the tool itself.

    The Windows plumbing -- portable Ghostscript, a UTF-8 console, and
    whichever of python/python3/py actually runs -- is in
    tools/pdf-tools.ps1 and shared with tools/shrink-pdf.ps1. Ghostscript
    missing is a warning rather than an error here, because renaming does
    not need it and most files do not need shrinking at all.

    The tool is found from this script's own location and nothing changes
    directory, so a PDF path relative to wherever you are still resolves.

    This file is saved with a UTF-8 byte order mark, because Windows
    PowerShell 5.1 reads a .ps1 as ANSI without one and turns the Chinese
    above into mojibake.

.PARAMETER Path
    The PDF, or several. Exact names are matched first and wildcards
    after, so a filename containing brackets still resolves.

.PARAMETER DryRun
    Report both passes and change nothing -- no rename, no re-encoding.

.PARAMETER SkipRename
    Leave the filename alone and only deal with the size.

.PARAMETER SkipShrink
    Clean the filename and leave an oversized file oversized.

.PARAMETER KeepOriginal
    Leave the input where it is and write the shrunk copy beside it,
    named for the size it came out at. Without this the shrunk file
    replaces the original, so one file at one clean name is what is left.

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
    .\tools\clean-pdf.ps1 $env:USERPROFILE\Downloads\619294728-南怀瑾选集-第9卷-P699.pdf

.EXAMPLE
    .\tools\clean-pdf.ps1 C:\scans\*.pdf -DryRun

.EXAMPLE
    .\tools\clean-pdf.ps1 C:\scans\book.pdf -Gray -Quality 40

.EXAMPLE
    .\tools\clean-pdf.ps1 C:\scans\book.pdf -KeepOriginal
#>

[CmdletBinding()]
param(
    [Parameter(Position = 0, ValueFromPipeline = $true)]
    [string[]] $Path,

    [switch] $DryRun,
    [switch] $SkipRename,
    [switch] $SkipShrink,
    [switch] $KeepOriginal,
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

$run = Initialize-PdfTool -Tool 'clean-pdf.py' -GhostscriptDir $GhostscriptDir

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
if ($DryRun)       { $flags += '--dry-run' }
if ($SkipRename)   { $flags += '--skip-rename' }
if ($SkipShrink)   { $flags += '--skip-shrink' }
if ($KeepOriginal) { $flags += '--keep-original' }
if ($Gray)         { $flags += '--gray' }
if ($Extra)        { $flags += $Extra }

& $run.Python $run.Tool @flags '--' @files
exit $LASTEXITCODE
