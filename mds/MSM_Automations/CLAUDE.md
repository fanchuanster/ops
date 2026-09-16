# Sub repos

- `Aviator/` (`git@hmf.gitlab.otxlab.net:csd/adm/Aviator.git`) — AI-driven operations
  tools: `auto_remediation/` (alert orchestrator + dashboard), `ut_advisor/` (UT ticket
  solution suggestion and escalation evaluation), `questionnaire/` (AI-powered
  questionnaire autofill), `libs/` (shared utilities).
- `jenkins-infra/` — Jenkins container definitions: `alm_jenkins` and `aviator-agent`
  (slave).

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

# Git Commits — Octane Traceability

Put the Octane item's ID in the commit message when the commit is that item's work. A
nice-to-have, never a gate.

- Format: bare numeric ID, colon, subject —
  `486007: Register LRE VTS servers with the new PC VTS role`.
- Reference the **first-level** item (user story, defect, quality story). Use a
  **subtask** ID only when the commit is scoped to that subtask and the parent would
  mislead.
- One commit spanning two items gets both, comma-separated: `485005, 487002: ...`.
- Pick the item silently when the match is confident — don't stop to ask. With no
  confident match (repo chores, tooling, docs cleanup, drive-by fixes, unclear owner),
  omit the ID and commit anyway. An absent ID is fine; a guessed one is not.
- The ID is the only addition — global commit rules still apply (no AI attribution, no
  generated-by footers, message describes the actual change).

# Merge Requests

- Never end a response by reminding the user to open a merge request, or by offering the
  GitLab "create MR" link.
- After a push, report what was pushed and stop. Open an MR only when asked.

# Octane Updates — What Goes Where

When work on an item (or a meaningful chunk of it) is finished, record it on the item.
Story and subtasks get **different content for different readers** — don't write the
same text twice.

