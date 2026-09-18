---
name: octane
description: Interact with ALM Octane - list tickets, update phases, manage tasks
argument-hint: "[list] | <client_id> <client_secret> | <lwsso_key> | update <id> <phase> | done <task-ids> | show <id>"
---

# Octane Skill

Use the `OctaneClient` from `Aviator/libs/octane.py` to interact with ALM Octane.
Credentials and cookies are stored in `Aviator/libs/.octane.env`.

Default auth is a long-term API key (`OCTANE_CLIENT_ID` / `OCTANE_CLIENT_SECRET` in
`.octane.env`), which signs in directly via `/authentication/sign_in` — no browser/MFA
needed, and it doesn't expire like a session cookie. `client.ensure_session()` handles
this automatically: reuse saved cookies → sign in with the long-term key → only fall
back to interactive browser MFA if the key itself is missing or has been revoked.
`OCTANE_USER` never changes and does not need to be refreshed.

If the user provides a new client_id/client_secret pair (e.g. after rotating the key),
or a browser `LWSSO_COOKIE_KEY` (only needed if the long-term key stops working), persist
it per the Credential Refresh section below, then proceed with the request.

Request: $ARGUMENTS

If the request above is empty, the action is **list** — run "List my work items" below
and display the table, exactly as if the user had typed `/octane list`.

## Credential Refresh

### New long-term key (client_id + client_secret)

If $ARGUMENTS contains something like "Client ID: ..." / "Client secret: ..." (in either
order, any casing/spacing), or looks like two bare tokens, extract and persist both to
`.octane.env`, then verify it actually works before reporting success:

Always write through `set_env_keys` below rather than a one-off `re.sub`/list-filter —
it dedupes by key (last value wins) on every write, so any pre-existing duplicate in the
file gets collapsed as a side effect instead of silently persisting.

```python
import re, pathlib, sys

def set_env_keys(updates: dict, env_path=pathlib.Path('Aviator/libs/.octane.env')):
    """Set/replace KEY=VALUE pairs in .octane.env, deduping any existing duplicate
    keys in the file (last occurrence wins) so writes never accumulate stale copies."""
    order, values = [], {}
    for line in env_path.read_text().splitlines():
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        if key not in values:
            order.append(key)
        values[key] = value  # last occurrence wins
    for key, value in updates.items():
        if key not in values:
            order.append(key)
        values[key] = value
    env_path.write_text("\n".join(f"{k}={values[k]}" for k in order) + "\n")

args = """$ARGUMENTS"""
id_m = re.search(r'client[ _-]?id\s*[:=]\s*(\S+)', args, re.IGNORECASE)
secret_m = re.search(r'client[ _-]?secret\s*[:=]\s*(\S+)', args, re.IGNORECASE)

if id_m and secret_m:
    client_id, client_secret = id_m.group(1), secret_m.group(1)
    set_env_keys({'OCTANE_CLIENT_ID': client_id, 'OCTANE_CLIENT_SECRET': client_secret})

    sys.path.insert(0, 'Aviator/libs')
    from octane import OctaneClient
    client = OctaneClient()
    client.authenticate_client_credentials()
    print("Verified and saved new long-term key." if client.test_connection() else "ERROR: saved key but test_connection failed")
```

### Browser cookie (only if the long-term key itself is revoked)

If $ARGUMENTS looks like a cookie value (long alphanumeric string, possibly with `LWSSO_COOKIE_KEY=` prefix), update `.octane.env` immediately:

