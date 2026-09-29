$ErrorActionPreference = 'Stop'

$Mds = $PSScriptRoot
$WsRoot = if ($env:WS_ROOT) { [IO.Path]::GetFullPath($env:WS_ROOT) } else { [IO.Path]::GetFullPath((Join-Path $Mds '..\..')) }
$HostRepo = [IO.Path]::GetFullPath((Join-Path $Mds '..'))
$Banner = '<!-- Generated from CLAUDE.md by mds/sync.sh. Edit the CLAUDE.md in the mds repo, not this file. -->'
$HostBanner = '<!-- Generated from CLAUDE.md by mds/sync.sh. Edit CLAUDE.md in this repo, not this file. -->'
$SkillBanner = '<!-- Generated from skills/<name>/SKILL.md by mds/sync.sh. Edit it in the mds repo, not this file. -->'
$MaxDepth = 5
$ArgumentsPlaceholder = "<the user's request>"
$CommandDrops = @('name')
$SkillDrops = @('argument-hint')
$HostReference = '.github/reference'
$ImportPattern = '^@(\./)?([A-Za-z0-9._-][A-Za-z0-9._/-]*)\s*$'
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Get-Relative([string]$Base, [string]$Path) {
    return $Path.Substring($Base.Length).TrimStart('\', '/').Replace('\', '/')
}

function Sort-Ordinal([string[]]$Items) {
    $copy = [string[]]@($Items)
    [Array]::Sort($copy, [StringComparer]::Ordinal)
    return $copy
}

function Write-Lines([string]$Path, [string[]]$Lines) {
    [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($Path)) | Out-Null
    [IO.File]::WriteAllText($Path, (($Lines -join "`n") + "`n"), $Utf8NoBom)
}

function Copy-Verbatim([string]$Source, [string]$Target) {
    [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($Target)) | Out-Null
    Copy-Item -LiteralPath $Source -Destination $Target -Force
}

function Get-ImportChild([string]$Line) {
    $match = [regex]::Match($Line, $ImportPattern)
    if (-not $match.Success) { return $null }
    return $match.Groups[2].Value
}

function Resolve-Import([string]$File, [string]$Child) {
    $path = [IO.Path]::GetFullPath((Join-Path ([IO.Path]::GetDirectoryName($File)) $Child))
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "missing $path (imported by $File)"
    }
    return $path
}

function Get-ImportPaths([string]$File, [int]$Depth = 0) {
    if ($Depth -gt $MaxDepth) { throw "import depth exceeded at $File" }
    $paths = @()
    foreach ($line in [IO.File]::ReadAllLines($File)) {
        $child = Get-ImportChild $line
        if (-not $child) { continue }
        $path = Resolve-Import $File $child
        $paths += $path
        $paths += Get-ImportPaths $path ($Depth + 1)
    }
    return $paths
}

function Get-Flattened([string]$File, [int]$Depth = 0) {
    if ($Depth -gt $MaxDepth) { throw "import depth exceeded at $File" }
    $out = @()
    foreach ($line in [IO.File]::ReadAllLines($File)) {
        $child = Get-ImportChild $line
        if (-not $child) {
            $out += $line
            continue
        }
        $out += Get-Flattened (Resolve-Import $File $child) ($Depth + 1)
        $out += ''
    }
    return $out
}

function Write-Copilot([string]$Source, [string]$Dest, [string]$BannerText) {
    $lines = @($BannerText, '') + (Get-Flattened $Source)
    Write-Lines (Join-Path $Dest '.github\copilot-instructions.md') $lines
}

function Write-SkillFile([string]$Source, [string[]]$Drops, [string]$Substitute, [string]$Target) {
    $fence = 0
    $keeping = $true
    $started = $false
    $out = New-Object System.Collections.Generic.List[string]
    foreach ($line in [IO.File]::ReadAllLines($Source)) {
        if ($fence -lt 2 -and $line -match '^---\s*$') {
            $fence++
            $out.Add('---')
            if ($fence -eq 2) {
                $out.Add('')
                $out.Add($SkillBanner)
                $out.Add('')
            }
            continue
        }
        if ($fence -eq 1) {
            $key = [regex]::Match($line, '^[A-Za-z0-9_-]+(?=:)')
            if ($key.Success) { $keeping = $Drops -notcontains $key.Value }
            if ($keeping) { $out.Add($line) }
            continue
        }
        if ($fence -eq 2) {
            if (-not $started -and $line -match '^\s*$') { continue }
            $started = $true
            if ($Substitute) { $line = $line.Replace('$ARGUMENTS', $Substitute) }
            $out.Add($line)
        }
    }
    Write-Lines $Target $out.ToArray()
}

