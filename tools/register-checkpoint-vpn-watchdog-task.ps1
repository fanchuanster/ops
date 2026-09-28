<#
.SYNOPSIS
    Registers a Scheduled Task that runs checkpoint-vpn-watchdog.ps1 every
    few minutes to keep the "SaaS" Check Point VPN connected.

.DESCRIPTION
    Uses schtasks.exe rather than Register-ScheduledTask: on this machine
    the PS_ScheduledTask CIM provider that cmdlet relies on returns
    "Access is denied" for a non-admin user, while the older schtasks.exe
    COM path works. The task runs under the current user, minute-based,
    and only fires while you are logged on (schtasks.exe's default for a
    task created this way) — which is what the VPN's certificate-prompt
    UI needs anyway.

    The task's action is wscript.exe running a generated VBScript
    launcher, not powershell.exe directly. powershell.exe is a console
    subsystem application, so even with -WindowStyle Hidden, Task
    Scheduler can flash its console for an instant on every run;
    wscript.exe has no console subsystem at all, and its
    WScript.Shell.Run with window style 0 starts PowerShell fully
    hidden, so nothing flashes.

    Re-running this script replaces the existing task and launcher
    rather than duplicating them.

.PARAMETER IntervalMinutes
    How often the watchdog checks the tunnel and reconnects if needed.

.PARAMETER SiteName
    Passed through to checkpoint-vpn-watchdog.ps1.

.EXAMPLE
    .\register-checkpoint-vpn-watchdog-task.ps1
.EXAMPLE
    .\register-checkpoint-vpn-watchdog-task.ps1 -IntervalMinutes 5
#>

param(
    [int] $IntervalMinutes = 1,
    [string] $SiteName = 'SaaS',
    [string] $TaskName = 'CheckPoint VPN Watchdog'
)

$watchdogScript = Join-Path $PSScriptRoot 'checkpoint-vpn-watchdog.ps1'
if (-not (Test-Path -LiteralPath $watchdogScript)) {
    Write-Error "checkpoint-vpn-watchdog.ps1 not found next to this script at $watchdogScript."
}

$launcherDir = Join-Path $env:LOCALAPPDATA 'ops-tools'
if (-not (Test-Path -LiteralPath $launcherDir)) {
    New-Item -ItemType Directory -Path $launcherDir -Force | Out-Null
}
$launcherPath = Join-Path $launcherDir 'checkpoint-vpn-watchdog-launcher.vbs'

$psCommand = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$watchdogScript`" -SiteName `"$SiteName`""
$vbsEscapedCommand = $psCommand -replace '"', '""'
$vbsContent = @"
Set objShell = CreateObject("WScript.Shell")
objShell.Run "$vbsEscapedCommand", 0, True
"@
Set-Content -LiteralPath $launcherPath -Value $vbsContent -Encoding ASCII

& schtasks.exe /Delete /TN $TaskName /F 2>$null | Out-Null

$taskRun = "wscript.exe `"$launcherPath`""
$createOutput = & schtasks.exe /Create /TN $TaskName /TR $taskRun /SC MINUTE /MO $IntervalMinutes /F 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Error "schtasks.exe failed to create the task:`n$createOutput"
}

Write-Host "Registered task '$TaskName': checks the VPN every $IntervalMinutes minute(s) while you're logged in."
Write-Host "Log file: $env:LOCALAPPDATA\ops-tools\checkpoint-vpn-watchdog.log"
Write-Host "To run one check immediately: schtasks /Run /TN `"$TaskName`""
Write-Host "To remove it later: schtasks /Delete /TN `"$TaskName`" /F"
