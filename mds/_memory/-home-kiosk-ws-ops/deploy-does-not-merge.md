---
name: deploy-does-not-merge
description: "\"deploy\" means build + ship the Worker from the current branch — never merge wen_dev into master"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 8fe14354-71f6-460a-8e85-72f24b369b77
  modified: 2026-09-27T02:25:18.714Z
---

When the user says "deploy" (or "deploy to production") in the ops repo, that means:
build and ship the Worker from whatever branch is currently checked out (normally
`wen_dev`) — `cd apps/web && ./cf npm run deploy`. It does **not** mean merge
`wen_dev` into `master`, push `master`, or run `.reset.sh`.

**Why:** CLAUDE.md 2.4 documents merge-to-master-then-deploy as the release flow,
and I read "deploy" as a request for that whole flow (merge, push master, reset
wen_dev, then build+ship). The user corrected this explicitly: "don't merge to
master, when I say deploy" / "from now on." Same root mistake as
[[commit-and-push-is-literal]] — inferring the full documented release ceremony
from a short instruction that only asked for one piece of it.

**How to apply:** On a bare "deploy" instruction, just build and ship from the
current branch. Only merge to master (and reset wen_dev) when the user
separately asks to merge, release, or ship *to master* in those words. See also
[[no-deploy-without-command]] and [[shared-worktree]].