```python
import re, pathlib

def set_env_keys(updates: dict, env_path=pathlib.Path('Aviator/libs/.octane.env')):
    """Set/replace KEY=VALUE pairs in .octane.env, deduping any existing duplicate
    keys in the file (last occurrence wins) so writes never accumulate stale copies."""
    order, values = [], {}
    for line in env_path.read_text().splitlines():
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        if key not in values:
            order.append(key)
        values[key] = value  # last occurrence wins
    for key, value in updates.items():
        if key not in values:
            order.append(key)
        values[key] = value
    env_path.write_text("\n".join(f"{k}={values[k]}" for k in order) + "\n")

args = """$ARGUMENTS""".strip()

# The cookie is passed as the *only* argument, so take the whole trimmed string
# rather than whitelisting characters — a character class silently truncates any
# legit cookie char it omits (e.g. a trailing "." was chopped off, causing 401s).
new_lwsso = re.sub(r'^LWSSO_COOKIE_KEY=', '', args).strip()

if len(new_lwsso) >= 20:
    set_env_keys({'OCTANE_COOKIE_LWSSO_COOKIE_KEY': new_lwsso})
    print("Updated .octane.env with new LWSSO_COOKIE_KEY")
```

## Setup (always run first)

`OctaneClient` handles the pyOpenSSL/cryptography import-crash workaround, `.octane.env`
config loading, and TLS/timeout settings internally — no manual setup needed beyond this:

```python
import sys
sys.path.insert(0, 'Aviator/libs')
from octane import OctaneClient

client = OctaneClient()
client.ensure_session()
if not client.test_connection():
    print("ERROR: session invalid and no working credentials — provide a fresh client_id/client_secret, "
          "or as a last resort an LWSSO_COOKIE_KEY from browser DevTools → Application → Cookies on internal.almoctane.com")
    raise SystemExit(1)
```

## Operations

Prefer the `OctaneClient` methods below over raw `client.get/post/put/delete` calls —
they encode the API's non-obvious requirements (data-array wrapper on create, release-before-sprint,
task description-required-on-every-PUT, etc.) so you don't have to re-derive them each time.

### List my work items
```python
items = client.list_my_items(
    fields='id,name,phase,owner,creation_time,sprint,release,estimated_hours,invested_hours')
# items is a list of work_items, each with .tasks[] attached
```
Display as a table: ID | Name | Phase | Sprint | # Tasks (pending/total) | Est h | Inv h.
`estimated_hours`/`invested_hours` are read-only rollups from the item's tasks (see API quirks
below) so they must be requested explicitly via `fields`, same as above; they're absent from
`list_my_items`'s own default `fields` string. Append a totals row summing Est h and Inv h
across the displayed (non-Done/Closed, unless the user asked for all) items.
`item['sprint']` is a dict (`{'name': ..., 'start_date': ..., 'end_date': ...}`) or `None` if
unassigned — show `item['sprint']['name']` or `-`. The `/work_items` list endpoint does **not**
return `sprint` (see the quirk below), so `list_my_items` re-reads it from each item's subtype
endpoint whenever `sprint` is in `fields`. Don't drop `sprint` from `fields` and expect it back.
Only show items that are not Done/Closed unless the user asks for all.

### Show item detail
```python
resp = client.get(f'/work_items/{id}', params={'fields': 'id,name,phase,description,sprint,release'})
```
Note: the generic `/work_items` endpoints silently omit `sprint` even when it's set — both
`/work_items/{id}` and the `/work_items` list. Use the subtype endpoint instead
(`/stories/{id}`, `/quality_stories/{id}`, etc.) to read it reliably.

### Close subtasks (required before moving a parent to In Testing or Done)

