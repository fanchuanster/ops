# Reimbursement — what is known

Wellness is automated by `reimburse_wellness.py` (skill `reimburse-wellness`).

## Wellness reimbursement (Well+Being Fitness)

- A request in the SMAX self-service portal at help.opentext.com, not
  Concur: Ask HR → "Submit Well+Being Fitness Reimbursement Claim",
  `https://help.opentext.com/saw/ess/offeringPage/2267531`. The old
  `portal/site/selfservice?...ticketId=` links now land on the homepage.
- Allowance: **320 a year in local currency (CAD)**. The form shows it
  ("Maximum Annual Reimbursement Amount") and what is left ("Available Amount
  to Claim"), both read-only. At most two submissions per fiscal year,
  Jul 1 to Jun 30.
- Sign-in, headless: Microsoft Entra ID. Type `OT_USERNAME` (an email) and
  Next, or on later runs click it in "Pick an account"; SSO does the rest.
  The session does not survive between runs.
- Required fields: Claim Description (a rich-text editor), Date Membership
  (or Fee) Paid (`MM/DD/YYYY`; typing then Enter leaves a datepicker backdrop
  that must be clicked away), Reimbursement Amount Requested, Expense Type (a
  combobox of five options, matched by prefix), and a receipt through the file
  input. The six declarations are text, not checkboxes.
- There is no draft: the only action is Submit. The automation previews first
  and submits only with `--submit` after a go-ahead. Submit lands on
  `/saw/ess/request-submitted/<request id>`, which reads "Your Request #<id>
  was successfully created". Available Amount to Claim did not drop right
  after a 100 claim, so it presumably updates once the claim is processed —
  count submissions yourself rather than trusting that field.

## Concur (Travel & Expense) — explored, not the wellness route

- Entry: central.opentext.com → Tools & Services → "Concur – Travel &
  Expense" (same tab) → www.concursolutions.com.
- Sign-in, headless, works without a person: reject cookies → type
  `OT_USERNAME` into "Username, verified email address, or SSO code" with
  `press_sequentially` (`fill` is lost when the cookie banner re-renders) →
  Next → "OT Connect" → a "Login Warning" dialog → OK (dismiss it before the
  cookie banner, it intercepts clicks). Lands on `us2.concursolutions.com/home`.
- The session does not survive between runs; sign in every run.
- Claim header: Report Name, Report Date (defaults today), Policy
  (`Internal No VAT`, `Internal VAT`, `PS Engagements VAT`, `P.Card Non VAT`,
  `P.Card VAT`), Cost Center and Database prefilled from the profile.
  "Create Claim" saves a draft immediately.
- In a claim: "Upload receipts" (png/jpg/jpeg/pdf/tif/tiff, Concur reads
  them), "Manually Create Expense" (56 expense types, e.g. Internet (ISP),
  Cellular Phone, Training/Education/Professional Dues, Meals, Taxi), and
  "Available Expenses".
- Delete a draft: "Claim Actions" → "Delete Claim" → confirm "Delete Claim"
  (the other choice is "Do Not Delete").
- Decided: a claim stops at a saved draft for the user to review; the
  automation never submits.
