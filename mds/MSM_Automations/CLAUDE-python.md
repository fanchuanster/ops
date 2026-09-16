# Python and repo layout

What the shared coding standards mean in this repo.

- **The logger** is `logging.getLogger(__name__)`, not `print`.
- **Reuse** means checking `libs/` first for shared boilerplate that already solves it
  (`libs/util.py`, `libs/aws.py`, `libs/alm_farm.py`, `libs/jenkins_agent.py`, ...) and
  reusing or extending it. Same for any other existing utility in the repo — extending
  beats duplicating. Genuinely shared new helpers go in `libs/`, not next to their first
  caller.
- **Python over Groovy.** Write Jenkins job logic as Python (or bash) called from the
  Jenkinsfile rather than as Groovy content.
- **Scratch files** are gitignored by `.gitignore` line 381. Hermes writes
  `tmp/hermes_<description>.py` — a one-off Octane fetch script is
  `tmp/hermes_octane_fetch.py`, not `tmp_octane_fetch.py` at the root.
