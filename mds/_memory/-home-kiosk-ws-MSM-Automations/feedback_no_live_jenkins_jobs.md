---
name: feedback-no-live-jenkins-jobs
description: Never trigger real Jenkins jobs/builds when investigating alerts or testing auto_remediation — read-only/replay only
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 4682a2ac-c1a6-42a0-9e4d-d6e8070ea5b2
  modified: 2026-07-23T18:01:16.202Z
---

Never trigger actual Jenkins jobs or builds (e.g. `mcp__jenkins__jenkins_trigger_build`, or calling orchestrator/remediation code paths that execute real jobs) while investigating alerts, debugging the `auto_remediation` orchestrator, or running reasoning evals.

**Why:** The reasoning_eval harness in `Aviator/auto_remediation/test/reasoning_eval/` is deliberately replay-based — it feeds the LLM historical, canned tool *results* so no Jenkins jobs are ever re-run for real. The user explicitly confirmed this constraint applies broadly, not just to the harness: real job triggers (restarts, monitor disables, etc.) have live side effects on production ALM/LRE/PPM farms and must not be fired as a side effect of testing, debugging, or exploration.

**How to apply:** When working with `auto_remediation`, alert runbooks, or the reasoning eval, stick to read-only Jenkins MCP tools (console logs, build status, job config, recent builds) and canned/replay test data. Only use `jenkins_trigger_build` or similar live-action tools if the user explicitly asks to trigger a real job outside of a testing context.
