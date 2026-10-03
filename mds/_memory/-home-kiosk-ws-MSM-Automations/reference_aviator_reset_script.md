---
name: reference_aviator_reset_script
description: "Aviator/.reset.sh recreates local+remote wen_dev off latest main — run it after every merge to main instead of doing the branch dance by hand"
metadata:
  type: reference
---

`Aviator/.reset.sh` is the sanctioned way to refresh the `wen_dev` working branch after
a merge into `main`. Run it instead of hand-rolling checkout/delete/force-push:

```bash
cd /home/kiosk/ws/MSM_Automations/Aviator && bash .reset.sh
```

Use `bash .reset.sh` — the file is mode `-rw-rwx---`, not executable for the owner.

What it does: checkout `main` → delete local `wen_dev` → fetch + pull → **delete the
remote** `wen_dev` → recreate `wen_dev` off the freshly-pulled `main` → push with
`--set-upstream`. So it rebuilds both sides and restores tracking to `origin/wen_dev`.

Notes:
- It deletes and re-pushes the remote branch rather than force-pushing in place. That's
  the intended behaviour here; don't "improve" it into a `--force-with-lease` push.
- It assumes everything on `wen_dev` is already merged — it hard-deletes with
  `git branch -D`. Merge first, then reset.
- Aviator's `main` merges keep real merge commits (not squash), and `wen_dev` is
  long-lived, so an Aviator MR must NOT set `remove_source_branch` — the reset script
  owns the branch's lifecycle. This differs from the MSM_Automations feature-branch
  convention in [[feedback_mr_create_merge_conventions]].
- Aviator GitLab project id: `132634`, default branch `main`. See
  [[reference_gitlab_merge_api_put]] for the merge API details.
- The MSM_Automations root has its own `.reset.sh` doing the same with `master` as the
  base (`bash .reset.sh` from the repo root). MSM MRs are squash-merged, so `wen_dev`
  always looks "N commits ahead" afterwards — compare trees
  (`git rev-parse origin/master^{tree} wen_dev^{tree}`) to confirm nothing is unmerged.
