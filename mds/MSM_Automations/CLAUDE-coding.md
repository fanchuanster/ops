# Coding Standards

- **Early returns.** Return early to avoid deeply nested if/else — guard clauses first,
  main logic unindented at the end.
- **Logging.** `logging.getLogger(__name__)`, not `print`.
- **No comments in code.** Names and structure carry the meaning — if a block needs a
  comment to be understood, rename it or split it out.
- **Reuse existing code.** Before writing any new function, check `libs/` for shared
  boilerplate that already solves it (`libs/util.py`, `libs/aws.py`, `libs/alm_farm.py`,
  `libs/jenkins_agent.py`, ...) and reuse or extend it. Same for any other existing
  utility in the repo — extending beats duplicating. Genuinely shared new helpers go in
  `libs/`, not next to their first caller.
- **Python over Groovy.** Write Jenkins job logic as Python (or bash) called from the
  Jenkinsfile rather than as Groovy content.

# Scratch / Temporary Files

- Never write throwaway files to the repo root. One-off fetch scripts, scratch data
  dumps, intermediate output and debugging helpers all go under `tmp/` (gitignored,
  `.gitignore` line 381).
- Prefix each file with the agent that created it, so ownership is obvious and stale
  files can be attributed: Hermes → `tmp/hermes_<description>.py`; anything else →
  `tmp/<agent>_<description>.<ext>`.
- Example: a one-off Octane fetch script is `tmp/hermes_octane_fetch.py`, not
  `tmp_octane_fetch.py` at the root.
- They are disposable — never reference them from committed code, and delete them when
  the task is done.
