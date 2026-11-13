# Reimbursement — what is known

Notes for automating reimbursement from `opentext-central`. Nothing is built yet.

## Wellness reimbursement (the one wanted)

- Filed as a ticket in the OpenText self-service portal, not in Concur.
  Example ticket:
  https://help.opentext.com/portal/site/selfservice?customView=TicketDetails&ticketId=5550992
- Allowance: **300 USD per fiscal year**.
- Evidence is receipt images supplied by the user.
- Not yet explored: the form behind that ticket, its fields, how
  attachments are uploaded, how sign-in to help.opentext.com behaves
  headless, and how to read how much of the 300 USD is already used.

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
