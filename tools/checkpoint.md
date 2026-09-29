# Check Point VPN auto-reconnect

Watchdog for the Check Point **Endpoint Connect** client (`trac.exe` /
`TrGUI.exe`). A Scheduled Task checks the tunnel every 60 seconds and
reconnects it automatically if the client is running but idle. It never
starts the client and never connects on its behalf when the client
itself is closed.

Scripts, all in this `tools/` folder:

- `checkpoint-vpn-watchdog.ps1` — the actual check-and-reconnect logic.
- `set-checkpoint-vpn-credential.ps1` — one-time setup to store the p12
  certificate password.
- `register-checkpoint-vpn-watchdog-task.ps1` — registers the Scheduled
  Task that fires the watchdog.

## Prerequisites

- Check Point Endpoint Connect already installed, with the VPN site
  (e.g. `SaaS`) already configured and its p12 certificate already set
  up in Endpoint Connect. This does not provision the VPN itself, only
  automates reconnect for an existing setup.
- Confirm the client's install path and executable names match what the
  scripts assume:
  `C:\Program Files (x86)\CheckPoint\Endpoint Connect\trac.exe`, and a
  running `TrGUI.exe` process. If a machine uses a different Check
  Point client build (e.g. a "Harmony Endpoint" naming), check first
  with:

  ```powershell
  Get-ChildItem "C:\Program Files (x86)\CheckPoint" -Recurse -Filter *.exe
  ```

  The exe/process names may differ, and `checkpoint-vpn-watchdog.ps1`'s
  `Find-TracExe` / `Test-ClientRunning` would need updating to match.

## Setup on a machine

1. Get the scripts onto the machine — clone this repo, or just copy
   `checkpoint-vpn-watchdog.ps1`, `set-checkpoint-vpn-credential.ps1`
   and `register-checkpoint-vpn-watchdog-task.ps1` from `tools/`.

2. Store the p12 password. Run this interactively yourself, as the
   Windows account that will run the VPN — the password is typed once
   here and never appears in any script argument or log after this:

   ```powershell
   powershell -File .\tools\set-checkpoint-vpn-credential.ps1
   ```

   Saves it DPAPI-encrypted to
   `%LOCALAPPDATA%\ops-tools\checkpoint-vpn.cred`, decryptable only by
   that Windows account on that machine. Re-run this whenever the
   certificate's password changes.

3. Register the Scheduled Task (adjust `-SiteName` if the site isn't
   named "SaaS" on this machine):

   ```powershell
   powershell -File .\tools\register-checkpoint-vpn-watchdog-task.ps1 -SiteName "SaaS" -IntervalMinutes 1
   ```

   Registers via `schtasks.exe` (not the `Register-ScheduledTask`
   cmdlet — its PS_ScheduledTask CIM provider returned "Access is
   denied" for a non-admin user here). The task's action is
   `wscript.exe` running a generated hidden VBScript launcher, not
   `powershell.exe` directly, so nothing flashes on screen on any
   check: `powershell.exe -WindowStyle Hidden` is still a console
   subsystem app and can flash its console for an instant when Task
   Scheduler starts it; `wscript.exe` has no console subsystem at all.

4. Verify:

   ```powershell
   # force a disconnect, then run one check immediately
   & "C:\Program Files (x86)\CheckPoint\Endpoint Connect\trac.exe" disconnect
   schtasks /Run /TN "CheckPoint VPN Watchdog"
   Start-Sleep -Seconds 15
   Get-Content "$env:LOCALAPPDATA\ops-tools\checkpoint-vpn-watchdog.log" -Tail 10
   & "C:\Program Files (x86)\CheckPoint\Endpoint Connect\trac.exe" info -s SaaS
   ```

   Expect the log to show a reconnect attempt and `trac.exe info` to
   report `status: Connected`.

## Operating notes

- **Battery power**: `schtasks.exe`'s default task settings disallow
  starting on battery and stop the task if the machine switches to
  battery — on a laptop this silently stops all reconnect attempts
  with no visible error. `register-checkpoint-vpn-watchdog-task.ps1`
  clears both settings via the Task Scheduler COM API right after
  creating the task; if a task predates this fix, re-run the
  registration script to pick it up.
- **Password exposure**: `trac.exe connect -f <p12> -p <password>`
  takes the password as a command-line argument, briefly visible on
  the `trac.exe` process command line while it runs. This is inherent
  to how the CLI takes it — anyone with a process-listing tool running
  locally at that instant could read it. If that risk isn't acceptable
  on a given machine, don't run `set-checkpoint-vpn-credential.ps1`
  there; the watchdog then falls back to `trac.exe connectgui`, which
  opens the normal Check Point login dialog for a human to type into.
- **Client-closed means hands-off**: if `TrGUI.exe` isn't running, the
  watchdog does nothing at all — it doesn't launch the client and
  doesn't attempt any connection.
- **Log**: `%LOCALAPPDATA%\ops-tools\checkpoint-vpn-watchdog.log`.
- **Lock file**: `%TEMP%\checkpoint-vpn-watchdog.lock` stops two
  invocations from overlapping if a previous run is still mid-reconnect.
- **Remove the task**: `schtasks /Delete /TN "CheckPoint VPN Watchdog" /F`
- **Locked-down servers**: if Group Policy blocks scheduled task
  creation entirely, step 3 will fail outright even through
  `schtasks.exe` — test it before relying on this on such a machine.