Before transitioning a story/defect's phase to **In Testing** or **Done** (and any phase at or
past those, e.g. JobDocumentation), every one of its subtasks must already be `phase.task.completed`
with `remaining_hours = 0` and `invested_hours` equal to (not less than) `estimated_hours` — a task
can't be "done" while it still shows open hours. Fetch `estimated_hours,invested_hours,remaining_hours`
along with the usual fields so you can compare before writing:
```python
tasks = client.list_tasks_for_stories(
    [id], fields='id,name,phase,owner,estimated_hours,invested_hours,remaining_hours')
for task in tasks.get(id, []):
    estimated = task.get('estimated_hours') or 0
    needs_update = (task['phase']['id'] != 'phase.task.completed'
                     or (task.get('remaining_hours') or 0) != 0
                     or (task.get('invested_hours') or 0) < estimated)
    if needs_update:
        client.update_phase('tasks', task['id'], 'phase.task.completed', extra_fields={
            'description': client.get(f"/tasks/{task['id']}", params={'fields': 'description'})
                .json().get('description') or 'Task.',
            'remaining_hours': 0,
            'invested_hours': estimated,
        })
```
Do this before every "move to In Testing" and "mark/close as Done" request, not just when the
user explicitly mentions hours — a parent should never advance to those phases while a subtask
still carries remaining hours or is short of its estimate.

Additionally, before transitioning a story to **Done** specifically, the story must have at
least 1 subtask — a story with zero tasks has no effort tracked against it and should not be
closed. If `tasks.get(id, [])` is empty, stop and tell the user rather than closing it; don't
silently create a placeholder task on their behalf. (In Testing has no such requirement — a
story can enter In Testing with zero tasks, same as today.)

### Update phase (story/defect/quality_story/task/...)
```python
client.update_phase('work_items', id, '<phase_id>')          # story or defect
client.update_phase('quality_stories', id, '<phase_id>')     # quality story
client.update_phase('tasks', tid, '<phase_id>',               # tasks need description every time
    extra_fields={'description': client.get(f'/tasks/{tid}', params={'fields': 'description'}).json().get('description') or 'Task.'})
```
Check `client.list_phases(entity_name)` before assuming a phase exists — e.g. quality_story
only has New/In Progress/Done, no Fixed/In Testing (those are Defect/Story-only).

### Create a Quality Story
```python
new_id = client.create_quality_story(
    name='<title>',
    description='<html><body><p>...</p></body></html>',
)  # owner defaults to OCTANE_OWNER_ID from .octane.env
```

