---
name: no-comments-in-code
description: Code comments are forbidden across the user's repos; reasoning goes in CLAUDE.md instead.
metadata:
  type: feedback
---

No comments in code — mandatory, not a preference. When I argued that the ops
codebase's ~2,300 comments recorded *why* and should be kept, the user
overruled it: "no comments is mandatory". Stripped on 2026-09-16.

**Why:** the rule is a house standard shared across their repos (it comes from
`mds/MSM_Automations/CLAUDE.md`). Names and structure carry the meaning; the
reasoning lives in CLAUDE.md, where it is read once instead of beside every
function.

**How to apply:** write no comments in new code. Machine-read directives are
code, not comments, and stay: `@ts-*`, `eslint-*`, `/// <reference>`, JSDoc
`@type` in .js config, `# shellcheck`, `# noqa`. Leave generated files as their
generators write them. When stripping, drive removal from a real parser (the
TypeScript scanner) — comment syntax inside strings, template literals and
regexes must survive. See [[mds-is-the-source-of-truth-for-instructions]].
