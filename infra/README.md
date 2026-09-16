# NobleSee infrastructure

Terraform for the Cloudflare resources the site runs on: the R2 artifact
bucket, the D1 database, DNS, and the Worker's attachment to the domain.

## What Terraform does and does not own

Terraform owns **infrastructure**. It does not own the **Worker script** —
that is built by OpenNext and shipped by `wrangler`.

The split is deliberate. Putting the compiled bundle in
`cloudflare_workers_script` would make every `wrangler deploy` show up as
drift on the next `terraform plan`, with Terraform trying to roll the code
back to whatever it last saw. Splitting on the code/infra line stops the two
tools fighting over one resource.

## Required token permissions

NobleSee keeps a **single** Cloudflare token: `CLOUDFLARE_API_TOKEN` in `.env`,
which is the name the provider reads. `infra/tf` loads it for you. The token is
never a Terraform variable, so it stays out of `.tfvars` and out of state.

The token needs:

| Scope   | Permission          | Used for                                 |
| ------- | ------------------- | ---------------------------------------- |
| Account | Workers R2 Storage — Edit | the artifact bucket, CORS, lifecycle |
| Account | D1 — Edit           | the application database                 |
| Account | Workers Scripts — Edit | `wrangler deploy`, custom domain       |
| Zone    | DNS — Edit          | the `www` record                         |
| Zone    | Single Redirect — Edit | the www→apex redirect ruleset            |

Editing a Cloudflare token **replaces** its permission list rather than adding
to it, so granting one permission can silently revoke another. Set all five in
a single edit.

**D1 only appears if the token is scoped to one specific account.** With
*Account Resources* set to "All accounts", the permission dropdown does not
offer D1 at all — it is not hidden behind a search term or a plan, it is simply
absent from the list. Scope the token to the single NobleSee account and it
appears. This cost an afternoon: the failure looks like a missing permission
that cannot be granted, when it is really a scope that suppresses the option.

Verify a token with:

```bash
./infra/check-token
```

It probes every API this configuration uses and names the dashboard permission
to grant for each failure. Terraform, by contrast, surfaces a missing
permission as a mid-apply failure on whichever resource happened to touch it
first, which says nothing useful about what to fix.

<details>
<summary>Equivalent by hand</summary>

```bash
set -a; . ./.env; set +a
ACC=<account-id>; ZONE=<zone-id>
for p in "accounts/$ACC/r2/buckets" "accounts/$ACC/d1/database" \
         "accounts/$ACC/workers/scripts" "zones/$ZONE/rulesets" \
         "zones/$ZONE/dns_records"; do
  printf '%-40s %s\n' "$p" \
    "$(curl -s -o /dev/null -w '%{http_code}' \
        -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
        "https://api.cloudflare.com/client/v4/$p")"
done
```

</details>

`200` is fine; `401`/`403` means that permission is missing. A token short of
one of these fails partway through an apply, leaving some resources created and
others not — Terraform recovers cleanly on the next run, but it is quicker to
check first.

## Usage

```bash
cp terraform.tfvars.example terraform.tfvars   # fill in account_id, zone_id
# CLOUDFLARE_API_TOKEN in .env, scoped as above

./tf init
./tf plan
./tf apply
```

`infra/tf` is a thin wrapper around `terraform` — same subcommands and flags.
It loads `.env` and fails with a usable message when the token is missing;
the provider's own error in that case is an unexplained authentication
failure. Bare `terraform -chdir=infra` works too if you export the token
yourself.

### Ordering: the Worker must exist before the domain attaches to it

A custom domain cannot point at a Worker that has not been deployed, so the
first run is three steps:

```bash
./infra/tf apply                                 # 1. bucket, D1, DNS
cd apps/web && npx wrangler deploy               # 2. the Worker itself
./infra/tf apply -var worker_deployed=true       # 3. attach the domain
```

Set `worker_deployed = true` in `terraform.tfvars` afterwards; it is only
false for the initial bootstrap.

Wire the Worker's bindings from Terraform rather than by hand:

```bash
./infra/tf output -json wrangler_bindings
```

## Decisions worth knowing

**D1, not Hyperdrive.** Hyperdrive is a connection *pooler* — it still needs a
PostgreSQL server reachable from the public internet, which would mean adding a
database vendor alongside Cloudflare. That is the opposite of what
"Cloudflare-native" is for. D1 is Cloudflare's own database and Payload has a
SQLite adapter. The cost, paid once: the schema migrations were written for
PostgreSQL and have to be regenerated for SQLite.

