# Upwork

Managing the maintainer's Upwork freelancing: the profile, job search,
proposals and the resume they draw on. Not part of NobleSee.

## Layout

- `skills/` — Claude skills for Upwork tasks (committed).
- `private/` — the resume, proposal drafts, saved searches and anything
  else personal. **Gitignored**: this repository is public, so nothing
  personal is committed. Keep a backup elsewhere; git does not hold it.

## Resumes

`private/resume.md` is the master: every fact, nothing trimmed.
`private/resumes/<focus>.md` are copies tailored to one kind of job — they
reorder and trim the master but never add a fact it lacks, so no two versions
can contradict each other. A correction goes into the master first, then into
each copy.

## Access

The Upwork MCP server connected to Claude Code covers the account:
profile, job search, saved jobs, proposals, offers, contracts, messages
and financials. Prefer it to scraping the site.
