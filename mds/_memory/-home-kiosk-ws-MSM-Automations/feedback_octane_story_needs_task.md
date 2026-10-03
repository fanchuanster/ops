---
name: feedback_octane_story_needs_task
description: Every Octane story must get a subtask carrying its estimated hours at creation time
metadata: 
  node_type: memory
  type: feedback
  originSessionId: afc6c75e-c4b6-4bc4-926c-580cd23f659e
  modified: 2026-08-09T02:43:44.099Z
---

Every Octane story (and quality story) must have at least one subtask that carries
its estimated hours, created at the same time as the story itself — never leave a
story with 0 tasks / 0 estimated hours.

**Why:** `estimated_hours`/`invested_hours` on a story are read-only rollups computed
from its tasks (see the `octane` skill's API quirks section) — a story with zero tasks
has no effort tracked against it at all, which is what a 2026-08-09 compliance sweep of
"My Work" caught: 4 of 9 active stories (485005, 471001, 468001, 463003) had 0 tasks and
0 estimated hours.

**How to apply:** When creating a regular story via the `octane` skill's
"Create a (regular Agile) Story" flow, always follow the `create_task` +
`PUT /tasks/{id}` estimated_hours step shown there — don't skip it even if the user
didn't explicitly ask for hours; ask them for an estimate instead of leaving it blank.
When reviewing/auditing existing tickets, flag any story with `tasks == []` as
non-compliant.