function Sync-Skills([string]$Repo, [string]$Dest) {
    $skillsDir = Join-Path $Repo 'skills'
    if (-not (Test-Path -LiteralPath $skillsDir -PathType Container)) { return }

    $sources = @()
    foreach ($dir in Get-ChildItem -LiteralPath $skillsDir -Directory) {
        $candidate = Join-Path $dir.FullName 'SKILL.md'
        if (Test-Path -LiteralPath $candidate -PathType Leaf) { $sources += $candidate }
    }

    foreach ($source in (Sort-Ordinal $sources)) {
        $sourceDir = [IO.Path]::GetDirectoryName($source)
        $name = [IO.Path]::GetFileName($sourceDir)

        Write-SkillFile $source $CommandDrops '' (Join-Path $Dest ".claude\commands\$name.md")

        $skillDest = Join-Path $Dest ".github\skills\$name"
        if (Test-Path -LiteralPath $skillDest) { Remove-Item -LiteralPath $skillDest -Recurse -Force }
        [IO.Directory]::CreateDirectory($skillDest) | Out-Null
        Copy-Item -Path (Join-Path $sourceDir '*') -Destination $skillDest -Recurse -Force
        Write-SkillFile $source $SkillDrops $ArgumentsPlaceholder (Join-Path $skillDest 'SKILL.md')
    }

    if ($sources.Count -gt 0) {
        Write-Host "synced $Repo -> $($sources.Count) skill(s) as .claude/commands/ and .github/skills/"
    }
}

function Get-ReferenceSources([string]$Dir) {
    $found = @()
    foreach ($entry in Get-ChildItem -LiteralPath $Dir -Force) {
        if ($entry.PSIsContainer) {
            if ($entry.Name -in @('node_modules', '.git', '.github')) { continue }
            if ($entry.FullName -in @($Mds, (Join-Path $HostRepo 'tmp'), (Join-Path $HostRepo 'content'))) { continue }
            $found += Get-ReferenceSources $entry.FullName
            continue
        }
        if ($entry.Extension -ne '.md') { continue }
        if ($entry.Name -ceq 'CLAUDE.md' -or $entry.Name -clike 'CLAUDE-*.md') { continue }
        $found += $entry.FullName
    }
    return $found
}

function Sync-Reference([string]$Dest) {
    $referenceDest = Join-Path $Dest $HostReference
    if (Test-Path -LiteralPath $referenceDest) { Remove-Item -LiteralPath $referenceDest -Recurse -Force }

    $sources = Sort-Ordinal (Get-ReferenceSources $HostRepo)
    foreach ($source in $sources) {
        Copy-Verbatim $source (Join-Path $referenceDest (Get-Relative $HostRepo $source))
    }

    if ($sources.Count -gt 0) {
        Write-Host "synced $([IO.Path]::GetFileName($HostRepo)) -> $($sources.Count) markdown file(s) as $HostReference/"
    }
}

function Sync-HostRepo {
    $name = [IO.Path]::GetFileName($HostRepo)
    $claude = Join-Path $HostRepo 'CLAUDE.md'

    try {
        Get-ImportPaths $claude | Out-Null
    } catch {
        [Console]::Error.WriteLine($_.Exception.Message)
        [Console]::Error.WriteLine("aborting ${name}: unresolvable imports in CLAUDE.md")
        exit 1
    }

    Write-Copilot $claude $HostRepo $HostBanner
    Write-Host "synced $name -> .github/copilot-instructions.md"
    Sync-Reference $HostRepo
    Sync-Skills $HostRepo $HostRepo
}

$claudeFiles = Get-ChildItem -LiteralPath $Mds -Recurse -File -Filter 'CLAUDE.md' |
    ForEach-Object { Get-Relative $Mds $_.FullName }

foreach ($rel in (Sort-Ordinal $claudeFiles)) {
    $repo = [IO.Path]::GetDirectoryName($rel.Replace('/', '\')).Replace('\', '/')
    $repoSource = Join-Path $Mds $repo
    $dest = Join-Path $WsRoot $repo

    if (-not (Test-Path -LiteralPath $dest -PathType Container)) {
        [Console]::Error.WriteLine("skip $repo (no checkout at $dest)")
        continue
    }

    $source = Join-Path $Mds $rel
    try {
        $parts = @(Get-ImportPaths $source)
    } catch {
        [Console]::Error.WriteLine($_.Exception.Message)
        [Console]::Error.WriteLine("aborting ${repo}: unresolvable imports in $rel")
        exit 1
    }

    Copy-Verbatim $source (Join-Path $dest 'CLAUDE.md')
    $copied = @('CLAUDE.md')

    foreach ($part in $parts) {
        $partRel = Get-Relative $repoSource $part
        Copy-Verbatim $part (Join-Path $dest $partRel)
        $copied += $partRel
    }

    Write-Copilot $source $dest $Banner
    Write-Host "synced $repo -> $($copied -join ', '), .github/copilot-instructions.md"
    Sync-Skills $repoSource $dest
}

Sync-HostRepo
