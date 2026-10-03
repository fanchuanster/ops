---
name: feedback-mr-create-merge-conventions
description: "MSM_Automations MRs: set force_remove_source_branch on create, always squash-merge, rewrite the merge message from the actual diff at merge time"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: a62037fb-c186-4713-9704-76137937e006
  modified: 2026-08-11T15:56:39.489Z
---

For MSM_Automations MRs (`csd/adm/MSM_Automations`, GitLab `hmf.gitlab.otxlab.net`):

1. **On create** — set `force_remove_source_branch: true` (and `squash: true`) in the create call. The project's `squash_option` is `default_off` and MRs default to `force_remove_source_branch: false`, so neither happens unless passed explicitly.
2. **On merge** — always pass `squash: true` to the merge API. Never rely on the project default.
3. **Merge message** — do not accept the auto-generated message (MR title / concatenated commit subjects). Read the real diff (`git diff origin/master...<branch>`, plus the commit list) and write `squash_commit_message` from what the branch actually changes. The same applies to the MR title/description, which drift as a long-lived branch grows.

**Why:** Stated by the user (2026-08-11) right after MR !73 was merged. That MR had accumulated ~50 commits across unrelated areas while its title/description still described only the first three, so both had to be rewritten from the diff before merging; squash and branch cleanup each had to be forced by hand because the project defaults don't do it.

**How to apply:** Merge via `PUT /merge_requests/:iid/merge` with `{"squash": true, "squash_commit_message": "<written from the diff>"}`. Follow the user's global commit rules — no AI attribution in the squash message. Target branch is always `master`, see [[feedback-pr-target-branch]].