### Create a (regular Agile) Story
Unlike a Quality Story, a regular User Story **requires a parent Feature** — creating one
without a `parent` link 409s with `platform.required_field_missing` ("Missing required
field 'Feature' ('parent')"). `create_story()` has no param for this, so call
`_create_backlog_item` directly and pass `parent` via `extra_fields`, and pass
`phase_id='phase.story.new'` explicitly — `_create_backlog_item`'s own default is `""`
(not "phase.story.new"), which 409s with `platform.phase_does_not_exist_error` if left off:
```python
features = client.get('/features', params={'fields': 'id,name,phase', 'order_by': '-creation_time', 'limit': 30}).json()['data']
# ask the user which feature fits if none is an obvious match

story_id = client._create_backlog_item(
    'stories', name, description,
    phase_id='phase.story.new',
    extra_fields={'parent': {'type': 'feature', 'id': feature_id}},
)
task_id = client.create_task(story_id, name, description=description, story_subtype='story')
client.put(f'/tasks/{task_id}', json={'estimated_hours': 16, 'description': description})  # note: json=, not positional
```
Also ask the user for the Topic (`client.list_topics('story')`) up front — see `create_story`'s
own `topic_id` docstring — and pass it as `extra_fields['topic_udf'] = {'type': 'list_node', 'id': topic_id}`
alongside `parent` in the same call.

### Follow every item you create (so the user gets notified)

Octane drives "My Work" and its notifications off a separate `user_item` entity, one per
(user, followed entity) pair. Creating an item with `owner` = `OCTANE_OWNER_ID` makes
Octane create that record itself, in the same instant, with `reason: "owner"` — verified
across the user's items, where the `user_item`'s `creation_time` matches the item's to the
second. Both `_create_backlog_item` (so `create_quality_story`/`create_story`) and
`create_task` already default `owner_id` to `OCTANE_OWNER_ID`, so the default path is
followed automatically.

**So: never pass `owner_id=` for someone else on a create unless the user explicitly asked
for it.** There is no API fallback — `POST /user_items` is refused at the resource level
(403 `platform.web_application`, "Access to .../user_items resource POST method has been
denied"), so an item owned by someone else cannot be followed from here at all. If the user
does want it owned by a teammate, create it, say plainly that they will not get
notifications on it, and give them the item so they can press **Follow** in the UI.

After creating anything (story, quality story, defect, task), confirm the follow record
actually landed rather than assuming it:

```python
def assert_followed(item_id, kind='work_item'):
    """kind: 'work_item' for story/quality_story/defect/feature, 'task' for a task."""
    link = 'my_follow_items_task' if kind == 'task' else 'my_follow_items_work_item'
    items = client.get('/user_items', params={
        'fields': f'id,entity_type,reason,user,{link}', 'limit': 1000}).json()['data']
    return any((u.get('user') or {}).get('id') == client.owner_id
               and (u.get(link) or {}).get('id') == str(item_id) for u in items)

if not assert_followed(story_id):
    print(f"WARNING: {story_id} created but not followed - no notifications will be sent")
```

`/user_items` has no usable server-side filter on the link fields, so read the (small,
workspace-wide) list and match client-side, as above.

Note for anyone reading follow state later: **closing an item deletes its follow record.**
Of the user's 345 owned work items, only the 15 in New/In Progress/In Testing had one; all
330 in Done/Closed/WNBI/Rejected had none. A missing `user_item` on a closed item is normal
and is not something to repair.

### Assign to a sprint
```python
sprint = client.find_current_sprint()  # or client.list_sprints() to pick one manually
client.assign_sprint('quality_stories', id, sprint['id'])  # auto-resolves & sets the parent release too
```

### Add a comment
```python
comment_id = client.add_comment(item_id, '<html><body><p>...</p></body></html>')
```

### Add an attachment (e.g. a screenshot)
```python
att_id = client.add_attachment(item_id, 'screenshot.png', file_bytes, 'image/png')
```

### API quirks worth remembering
- `sprint` is **filterable but not selectable** on `/work_items`: `query="sprint={name='Sprint 4'}"`
  filters correctly, but `fields=...,sprint` is silently dropped from the response rather than
  erroring — every item comes back `sprint: None`, which looks exactly like "no sprint assigned".
  Read it from the subtype endpoint (`/stories`, `/quality_stories`, `/defects`, ...), which is what
  `OctaneClient._backfill_sprints` does. `release` is unaffected and comes back from both.
- `estimated_hours`/`invested_hours` on a story/defect (backlog item) are **read-only rollups**
  computed from its tasks — a direct `PUT` on the story with `estimated_hours` 403s
  (`platform.modify_non_editable_field`). To set effort at the story level, create a task under
  it via `create_task` and set `estimated_hours`/`invested_hours` on the task instead; the
  parent's rollup updates automatically. Tasks themselves *do* accept a direct `estimated_hours`
  PUT (see "Create a Quality Story"/`create_task` — the hours have to be set in a follow-up PUT
  since `create_task` doesn't take an hours param).
- Creating anything (`create_entity`, used by `create_quality_story`/`add_comment`) requires
  the payload wrapped in a `data` array — a bare object 400s.
- Attachments are multipart, not JSON — the metadata part must be named `entity` (not
  `entities`) and the file part `content` (not `file`); anything else 400s. See `add_attachment`.
- For `story`, closing to `phase.story.done` is NOT a single hop — Octane enforces a strict
  linear workflow and rejects any jump that skips a step (`platform.phase_does_not_exist_error`,
  e.g. `"'In Testing' phase cannot be changed to 'Done'"`). The real sequence, confirmed
  empirically, is:
  `New(100) → In Progress(300) → In Testing(400) → JobDocumentation(500) → Done(800)`.
  `JobDocumentation` is a custom phase (`id`/`logical_name` `8yemv6d0oe9l9i09x9xz2gqj2`) that
  does **not** appear in a plain `/phases` list scoped to "story" logical names — you have to
  search all phases (`client.list_phases()` with no filter, or `/phases` unfiltered) and match
  by `name` to find it. To close a story sitting in In Testing:
  ```python
  JOBDOC = "8yemv6d0oe9l9i09x9xz2gqj2"
  client.update_phase('work_items', id, JOBDOC)              # In Testing -> JobDocumentation
  client.update_phase('work_items', id, 'phase.story.done')   # JobDocumentation -> Done
  ```
  There is also a custom phase **"WNBI"** (`j6qkv788dkdnmc1zpgk3n5g14`, index 700) — this is
  a **side branch, not a stepping-stone to Done**: In Testing → WNBI is accepted, but WNBI does
  not transition onward to Done, and does not transition back to In Testing either (both were
  tested and rejected) — treat any move into WNBI as effectively one-way. The only way out of
  WNBI observed to work is back to **In Progress** (`phase.story.inprogress`), from which the
  normal path resumes: In Progress → In Testing → JobDocumentation → Done. If an item ever
  ends up in WNBI unintentionally, recover it with:
  ```python
  for step in ["phase.story.inprogress", "phase.story.intesting", JOBDOC, "phase.story.done"]:
      client.update_phase('work_items', id, step)
  ```
  Do not guess at other phase jumps for a story stuck in an unexpected phase — moves can be
  one-way, so verify each hop's phase.get() result before trying the next one.
- `client.get()`'s `query` param must be one string with the whole expression wrapped in outer
  double quotes, e.g. `'"owner={email=\'x@y.com\'}"'` (see `list_my_items()` for the pattern).
- "My Work" grid visibility is **not** simply phase-based or sprint-based — tested empirically
  (a Done quality_story with the same phase+sprint as a visible Done story still didn't show).
  Root cause unconfirmed; don't assume Done items are filtered by default, and don't guess a
  mechanism without re-verifying.

## Phase IDs

| Entity  | Phase         | ID                          |
|---------|---------------|-----------------------------|
| Story   | New           | `phase.story.new`           |
| Story   | In Progress   | `phase.story.inprogress`    |
| Story   | In Testing    | `phase.story.intesting`     |
| Story   | Done          | `phase.story.done`          |
| Task    | New           | `phase.task.new`            |
| Task    | In Progress   | `phase.task.inprogress`     |
| Task    | Completed     | `phase.task.completed`      |
| Defect  | Opened        | `phase.defect.opened`       |
| Defect  | Fixed         | `phase.defect.fixed`        |
| Defect  | Closed        | `phase.defect.closed`       |

## Interpreting requests

- no arguments at all / "list" / "list my tickets" / "show my work" → list active items
  (not Done/Closed). An empty request is always a list, never a prompt for what to do.
- "create a story/defect/quality story/task" → create it with the default owner so Octane
  follows it for the user, then confirm the follow record landed (see "Follow every item you
  create" above) and report the new id together with whether it is followed
- "mark all subtasks done on <story>" → update all tasks of that story to `phase.task.completed`
  with `remaining_hours=0` and `invested_hours=estimated_hours` (see "Close subtasks" above)
- "move <story> to in testing" → run "Close subtasks" above for `id` first, then update story
  phase to `phase.story.intesting`. Never advance a parent into In Testing while a subtask still
  carries remaining hours or is short of its estimate.
- "mark ticket <id> done" / "close ticket <id>" → run "Close subtasks" above for `id` first
  (never close a parent while it still has open tasks or unspent estimated hours), then update
  the item's phase to its Done/Closed equivalent (quality_story → `phase.quality_story.done`,
  story/defect → see Phase IDs table). For a story specifically, first confirm it has at least
  1 subtask (see "Close subtasks" above) — if it has none, stop and ask the user instead of
  closing it or fabricating a task.

When updating multiple items, run them in a loop and report each result.
