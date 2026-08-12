# Attaching the Worker to the domain.
#
# DELIBERATE SPLIT: Terraform owns the infrastructure the Worker binds
# to — the R2 bucket, the D1 database, DNS — but NOT the Worker script
# itself. The script is built by OpenNext and shipped by wrangler.
#
# The alternative, putting the compiled bundle in cloudflare_workers_script,
# means every `wrangler deploy` shows up as drift on the next
# `terraform plan`, and Terraform tries to roll the code back to
# whatever it last saw. Splitting on the code/infra line avoids a fight
# between the two tools over the same resource.
#
# That leaves an ordering constraint: a custom domain cannot attach to a
# Worker that does not exist yet. Hence the gate below.
#
#   1. terraform apply                    (bucket, D1, DNS)
#   2. wrangler deploy                    (the Worker, bound to both)
#   3. terraform apply -var worker_deployed=true   (attach the domain)
#
# Step 3 is only needed once; leave worker_deployed=true in tfvars
# afterwards.

variable "worker_deployed" {
  description = "Set true once `wrangler deploy` has created the Worker, to attach it to the domain. See the ordering note above."
  type        = bool
  default     = false
}

# A custom domain creates and manages its own DNS record, which is why
# dns.tf does not define one for the apex. Attaching this will REPLACE
# the proxied CNAME that previously pointed the apex at the Cloudflare
# Tunnel — that record is now obsolete, since a Worker runs at the edge
# and has no origin to tunnel to.
resource "cloudflare_workers_custom_domain" "site" {
  count = var.worker_deployed ? 1 : 0

  account_id = var.account_id
  zone_id    = var.zone_id
  hostname   = local.hostname
  service    = local.worker_name
  # `environment` is deprecated in provider v5 and deliberately omitted;
  # Worker environments are expressed in wrangler.jsonc instead.
}
