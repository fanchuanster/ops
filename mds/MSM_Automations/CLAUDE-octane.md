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
