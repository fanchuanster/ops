# mds

Instruction files for repositories where keeping them in the repo itself is not
convenient — shared repos, repos with other maintainers, or repos whose checkout
is not the place to be editing guidance. They are tracked here instead, and this
is the copy that is maintained.

It is also the source of truth for **GitHub Copilot**, not just Claude Code. The
same guidance has to reach whichever assistant a given development environment
is running, so it is written once here and consumed by both.

## Layout

The tree mirrors each repository's own path, so a file's location says which
repo and which directory it governs:

```
mds/
  sync.sh
  MSM_Automations/CLAUDE.md
  MSM_Automations/Aviator/CLAUDE.md
```

A nested file covers its own sub-repo; the parent file covers everything above
it. Adding a repo means recreating its path here, dropping in a `CLAUDE.md`, and
running `sync.sh`.

## One source, two assistants

`CLAUDE.md` is the only file anyone edits, and the only file tracked here.
Copilot reads `.github/copilot-instructions.md` and Claude Code reads
`CLAUDE.md`, so each checkout needs both — but the Copilot one is the same
bytes with a generated-by banner on top, so it is produced by `sync.sh` at the
destination and never version-controlled. Writing both by hand would give the
two assistants rules that quietly drift apart, which is the one failure this
folder exists to prevent.

## sync.sh

```bash
bash sync.sh
```

For each `CLAUDE.md` here, copies it to the matching checkout under `..`
(override with `WS_ROOT=...`) and writes `.github/copilot-instructions.md`
beside it. A repo with no checkout is skipped and reported.

Run it after every edit. The flow is one-way — **edit here, sync out** — and a
change made only in a repo's own copy is invisible to the other environment and
will be overwritten by the next run.

## The two repos behave differently

- `CLAUDE.md` is gitignored in both MSM_Automations and Aviator (pattern
  `CL*.md`), which is why it lives here.
- `.github/copilot-instructions.md` is **not** ignored by either, so after a
  sync it shows up as untracked in both. It is a generated file — ignore it
  there, or commit it there if that repo wants it; either way it is never
  edited, and the next sync overwrites it.
