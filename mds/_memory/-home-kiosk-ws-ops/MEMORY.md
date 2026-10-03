# Memory

- [No deploying without an explicit command](no-deploy-without-command.md) — build and test freely, but stop before shipping.
- [No comments in code](no-comments-in-code.md) — mandatory house rule; reasoning goes in CLAUDE.md.
- [PDF reduction floor](pdf-reduction-floor.md) — q40 one rung below native is the worst combination, not a target.
- [Shared worktree](shared-worktree.md) — another session edits the same checkout; stage by path, never `git add -A`.
- [Commit and push is literal](commit-and-push-is-literal.md) — never merge to master unless asked.
- [Deploy does not merge](deploy-does-not-merge.md) — "deploy" = build+ship current branch only, never merge to master.
