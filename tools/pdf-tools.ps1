<#
.SYNOPSIS
    The Windows plumbing tools/*.ps1 share before calling a Python tool.

.DESCRIPTION
    Dot-source this from a wrapper:

        . (Join-Path $PSScriptRoot 'pdf-tools.ps1')
        $run = Initialize-PdfTool -Tool 'clean-pdf.py' -RequireGhostscript

    Three things have to be arranged before any of the PDF tools run on
    Windows, and getting one wrong looks like a different fault.

    Ghostscript is called gswin64c.exe there and is not on PATH when it
    has been unzipped rather than installed, so the portable directory is
    prepended; the Python tools look for gs, gswin64c and gswin32c in
    that order and say what they looked for when they find none.

    The console is code page 1252 by default, so a book named
    南怀瑾选集-典藏版-第05卷-扫描版.pdf prints as question marks and a
    UnicodeEncodeError can end the run before any work happens.
    PYTHONIOENCODING, PYTHONUTF8 and the console encoding are all set to
    UTF-8.

    Python is called python, python3 or py depending on how it was
    installed, and on a machine carrying the Store stub, python3 exists
    and does nothing. Each is tried until one reports a version.

    This file is saved with a UTF-8 byte order mark, because Windows
    PowerShell 5.1 reads a .ps1 as ANSI without one and turns the Chinese
    above into mojibake.
#>

function Initialize-PdfConsole {
    $env:PYTHONIOENCODING = 'utf-8'
    $env:PYTHONUTF8 = '1'
    try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
    if (Get-Command chcp.com -ErrorAction SilentlyContinue) { $null = chcp.com 65001 }
}

function Find-Python {
    foreach ($candidate in @('python', 'python3', 'py')) {
        $found = Get-Command $candidate -ErrorAction SilentlyContinue
        if (-not $found) { continue }
        & $found.Source '--version' 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) { return $found.Source }
    }
    Write-Error 'No working Python found. Install it from python.org, not the Microsoft Store stub.'
}

function Test-PyMuPdf {
    param([Parameter(Mandatory)][string] $Python)

    & $Python '-c' 'import pymupdf' 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Warning "PyMuPDF is missing, so the ladder cannot be trimmed to the scan's own resolution: $Python -m pip install pymupdf"
    }
}

function Initialize-PdfTool {
    param(
        [Parameter(Mandatory)][string] $Tool,
        [string] $GhostscriptDir,
        [switch] $RequireGhostscript
    )

    if (-not $GhostscriptDir) {
        $profileDir = if ($env:USERPROFILE) { $env:USERPROFILE } else { $HOME }
        $GhostscriptDir = Join-Path $profileDir 'ghostscript-portable\bin'
    }
    if (Test-Path -LiteralPath $GhostscriptDir) {
        $env:PATH = "$GhostscriptDir;$env:PATH"
    }
    elseif (-not (Get-Command 'gswin64c', 'gswin32c', 'gs' -ErrorAction SilentlyContinue)) {
        $message = "No Ghostscript found. Unzip the portable build into $GhostscriptDir, or pass -GhostscriptDir."
        if ($RequireGhostscript) { Write-Error $message } else { Write-Warning $message }
    }

    Initialize-PdfConsole

    $path = Join-Path $PSScriptRoot $Tool
    if (-not (Test-Path -LiteralPath $path)) {
        Write-Error "$Tool is not in $PSScriptRoot."
    }

    $python = Find-Python
    Test-PyMuPdf -Python $python

    [pscustomobject]@{ Python = $python; Tool = $path }
}

function Resolve-PdfInput {
    param([string[]] $Path)

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
    $files
}
