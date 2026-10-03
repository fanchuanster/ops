---
name: feedback-no-unverified-field-values
description: Never hardcode values for BackOffice/external system fields that aren't confirmed AND verified against the system - leave them empty
metadata:
  type: feedback
---

When automating a record in an external system (MSM BackOffice above all), never fill a
field with a value that has not been both confirmed by the owning team **and** verified to
exist in that system. Leave it empty and skip the write instead. This applies even to
values a stakeholder stated in writing: "the product team said the OS is CCoE-AL2023-eks"
is not proof that string is an option in BO's dropdown.

**Why:** a record carrying a knowingly-wrong or unverifiable value is worse than one with
a blank field - the blank is visibly incomplete and gets fixed, the wrong value silently
propagates. Precedent in this repo: LRE `-V` servers registered under
`QC.ALM.Application` by a fallback, invisible in their own farm's attach grid, with builds
reporting green (see `Params.get_server_role` comments in `msm/msm_automation.py`).

**How to apply:** free-text field -> write `""`. Dropdown/enum -> skip the selection and
log a warning naming what is unconfirmed. No mapping entry at all -> raise with a clear
message rather than letting a generic fallback pick something. Do not label a guess a
"placeholder" and ship it. Related: [[reference-octane-task-comments]].