- **User story → summary, for the reader who runs the thing**, not who maintains it:
  what is different for them now, what used to go wrong, what they no longer do by hand.
  Expand jargon on first use ("a CIFS share, the `\\server\sharename` path a Windows
  machine maps as a drive"). Name what is **not** covered and what must still happen
  before closing. No file paths, function names or branch names.
- **Subtask → the technical detail**: root cause, files and branches touched, why the
  previous behaviour was wrong, any deliberate deviation from the obvious approach and
  its reason, what was verified and how, open technical questions. This is the record
  for whoever next touches the code.
- Scope each subtask's comment to that subtask. Shared background may repeat across two
  — better repeated than missing when someone opens only one.
- **Be as concise as possible.** A comment is a record, not a report: say it once, in as
  few words as it takes, and stop. A few short paragraphs or bullets. No preamble, no
  restating the requirement, no summary of the comment itself, no "as discussed" or "in
  order to". Concision cuts words, not the reader's perspective from the story or the
  root cause from the subtask.

Mechanics:

- **Add a comment; never overwrite the description** — it holds the original requirement.
- A **story/defect/quality story** takes `client.add_comment(id, html)` (links via
  `owner_work_item`). A **task** does not — POST `/comments` with `owner_task`:
  ```python
  client.post('/comments', json={'data': [{
      'text': '<html><body><p>...</p></body></html>',
      'owner_task': {'type': 'task', 'id': str(task_id)}}]})
  ```
- Task ids and work-item ids are **separate id spaces that overlap**, so passing a task
  id to `add_comment` does not reliably fail — if a work item shares that number the
  comment silently lands on it and returns 201. Always read back
  `GET /comments/{id}?fields=owner_work_item,owner_task` and confirm it attached to what
  you meant.
- Comment bodies are HTML (`<html><body>...</body></html>`).

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

# Dev environment

- Source is cloned to the Kiosk server **ALMKIOSK-01**, which also serves
  `auto_remediation`, the dashboard, PostgreSQL and ChromaDB.
- Jenkins server `almprodjenkins.saas.microfocus.com` (internal `10.211.36.170`),
  reached as `ssh jenkins`. It hosts the `alm_jenkins` master container and the
  `aviator-agent` container (label `aviator` in groovy); `docker exec` into either.
  ```bash
  ssh jenkins
  docker exec -it alm_jenkins bash
  ```
- Inside `alm_jenkins`, `kubectl` has pre-configured kubeconfigs under `~/.kube/`. Use
  `$HOME/.kube/...`, **not** `~/.kube/...` — tilde is not expanded after
  `--kubeconfig=`.
  - `$HOME/.kube/fra-config` — ALM fra cluster (`alm-eks-eu-central-1`, `k8s/tf/infra`)
  - `$HOME/.kube/adm-devops-fra-kubeconfig` — ADM DevOps fra cluster
    (`adm-devops-eks-eu-central-1`, `k8s/tf/adm-devops-k8s-cluster`)
  - e.g. `kubectl --kubeconfig=$HOME/.kube/fra-config get nodes`
- ALM servers from `alm_jenkins`: user `ec2-user` or `ubuntu`, key
  `~/.ssh/Infra-ALM-key.pem`.

# GitLab access

- Instance `hmf.gitlab.otxlab.net` (e.g. `git@hmf.gitlab.otxlab.net:csd/adm/Aviator.git`).
- `GITLAB_TOKEN` is already set in the shell — pass it as a `PRIVATE-TOKEN` header:
  ```bash
  curl -s --header "PRIVATE-TOKEN: $GITLAB_TOKEN" "https://hmf.gitlab.otxlab.net/api/v4/<endpoint>"
  ```
- Never print `$GITLAB_TOKEN` to output or logs — pass it straight into the header.

# ALM Farm SA Schema Naming (EC2 and EKS farms)

Every ALM farm's Oracle schema alternates between two slots, `{FARM}_SA` and
`{FARM}_SA_CPY`. The convention and the `upgrade/upgrade.py` module implementing it are
shared — identical for EC2-based and EKS-based (`k8s/`) farms.

- Only one slot is active at a time. Which one is tracked by the farm's `sa` field in
  MSM backoffice, **not** by the name: `_SA` active is not a default state, and `_SA_CPY`
  can be (and often is) the active one.
- An upgrade (`copyAndUpgrade`) copies the active slot's data into the *other* slot at
  the new version, cuts the farm over, then drops the old slot — so the active name
  flips between `_SA` and `_SA_CPY` across successive upgrades.
- `Upgrade.get_upgrade_type_from_versions` compares **only the major version** parsed
  from each side's `admin_version`. A target major lower than the active schema's is
  `NONE`/`ABORT` (downgrade guard), whatever Jenkins action triggered it. This surprises
  you when the target string doesn't look older — an `admin_version` major of 19 vs 20
  is not obvious from a display string like "25.1 Patch 2".
- The Jenkins `K8s` job's `Deploy_Force` action, on that ABORT case, raw
  drop-and-recreates **only** the currently-active (backoffice `sa`-registered) slot; it
  never touches the other.

# Changing Shared Infrastructure — Hard-Won Rules

From the 2026-09-04 Oregon incident: `sts`/`ec2`/`ecr` interface endpoints created by
hand in the shared `ALM_app` VPC (`vpc-53708f34`) to give EKS nodes a private path they
already had. Their VPC-wide private DNS pointed every host — the `lreorgprdpdb*` DB
servers included — at ENIs no SG let them reach, breaking AWS CLI cronjobs for a day.

1. **Verify the assumption, especially in a hurry.** Measure the limitation from the
   host that has it before building around it — one `curl` from a node would have shown
   public STS answering. "It can't reach X" and "my change can't have caused this" are
   both hypotheses until a command proves them. CloudTrail `lookup-events` answers who
   changed what; its `userAgent` separates terraform from a hand-run `aws-cli`.
2. **Scope the blast radius first.** `ALM_app` holds farm servers, LRE Controllers and
   DB servers. `PrivateDnsEnabled` is a VPC-wide DNS takeover, not a workload setting;
   an endpoint SG must admit the VPC CIDRs (`10.210.8.0/22`, `10.210.12.0/23`,
   `10.210.32.0/21`, `10.208.26.128/25`), never a workload SG.
3. **Nothing enters AWS except through terraform.** CLI-created resources sit in no
   state, no grep, no MR. Use the CLI to read, or to undo what a `grep` of the state in
   `s3://qc-installation/tfvars/` proves is unmanaged.
