---
name: feedback-pr-target-branch
description: "MSM_Automations MRs/PRs must target master, never apm_restart"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 08a2334e-277a-4169-a90f-c6abc4a25523
  modified: 2026-07-27T13:38:12.777Z
---

For the MSM_Automations GitLab repo (`csd/adm/MSM_Automations`), always target **`master`** as the base/target branch for merge requests — never `apm_restart`.

**Why:** The session's automatic git-status metadata reports "Main branch (you will usually use this for PRs): apm_restart", which is incorrect for this repo. The user explicitly corrected this (2026-07-27) after an MR was opened against `apm_restart` and had to be retargeted to `master`.

**How to apply:** Ignore the git-status "Main branch" hint for this repo specifically when opening MRs — use `master` regardless of what that metadata says. If unsure in a future session whether the hint is still wrong, quickly check `git branch -r` / ask, but default to `master`.
