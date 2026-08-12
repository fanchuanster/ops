# These feed the application's wrangler configuration. Rather than
# copying ids by hand into wrangler.jsonc — where they rot silently —
# generate the binding block:
#
#   terraform -chdir=infra output -json wrangler_bindings
#
# See infra/README.md.

output "r2_bucket_name" {
  description = "Name of the artifacts bucket, for the Worker's R2 binding and the S3 API."
  value       = cloudflare_r2_bucket.artifacts.name
}

output "d1_database_id" {
  description = "D1 database id, required by the Worker's D1 binding."
  value       = cloudflare_d1_database.app.id
}

output "d1_database_name" {
  description = "D1 database name, for `wrangler d1` commands."
  value       = cloudflare_d1_database.app.name
}

output "worker_name" {
  description = "Worker service name; must match `name` in wrangler.jsonc."
  value       = local.worker_name
}

output "hostname" {
  description = "Public hostname the site is served on."
  value       = local.hostname
}

output "site_url" {
  description = "Value for PUBLIC_SITE_URL / NEXT_PUBLIC_SERVER_URL."
  value       = "https://${local.hostname}"
}

# The bindings block, ready to paste into (or generate) wrangler.jsonc.
output "wrangler_bindings" {
  description = "Worker bindings derived from the resources above."
  value = {
    name = local.worker_name
    d1_databases = [{
      binding       = "DB"
      database_name = cloudflare_d1_database.app.name
      database_id   = cloudflare_d1_database.app.id
    }]
    r2_buckets = [{
      binding     = "ARTIFACTS"
      bucket_name = cloudflare_r2_bucket.artifacts.name
    }]
  }
}
