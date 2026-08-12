# DNS.
#
# The apex record is intentionally absent: cloudflare_workers_custom_domain
# in worker.tf creates and owns it. Defining one here as well would give
# two resources a claim on the same record.

# www redirects to the apex rather than serving a second copy of the
# site. Proxied so the redirect happens at Cloudflare's edge and never
# reaches the Worker.
resource "cloudflare_dns_record" "www" {
  zone_id = var.zone_id
  name    = "www.${var.domain}"
  type    = "CNAME"
  content = var.domain
  ttl     = 1 # 1 means "automatic", required when proxied
  proxied = true
  comment = "Managed by Terraform — redirects to the apex via the ruleset below."
}

# The redirect itself. Without this, www would serve the site on a
# second hostname, which splits sessions (the auth cookie is scoped to
# one host) and gives search engines duplicate content.
#
# Gated because it needs a zone permission the other resources do not —
# see manage_redirect_ruleset in variables.tf. Without the gate, a token
# missing that one permission fails every apply, including the parts it
# is perfectly entitled to make.
resource "cloudflare_ruleset" "www_redirect" {
  count = var.manage_redirect_ruleset ? 1 : 0

  zone_id = var.zone_id
  name    = "Redirect www to apex"
  kind    = "zone"
  phase   = "http_request_dynamic_redirect"

  rules = [{
    ref         = "www_to_apex"
    description = "Send www.${var.domain} to ${var.domain}, preserving the path"
    expression  = "(http.host eq \"www.${var.domain}\")"
    action      = "redirect"
    action_parameters = {
      from_value = {
        status_code = 301
        target_url = {
          expression = "concat(\"https://${var.domain}\", http.request.uri.path)"
        }
        preserve_query_string = true
      }
    }
  }]
}
