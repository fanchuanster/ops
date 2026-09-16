# Git Commits — Octane Traceability

Put the Octane item's ID in the commit message when the commit is that item's work. A
nice-to-have, never a gate.

- Format: bare numeric ID, colon, subject —
  `486007: Register LRE VTS servers with the new PC VTS role`.
- Reference the **first-level** item (user story, defect, quality story). Use a
  **subtask** ID only when the commit is scoped to that subtask and the parent would
  mislead.
- One commit spanning two items gets both, comma-separated: `485005, 487002: ...`.
- Pick the item silently when the match is confident — don't stop to ask. With no
  confident match (repo chores, tooling, docs cleanup, drive-by fixes, unclear owner),
  omit the ID and commit anyway. An absent ID is fine; a guessed one is not.
- The ID is the only addition — global commit rules still apply (no AI attribution, no
  generated-by footers, message describes the actual change).

# Merge Requests

- Never end a response by reminding the user to open a merge request, or by offering the
  GitLab "create MR" link.
- After a push, report what was pushed and stop. Open an MR only when asked.
