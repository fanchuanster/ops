<#
.SYNOPSIS
    One-time setup: stores your Check Point p12 certificate password so
    checkpoint-vpn-watchdog.ps1 can reconnect the "SaaS" VPN unattended.

.DESCRIPTION
    Prompts for the password interactively and writes it to disk with
    ConvertFrom-SecureString, which encrypts it with Windows DPAPI under
    your Windows account. The file is only ever readable as plaintext by
    the same Windows user on this same machine; it is useless if copied
    elsewhere or read by another account. The plaintext password is never
    logged, printed, or passed on a command line by this script.

    Re-run this whenever the certificate's password changes.

.PARAMETER CredentialPath
    Where the encrypted password is stored. Defaults to
    %LOCALAPPDATA%\ops-tools\checkpoint-vpn.cred.

.EXAMPLE
    .\set-checkpoint-vpn-credential.ps1
#>

param(
    [string] $CredentialPath = (Join-Path $env:LOCALAPPDATA 'ops-tools\checkpoint-vpn.cred')
)

$secure = Read-Host -Prompt 'Enter the Check Point p12 certificate password' -AsSecureString
if ($secure.Length -eq 0) {
    Write-Error 'No password entered; nothing was saved.'
}

$credentialDir = Split-Path -Parent $CredentialPath
if (-not (Test-Path -LiteralPath $credentialDir)) {
    New-Item -ItemType Directory -Path $credentialDir -Force | Out-Null
}

$secure | ConvertFrom-SecureString | Set-Content -LiteralPath $CredentialPath -Encoding ASCII

Write-Host "Saved, encrypted for your Windows account only, at $CredentialPath."
Write-Host 'checkpoint-vpn-watchdog.ps1 will pick it up automatically on its next run.'
