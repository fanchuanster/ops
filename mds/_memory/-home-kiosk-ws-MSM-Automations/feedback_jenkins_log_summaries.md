---
name: feedback-jenkins-log-summaries
description: What to exclude as noise when summarizing Jenkins console logs for this user
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 01de6816-0880-4280-a6a3-f78208ef1295
---

When summarizing Jenkins console log output (e.g. via `mcp__jenkins__jenkins_get_console_log`), omit routine JVM/environment boilerplate unless it indicates an actual problem. Specifically skip lines like:
- `JAVA_HOME = ...`
- `openjdk version "..."`
- `OpenJDK Runtime Environment ...`
- `OpenJDK 64-Bit Server VM ...`

**Why:** User called this out as unnecessary noise in a RestartPpm build summary — these lines are always identical/expected and add no signal.

**How to apply:** When reporting results of any Jenkins job (RestartPpm, RestartAlm, Health_Check, etc.), keep the summary focused on: checkout/commit info if relevant, the actual action result (service status, verdicts, errors), and pass/fail. Drop static environment/version banners unless a version mismatch or missing tool is itself the problem being diagnosed.
