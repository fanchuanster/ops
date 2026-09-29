---
name: octane-task-comments
description: Octane comments on a TASK need owner_task, not owner_work_item — ids collide across the two spaces so the wrong call silently comments on an unrelated story
metadata:
  type: reference
---

`OctaneClient.add_comment()` always links via `owner_work_item`, which only
addresses work items (story/defect/quality_story). To comment on a **task**,
POST `/comments` with `owner_task` instead:

```python
client.post('/comments', json={'data': [{
    'text': '<html><body><p>...</p></body></html>',
    'owner_task': {'type': 'task', 'id': str(task_id)}}]})
```

**Why this matters:** task ids and work_item ids are separate id spaces that
overlap. Passing a task id to `add_comment` does not reliably fail — if a work
item happens to share that number, the comment lands on that unrelated item and
returns 201. Hit on 2026-08-19: commenting on task 184009 posted onto story
184009 ("Copy projects on backend - for SOC"), a different, already-Done item.
It only surfaced because the next id (184010) had no work_item twin and 404'd.

After commenting on a task, verify with
`GET /comments/{id}?fields=owner_work_item,owner_task` that `owner_task` is set
and `owner_work_item` is None.

See [[octane-story-needs-task]].
