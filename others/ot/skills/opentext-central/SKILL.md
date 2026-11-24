---
name: opentext-central
description: Entry point for automations against OpenText company portals (Central, Talent Central); asks what to do and routes to the matching skill
argument-hint: "[what you want to do]"
---

# OpenText Central Skill

Request: $ARGUMENTS

## Actions

| Action | Status | Skill |
|---|---|---|
| Book leave | available | `book-leaves` |
| Reimbursement | available: wellness (Well+Being Fitness) only; also checks claim status (`--status`) | `reimburse-wellness` |

## Behaviour

1. If the request clearly names an available action, go straight to it and
   pass the rest of the request along as that skill's arguments.
2. Otherwise ask the user with the `ask_user` tool, offering every available
   action as a choice, with a short line on what it does.
3. If the user asks for an action marked coming soon or one not listed, say it
   is not automated yet and offer the available actions instead.
4. Once an action is chosen, invoke its skill and follow its instructions,
   collecting any inputs it needs with `ask_user` when they were not given.
   For Book leave, ask for the leave type first, then run
   `python others\ot\book_leaves.py --type "<type>" --report` and show its available
   and booked days before asking for the start date `yyyymmdd`, optional end
   date, half day and dry run.
   For Reimbursement, ask for the reimbursement type (only Wellness for now),
   then follow `reimburse-wellness`: show the allowance, then ask for the
   receipt images.

## Adding an action

Build the action as its own skill under `others\ot\skills\`, with its script under
`others\ot\`, then add a row to the table above. This skill only routes; it holds no
automation itself.
