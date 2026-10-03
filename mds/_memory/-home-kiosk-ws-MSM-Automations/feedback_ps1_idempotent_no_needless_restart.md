---
name: feedback-ps1-idempotent-no-needless-restart
description: LRE/ALM PowerShell tool scripts must be idempotent - no write, no service reload/restart when the setting is already correct
metadata:
  type: feedback
---

Every PowerShell tool script under `lre/ps1/` (and equivalents elsewhere) must be
idempotent: read the current state first, and if the desired setting is already in
place, do nothing and say so. Never write the setting back "just to be sure", and
never reload, restart or refresh the service unconditionally — `iisreset`,
`gpupdate /force`, `Restart-Service`, `Clear-DnsClientCache` and friends run **only**
when the script actually changed something.

Raised 2026-09-15 about `lre/ps1/lre_add_conditional_vpc_resolver.ps1`, whose add path
rewrote the NRPT registry values and then ran `gpupdate /force` + `Clear-DnsClientCache`
on every run even when the rule was already correct and in effect.

**Why:** these scripts run against production LRE Controllers and web servers. An
unconditional refresh is real disruption for no gain — `gpupdate /force` reapplies all
computer policy, `Clear-DnsClientCache` drops every cached entry, `iisreset` takes the
web UI down. It also makes reruns unsafe, so nobody re-runs them to confirm state.

**How to apply:** compute a `needsChange` flag by comparing current state to desired
(including whether the setting is actually *in effect*, not just present in the store).
Branch the writes and the reload on that flag; keep the read-back verification running
unconditionally so an idempotent no-op run still proves the state. `-DryRun` should
report "already correct - no change needed" rather than describing a write it would not
do. `lre/ps1/lre_prepare_web_orchestration.ps1` already follows this pattern — it stages
every edit in memory and skips `iisreset` when nothing changed. See also
[[feedback-no-unverified-field-values]].
