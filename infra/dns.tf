# DNS.
#
# The site's record (books.<domain>) is intentionally absent:
# cloudflare_workers_custom_domain in worker.tf creates and owns it.
# Defining one here as well would give two resources a claim on the same
# record. The apex and www have no records: the site moved to books on
# 2026-10-28 and noblesee.com itself points nowhere.

# Records that authorise NobleSee to send mail as this domain, for
# Send-to-Kindle. Amazon silently discards a personal document whose
# sender fails SPF or DKIM, so without these the feature appears to work
# and delivers nothing.
#
# Never proxied: proxying applies to HTTP, and these are TXT and MX
# records that resolvers read directly.
resource "cloudflare_dns_record" "email" {
  for_each = { for r in var.email_dns_records : "${r.type}-${r.name}" => r }

  zone_id  = var.zone_id
  name     = each.value.name == "@" ? var.domain : "${each.value.name}.${var.domain}"
  type     = each.value.type
  content  = each.value.content
  priority = each.value.priority
  ttl      = 3600
  comment  = "Managed by Terraform — mail sending for Send-to-Kindle."
}
