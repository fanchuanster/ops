---
name: book-leaves
description: Book or reschedule leave in OpenText Talent Central (SuccessFactors) with a headless browser
argument-hint: "[type] <start yyyymmdd> [end yyyymmdd] | [days] at year end"
---

# Book Leaves Skill

Books leave through `ot/book_leaves.py`. Request: $ARGUMENTS

Parse it for the leave type (one of: `Vacation` (default), `Floating Holiday`,
`Sickness`, `Bereavement Leave`, `Volunteer Hours`,
`Parental Leave (Non-birth Parent)`, `Family Care Leave`), the start date and
an optional end date, both `yyyymmdd`. The end date defaults to the start date,
which books one day.

**When the leave type is known, before asking for or using any dates**, show
the available and booked days of that type (booked days in the past are left
out) and relay them:

```powershell
python ot\book_leaves.py --type "<type>" --report
```

Then run:

```powershell
python ot\book_leaves.py [--type "<type>"] --start <yyyymmdd> [--end <yyyymmdd>] [--half-day] [--dry-run]
python ot\book_leaves.py [--type "<type>"] --days <days> [--dry-run]
```

The second form, with no dates, books on the last working days of this year.
For Vacation, `--days` is optional: without it, every paid day left is booked.

## Behaviour

- **Before booking**, it prints the available leave: Vacation still not booked
  as of Dec 31, then every balance in the Balance Overview, then the time off
  already booked. **After a submitted booking**, it prints the same report again,
  so you see what is now booked and what remains.
- **A range books only bookable days.** Weekends, Canadian public holidays
  (`holidays.Canada` plus the company holidays listed in Talent Central), days
  in the past and days already booked are skipped. Consecutive days are one
  request, even across a weekend, and a holiday or booked day splits them.
- **Floating Holiday is spent before Vacation.** It is paid leave like
  Vacation but never carries over. Choosing Vacation silently uses Floating
  Holiday days first:
  - At year end, the latest working days go to Floating Holiday and earlier
    days to Vacation. Existing December Vacation/Floating bookings are edited
    onto those dates, changing their Time Type where needed.
  - For a range in the current year, the first whole days are Floating Holiday
    and the rest Vacation.
  - Floating left is the Balance Overview figure, an annual grant, minus this
    year's Floating Holiday bookings.
  - Vacation left is Talent Central's balance as of Dec 31, which counts the
    whole year's accrual.
- **Vacation over quota**: days within the remaining balance are new requests.
  The shortfall is taken from the Vacation already booked in December, outside
  the range. Those bookings are edited onto the new dates, or a longer one is
  shortened. December bookings are placeholders, so moving them is expected.
- **Fails, changing nothing**, when no day in the range is bookable, the form
  rejects a request, or there is no remaining quota and not enough December
  booking to move, or year-end bookings exceed the paid leave left. Cancelling
  is not automated (the Edit form has a Cancel Time Off button). The exit code
  is 1 and the reason is printed.
- Every run first walks all forms without submitting, and submits only if every
  step passed. `--dry-run` stops after that check.

Relay the before and after reports, and what was booked or moved, or the
failure reason. Prefer `--dry-run` first when the request is ambiguous, because
submitting notifies the approver.

## Requirements

- Google Chrome and `pip install -r ot\requirements.txt`.
- Login is single sign-on. The automation profile is `ot\.profile`
  (gitignored); `--headed` shows the browser if sign-in ever needs a person.
- Public holidays are national only. A provincial-only holiday is not blocked
  unless Talent Central lists it.
- `python -m pytest ot` runs the date-planning tests.
