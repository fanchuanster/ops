# Coding Standards

Repo-agnostic house rules. Each repo names its own concrete instances — its
logger, its shared module, its verify command — beside its import of this file.

- **Early returns.** Return early to avoid deeply nested if/else — guard clauses first,
  main logic unindented at the end.
- **No comments in code.** Names and structure carry the meaning — if a block needs a
  comment to be understood, rename it or split it out. The reasoning belongs in the
  instruction file, where it is read once rather than re-read beside every function.
  Only machine-read directives survive.
- **Reuse before writing.** Before adding a function, look for the one that already does
  it and extend rather than duplicate. A genuinely shared helper goes in the shared
  module, not next to its first caller.
- **Log through the project's logger**, never a bare `print` or `console.*`, and leave no
  debugging output behind.

# Scratch / Temporary Files

- Never write throwaway files to the repo root. One-off fetch scripts, scratch data
  dumps, intermediate output and debugging helpers all go under `tmp/` (gitignored).
- Prefix each file with the agent that created it, so ownership is obvious and stale
  files can be attributed — `tmp/<agent>_<description>.<ext>`.
- They are disposable — never reference them from committed code, and delete them when
  the task is done.
