---
name: commit-and-push-is-literal
description: "\"commit and push\" means git commit + git push on the current branch, never a merge to master"
metadata:
  type: feedback
---

When the user says "commit and push" in the ops repo, do exactly that: `git commit`
on the current branch (normally `wen_dev`) and `git push` that branch. Do not merge
into `master`, do not push `master`, do not run `.reset.sh`.

**Why:** CLAUDE.md 2.4 documents the merge-to-master flow (merge `wen_dev` into
`master` locally, push, then `bash .reset.sh`), and I read "commit and push" as a
request for that whole flow. It is not. That flow is a separate, explicit release
step the user asks for in its own words; "commit and push" is just the two git
commands. Applying the merge flow unasked put work on `master` — including another
session's WIP commit — before the user intended it.

**How to apply:** Take the phrase literally. Merge to `master` only when the user
says to merge, release, or ship. Same spirit as [[no-deploy-without-command]]:
advancing the shared branch is the user's call, not an inference from a short
instruction. See also [[shared-worktree]] for staging by path.