**The bucket is private, and stays that way.** There is no public-access
resource in `r2.tf` on purpose. Every artifact is reached through a short-lived
signed URL or streamed by the Worker after a server-side authorization
decision. A public bucket would defeat the rights, staged-release and
download-limit rules in one step.

**CORS is scoped to the site's origin, not `*`.** These objects are
access-controlled; a wildcard would let any page on the internet read a signed
URL's response if it ever obtained one.

**Lifecycle rules sweep `conversion/` only.** Anything under `books/` is the
product of OCR, proofreading and human review — the expensive part of this
project — and must never be aged out by a storage rule.

**Read replication is disabled on D1.** Payload reads and writes on the same
request path (sessions, the download ledger). An eventually-consistent replica
would let a reader's own download briefly vanish from their history and, worse,
let the download limit under-count.

## State

In R2, at `s3://noblesee/tf/terraform.tfstate` — see `backend.tf`. R2 speaks
the S3 API, so the stock `s3` backend drives it with the AWS-specific checks
turned off; `skip_s3_checksum` is the one you cannot omit, since Terraform
otherwise sends integrity headers R2 rejects with an opaque 400.

Locking is native (`use_lockfile`), via a conditional PUT of
`tf/terraform.tfstate.tflock`. There is no DynamoDB equivalent to arrange.

`backend.tf` is a **partial** configuration: the endpoint embeds the Cloudflare
account id and the keys are secrets, so `infra/tf` exports all three from the
repo's `.env` as `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` and
`AWS_ENDPOINT_URL_S3`. Bare `terraform` without those will fail to initialise
rather than quietly fall back to a local file.

State has held secret material — the Document AI service account key among
it, until that key was destroyed on 2026-08-19 — so any local remnant
(`terraform.tfstate.backup`) stays git-ignored.

One hazard worth knowing: the state bucket is the artifacts bucket, which this
same configuration manages. `terraform destroy` would therefore delete the
bucket holding the state describing what it is deleting. Remove resources
individually rather than destroying wholesale.

## Known drift

The apex `noblesee.com` record still points at the retired Cloudflare Tunnel
and is **not** managed here. `cloudflare_workers_custom_domain` creates and
owns that record, so it will be replaced at step 3 above. Until then the apex
resolves to a tunnel with nothing behind it.


## OCR — no longer here

Nothing in this configuration touches OCR any more. Phase 1 runs on
**Adobe PDF Services**, whose Export PDF operation OCRs a scan and
returns a DOCX master in one call — see CLAUDE.md section 8.

Adobe is not provisioned as infrastructure and never appears here. It has
no resources to create: the Worker holds `ADOBE_CLIENT_ID` and
`ADOBE_CLIENT_SECRET` as secrets, both issued by hand from the Adobe
Developer Console, and there is nothing for Terraform to own.

### What was decommissioned

Google Document AI drove phase 1 from 2026-08-14 to 2026-08-19. On
2026-08-19 all ten of its resources were destroyed: the `OCR_PROCESSOR`,
the batch scratch bucket, the converter service account and its key, the
Document AI service agent, and four IAM bindings. `documentai.tf`,
`documentai-outputs.tf`, the `google`/`google-beta` providers and the
`infra/gc` gcloud wrapper went with them; the files are in git history.

The two APIs it enabled — `documentai.googleapis.com` and
`storage.googleapis.com` on project `gen-lang-client-0021728111` — are
still enabled. `disable_on_destroy = false` was set deliberately so that
turning an API off would be a separate decision rather than a side effect
of a destroy. Neither costs anything while unused.

Two loose ends outside Terraform's reach:

- The Worker still carries a `GOOGLE_SERVICE_ACCOUNT_KEY` secret. The key
  it holds was deleted at Google and authenticates nothing, so this is
  tidiness rather than exposure. Removing it redeploys the Worker:

  ```bash
  cd apps/web && ./cf npx wrangler secret delete GOOGLE_SERVICE_ACCOUNT_KEY
  ```

- Old state versions in R2 under `tf/` still contain the service-account
  key as it was written. It is revoked, not redacted — which is the usual
  outcome for a credential that has ever been in Terraform state, and the
  reason state lives in the private bucket.
