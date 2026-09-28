<#
.SYNOPSIS
    Reconnects the Check Point Endpoint Connect VPN (site "SaaS") when its
    tunnel is down.

.DESCRIPTION
    Meant to be fired periodically by a Scheduled Task (see
    register-checkpoint-vpn-watchdog-task.ps1), not run as a foreground
    loop: each invocation does one status check and, if needed, one
    reconnect attempt, then exits. A lock file stops two invocations from
    overlapping if a previous run is still mid-reconnect.

    Does nothing if the Endpoint Connect client itself (TrGUI.exe) isn't
    running — this script never starts the client and never connects on
    its behalf when the user has it closed. It only reconnects a client
    that is alive but has dropped its tunnel.

    trac.exe is invoked through System.Diagnostics.Process with
    CreateNoWindow set, not the `&` call operator, so its console window
    never flashes on screen when the Scheduled Task fires.

    The p12 certificate this site authenticates with needs its password
    on every connect; Check Point does not cache it. Run
    set-checkpoint-vpn-credential.ps1 once to store that password
    DPAPI-encrypted (readable only by your Windows account on this
    machine), and this script decrypts it just long enough to pass to
    `trac.exe connect -f <p12> -p <password>`. That password is briefly
    visible on the trac.exe process command line while it runs, which is
    inherent to how the CLI takes it — anyone with a process-listing tool
    running locally at that instant could read it. If no credential file
    exists, this script falls back to `trac.exe connectgui`, which opens
    the normal Check Point login dialog on your desktop for you to type
    into by hand.

.PARAMETER SiteName
    The Check Point site/profile to connect, as shown in `trac.exe info`
    (e.g. 'SaaS').

.PARAMETER TracExePath
    Full path to trac.exe. Auto-detected from the standard Endpoint
    Connect install location and PATH when omitted.

.PARAMETER CredentialPath
    Where the DPAPI-encrypted p12 password lives. Defaults to
    %LOCALAPPDATA%\ops-tools\checkpoint-vpn.cred, written by
    set-checkpoint-vpn-credential.ps1.

.PARAMETER LogPath
    Where status/reconnect events are appended. Defaults to
    %LOCALAPPDATA%\ops-tools\checkpoint-vpn-watchdog.log.

.EXAMPLE
    .\checkpoint-vpn-watchdog.ps1 -SiteName SaaS
#>

param(
    [string] $SiteName = 'SaaS',
    [string] $TracExePath,
    [string] $CredentialPath = (Join-Path $env:LOCALAPPDATA 'ops-tools\checkpoint-vpn.cred'),
    [string] $LogPath = (Join-Path $env:LOCALAPPDATA 'ops-tools\checkpoint-vpn-watchdog.log')
)

function Write-Log {
    param([string] $Message)

    $line = "{0:yyyy-MM-dd HH:mm:ss} {1}" -f (Get-Date), $Message
    $logDir = Split-Path -Parent $LogPath
    if (-not (Test-Path -LiteralPath $logDir)) {
        New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    }
    Add-Content -LiteralPath $LogPath -Value $line
    Write-Host $line
}

function Find-TracExe {
    param([string] $ExplicitPath)

    if ($ExplicitPath) {
        if (Test-Path -LiteralPath $ExplicitPath) { return (Resolve-Path -LiteralPath $ExplicitPath).Path }
        Write-Error "TracExePath does not exist: $ExplicitPath"
    }

    $candidates = @(
        "${env:ProgramFiles(x86)}\CheckPoint\Endpoint Connect\trac.exe",
        "$env:ProgramFiles\CheckPoint\Endpoint Connect\trac.exe"
    )
    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path -LiteralPath $candidate)) { return (Resolve-Path -LiteralPath $candidate).Path }
    }

    $onPath = Get-Command 'trac.exe' -ErrorAction SilentlyContinue
    if ($onPath) { return $onPath.Source }

    Write-Error 'trac.exe not found. Pass -TracExePath explicitly.'
}

function Test-ClientRunning {
    Get-Process -Name 'TrGUI' -ErrorAction SilentlyContinue | Select-Object -First 1
}

function ConvertTo-ProcessArgumentString {
    param([string[]] $Arguments)

    ($Arguments | ForEach-Object { '"' + ($_ -replace '"', '\"') + '"' }) -join ' '
}

function Invoke-TracCommand {
    param([string] $TracExe, [string[]] $Arguments)

    $psi = [System.Diagnostics.ProcessStartInfo]::new()
    $psi.FileName = $TracExe
    $psi.Arguments = ConvertTo-ProcessArgumentString -Arguments $Arguments
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true

    $proc = [System.Diagnostics.Process]::Start($psi)
    $stdout = $proc.StandardOutput.ReadToEnd()
    $stderr = $proc.StandardError.ReadToEnd()
    $proc.WaitForExit()
    "$stdout$stderr"
}

function Get-VpnStatus {
    param([string] $TracExe, [string] $Site)

    $output = Invoke-TracCommand -TracExe $TracExe -Arguments @('info', '-s', $Site)
    $state = 'Unknown'
    if ($output -match '(?im)^\s*status:\s*(\S+)') { $state = $Matches[1] }
    $certPath = $null
    if ($output -match '(?im)certificate path:\s*(\S+)') { $certPath = $Matches[1] }
    [pscustomobject]@{ State = $state; CertPath = $certPath; Raw = $output }
}

function Get-StoredPassword {
    param([string] $Path)

    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    $secure = Get-Content -LiteralPath $Path | ConvertTo-SecureString
    $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
        [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    }
    finally {
        [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
}

function Start-VpnReconnect {
    param([string] $TracExe, [string] $Site, [string] $CertPath, [string] $Password)

    if ($Password -and $CertPath) {
        return Invoke-TracCommand -TracExe $TracExe -Arguments @('connect', '-s', $Site, '-f', $CertPath, '-p', $Password)
    }
    Invoke-TracCommand -TracExe $TracExe -Arguments @('connectgui', '-s', $Site)
}

$lockPath = Join-Path $env:TEMP 'checkpoint-vpn-watchdog.lock'
$lockAcquired = $false
try {
    $lockStream = [System.IO.File]::Open($lockPath, [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
    $lockAcquired = $true
}
catch {
    Write-Log 'Another watchdog run holds the lock; skipping this pass.'
    exit 0
}

try {
    if (-not (Test-ClientRunning)) {
        exit 0
    }

    $tracExe = Find-TracExe -ExplicitPath $TracExePath
    $status = Get-VpnStatus -TracExe $tracExe -Site $SiteName

    switch ($status.State) {
        'Connected' { exit 0 }
        'Connecting' { exit 0 }
        'Disconnecting' { exit 0 }
        'Idle' {
            $password = Get-StoredPassword -Path $CredentialPath
            try {
                Write-Log "VPN idle/disconnected, reconnecting site '$SiteName'..."
                $result = Start-VpnReconnect -TracExe $tracExe -Site $SiteName -CertPath $status.CertPath -Password $password
                Write-Log "reconnect output: $result"
            }
            finally {
                $password = $null
            }
        }
        default {
            Write-Log "Unrecognized status '$($status.State)', leaving connection alone this pass:`n$($status.Raw)"
        }
    }
}
finally {
    if ($lockAcquired) {
        $lockStream.Close()
        Remove-Item -LiteralPath $lockPath -ErrorAction SilentlyContinue
    }
}
