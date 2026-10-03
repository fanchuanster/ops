---
name: shared-worktree
description: "Another Claude session works in the same /home/kiosk/ws/ops checkout, so files change mid-task."
metadata: 
  node_type: memory
  type: project
  originSessionId: 475c6310-fa8f-4945-a120-8aa0f706f57b
  modified: 2026-09-18T22:46:56.785Z
---

A second Claude session shares this worktree. Files appear, change and
get deleted while a task is running, including between a verify and the
commit that follows it.

**Why:** on 2026-09-18 a `git add -A` swept that session's half-finished
storage refactor into a commit of mine. It had been green minutes
earlier; as committed it failed 18 tests and the typecheck. The broken
commit reached `origin/wen_dev` before I caught it.

**How to apply:**
- Stage by path, never `git add -A` or `git commit -a`. Commit only
  files you opened and verified this turn.
- Re-run `git status` immediately before committing; if files you did
  not touch are dirty, say so and ask rather than bundling them.
- Verify *after* staging, not before — the gap is where the damage gets
  in.
- `bash .reset.sh` (see [[no-deploy-without-command]] for the
  neighbouring caution) deletes and recreates `origin/wen_dev`, which
  rejects the other session's next push until it fetches. Confirm before
  running it.
- A merge can run in a separate `git worktree` when the shared tree is
  dirty, leaving the other session's files untouched.
