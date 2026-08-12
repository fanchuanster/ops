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
| Zone    | Zone Settings / Config — Edit | the www→apex redirect ruleset  |

Verify a token before using it:

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

`200` is fine; `401`/`403` means that permission is missing. A token short of
one of these fails partway through an apply rather than up front, leaving some
resources created and others not — Terraform recovers cleanly on the next run,
but it is quicker to check first.

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

Local, and git-ignored: it holds resource ids and, for some resources, secret
material.

The Cloudflare-native answer is an S3-compatible backend on R2, but that has a
bootstrapping problem — this configuration is what creates the buckets, so the
state bucket cannot be one of them. When this moves beyond one operator, create
a separate `noblesee-tfstate` bucket outside this config and add a backend
block to `versions.tf`.

## Known drift

The apex `noblesee.com` record still points at the retired Cloudflare Tunnel
and is **not** managed here. `cloudflare_workers_custom_domain` creates and
owns that record, so it will be replaced at step 3 above. Until then the apex
resolves to a tunnel with nothing behind it.
