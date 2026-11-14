---
name: reimburse-wellness
description: Claim the OpenText Well+Being Fitness reimbursement on help.opentext.com from receipt images, previewing before submitting
argument-hint: "[receipt image paths]"
---

# Reimburse Wellness Skill

Files a Well+Being Fitness Reimbursement claim through
`others/ot/reimburse_wellness.py`. Request: $ARGUMENTS

## Flow

1. Show the allowance first and relay it:

   ```powershell
   python others\ot\reimburse_wellness.py --report
   ```

2. Ask for the receipt images if none were given. Each must be a file on
   disk, because the script uploads it. If an image was pasted without a path,
   ask the user to save it and give the path.
3. **Read the receipts yourself** for the date paid, the amount and what was
   paid for. Pick the expense type from what was paid for, and write a short
   description, e.g. "Gym membership, Oct 2026 - GoodLife Fitness". Several
   receipts in one claim: sum the amounts, use the latest payment date, and
   list each in the description. If a value cannot be read, ask the user for
   it rather than guessing.
4. Fill the form and preview it. This never submits:

   ```powershell
   python others\ot\reimburse_wellness.py --paid <yyyymmdd> --amount <amount> --type "<type>" --description "<text>" --receipt <path> [--receipt <path>]
   ```

   Show the user the logged fields and both preview screenshots,
   `tmp\ot_wellness_preview_1.png` and `tmp\ot_wellness_preview_2.png`.
5. **Submit only after the user says go**, by re-running the same command with
   `--submit`. Claims are limited to two per fiscal year, so unlike leave
   booking this always waits for a go-ahead. Relay the request URL and
   `tmp\ot_wellness_submitted.png`, then run `--report` again to show what is
   left.

Expense types: `Fitness Activities` (default; gym, yoga, online cardio),
`Weight Loss Programs`, `Individual & Team Sports`, `Other Programs`
(meditation, personal training, nutrition counselling, race fees),
`Fitness Wearable Technology`.

## Behaviour

- Allowance is 320 a year in local currency (CAD), and the fiscal year runs
  Jul 1 to Jun 30. "Available to claim" is read from the form.
- Fails without submitting, exit code 1, when the amount exceeds what is
  available, the payment date is in the future, or the form rejects a field.
- Sign-in is Microsoft single sign-on with `OT_USERNAME`; no password or
  person is needed. `--headed` shows the browser if that ever changes.
- `python -m pytest ot` runs the claim-rule tests.
