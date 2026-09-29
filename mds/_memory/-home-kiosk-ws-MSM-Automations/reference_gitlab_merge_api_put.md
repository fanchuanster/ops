---
name: reference_gitlab_merge_api_put
description: "GitLab's MR merge endpoint is PUT; POST returns a route-level 404 that looks like a missing MR"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 9deb2f1a-2ac3-4899-bd26-314db3d86425
  modified: 2026-08-19T23:08:23.820Z
---

`https://hmf.gitlab.otxlab.net/api/v4/projects/{id}/merge_requests/{iid}/merge` accepts
**PUT** only. A `POST` to it returns `404 {"error":"404 Not Found"}` — GitLab has no POST
route, so it 404s before looking at the MR.

Distinguish the two 404 shapes when debugging:

- `{"error":"404 Not Found"}` — route/method miss (wrong verb).
- `{"message":"404 Not found"}` — real missing project or MR.

Permission and state failures are **not** 404: refused merge / already-merged is `405`,
stale SHA is `409`. So a 404 from this endpoint is always an addressing problem, never
"the merge was rejected".

Auth failures on this API read backwards from the usual intuition — measured against
`/merge_requests/{iid}/approvals` on a private project:

| sent | result |
| --- | --- |
| no token, empty `PRIVATE-TOKEN`, or misspelled header | `404` (private projects are hidden from anonymous callers) |
| non-empty but wrong token — unexpanded `$GITLAB_TOKEN`, a masked/redacted value, a truncated token | `401` |
| valid token via `PRIVATE-TOKEN` or `Authorization: Bearer` | `200` |

So **401 means a wrong token was sent, not a missing one, and never "insufficient
permissions"** (that would be 403 for scope, 404 for project access). Trailing whitespace
on the token is tolerated.

Numeric project ids: MSM_Automations `120168`, LRE_Provisioning `120172`,
ALM_Provisioning `120226`. Membership is identical across them; `wdong2` is Developer (30),
enough to merge `qc_prod` (protected, merge allowed for Developers+) and `lre_clz`
(unprotected).

**Why:** diagnosed 2026-08-19 when the hermes MR automation reported
"404 Not Found during merge attempt" on two MRs. Two causes: it sent `POST` instead of
`PUT`, and it hardcoded project `120168` while the MRs lived in 120172/120226 — pairing a
foreign iid with the MSM project id. Probed safely against already-merged MRs.

**How to apply:** carry `project_id` from the MR listing into both the `/approvals` check
and the merge call rather than resolving one project path once. Pass
`should_remove_source_branch=true` explicitly — `remove_source_branch_after_merge` is set
on MSM_Automations but is not uniform across projects. See
[[feedback_mr_create_merge_conventions]].
