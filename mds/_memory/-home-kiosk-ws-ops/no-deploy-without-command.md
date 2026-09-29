---
name: no-deploy-without-command
description: Never deploy/publish NobleSee to production without an explicit instruction to do so
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 19081661-b739-479f-8815-0bb82aa2e2ff
  modified: 2026-08-14T02:46:31.693Z
---

Do not run `npm run deploy` (or otherwise publish the Worker) unless the
user explicitly asks in that message. Build, typecheck and test freely;
stop before shipping and report that the change is ready but unpublished.

**Why:** stated on 2026-08-14, after several turns where deploying
immediately after each change was the established rhythm. Earlier the
user had said "production is actually not published, take it as a dev
env, just publish it" — that was permission for *those* changes, not a
standing grant, and I had been treating it as one.

**How to apply:** finish the work, verify locally, then say what is
ready and wait. Treat committing and pushing as the same class of action
unless the user has asked for it separately — "commit and push" has
always been its own instruction here.
