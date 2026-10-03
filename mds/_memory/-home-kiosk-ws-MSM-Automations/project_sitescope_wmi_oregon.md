---
name: project-sitescope-wmi-oregon
description: SiteScope team migrating INFRA prod monitors to WMI; Oregon PPM SiteScope temporarily moved to a restored instance due to a WMI performance issue
metadata: 
  node_type: memory
  type: project
  originSessionId: 054d8769-bf7d-438c-bf17-3a687ba341d7
  modified: 2026-08-07T17:18:10.580Z
---

As of 2026-07-31, the SiteScope Support team is standardizing new monitor deployments on WMI and plans to convert existing monitors on these instances (once due for upgrade):
- INFSYDSIS-023 (Linux) 10.209.16.89 — Sydney
- INFSYDSIS-001.infra.mms 10.209.16.71 — Sydney
- INFFRASIS-021.infra.mms (Linux) 10.211.16.204 — Frankfurt
- INFSYDSIS-022 10.209.16.66 — Sydney
- INFORGSIS-021.infra.mms (Linux) 10.210.16.27 — Oregon

After switching Oregon (INFORGSIS-021) to WMI, they hit a performance issue. They temporarily restored service on a different instance: `https://10.210.21.89:443/SiteScope` (client version 23.4), and said monitoring/alerting semantics are unchanged. They asked to be kept posted on any new monitor deployment/removal on this instance until they revert to the production instance (10.210.16.27).

**Why:** `Aviator/libs/sis.py` has a hardcoded `_PPM_SIS_URLS['Oregon']` fallback (used only when the live MSM-DB lookup for a farm's SiteScope URL fails or is unreachable) that pointed at the old prod IP 10.210.16.27, which would go stale/unreachable during this transition.

**How to apply:** `Aviator/libs/sis.py` `_PPM_SIS_URLS['Oregon']` is `['https://10.210.21.89:443/SiteScope/api/', 'https://10.210.16.27:443/SiteScope/api/']` (`.89` listed first). As of 2026-08-07, `SisAlertManager.list_alerts()` no longer just picks the first *reachable* candidate — it walks the ordered list (MSM URL, then this region list) and keeps trying until one actually returns monitors for the target, so a merely-up-but-empty `.89` now auto-cascades to `.27` without needing a code change. This was prompted by `PPMOGN109P-001` actually living on `.27` while `.89` was still reachable. No manual revert needed when the SiteScope team fully cuts back to `.27` — but once they confirm the cutover is complete and `.89` is being decommissioned, it's still worth removing `.89` from the list to avoid the wasted probe on every lookup. Also still worth checking with them whether any monitors were added/removed on `.89` via our farm automation in the interim, per their request to be kept posted.
