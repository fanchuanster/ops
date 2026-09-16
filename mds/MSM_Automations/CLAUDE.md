# Sub repos

- `Aviator/` (`git@hmf.gitlab.otxlab.net:csd/adm/Aviator.git`) — AI-driven operations
  tools: `auto_remediation/` (alert orchestrator + dashboard), `ut_advisor/` (UT ticket
  solution suggestion and escalation evaluation), `questionnaire/` (AI-powered
  questionnaire autofill), `libs/` (shared utilities).
- `jenkins-infra/` — Jenkins container definitions: `alm_jenkins` and `aviator-agent`
  (slave).

# How this file is organised

The rules live in `CLAUDE-*.md` beside this file and are imported below. All of them
apply — the split is for editing and review, not scope. Each file is one area, so a
change to how commits are written touches one file rather than being hunted for in a
long document.

- `CLAUDE-coding.md` — early returns, logging, reuse, and where scratch files go
- `CLAUDE-git.md` — commit messages, Octane IDs, merge requests
- `CLAUDE-octane.md` — what to record on a story versus a subtask, and how
- `CLAUDE-environment.md` — Kiosk, Jenkins, kubeconfigs, GitLab access
- `CLAUDE-infrastructure.md` — ALM farm schema naming, changing shared AWS infra

A sub-repo's own `CLAUDE.md` (`Aviator/CLAUDE.md`) covers only what is specific to it;
everything here still applies there.

All of these are edited in the `mds` repo and synced out by `mds/sync.sh` — never in a
checkout, where the next sync overwrites them. The `CLAUDE-` prefix is deliberate: it
matches the `CL*.md` gitignore pattern both repos already carry, so a synced sub-file
stays untracked exactly as `CLAUDE.md` does.

@./CLAUDE-coding.md
@./CLAUDE-git.md
@./CLAUDE-octane.md
@./CLAUDE-environment.md
@./CLAUDE-infrastructure.md
