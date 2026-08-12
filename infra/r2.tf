# Book artifacts: DOCX masters, EPUBs and the three PDF sizes.
#
# The bucket is deliberately NOT public. Everything in it is reached
# either through a short-lived signed URL or streamed by the Worker
# after a server-side authorization decision, so a public bucket would
# defeat the rights, staged-release and download-limit rules entirely.
# There is no public-access resource here on purpose.
resource "cloudflare_r2_bucket" "artifacts" {
  account_id    = var.account_id
  name          = local.bucket_name
  location      = var.r2_location
  storage_class = "Standard"
}

# CORS exists only for the in-browser reader.
#
# Scoped to the site's own origin rather than "*": these objects are
# access-controlled, and a wildcard would let any page on the internet
# read a signed URL's response if it ever obtained one.
resource "cloudflare_r2_bucket_cors" "artifacts" {
  account_id  = var.account_id
  bucket_name = cloudflare_r2_bucket.artifacts.name

  rules = [{
    allowed = {
      origins = ["https://${local.hostname}"]
      methods = ["GET", "HEAD"]
      headers = ["range", "content-type"]
    }
    expose_headers  = ["content-length", "content-range", "etag"]
    max_age_seconds = 3600
  }]
}

# Conversion scratch space expires; finished artifacts do not.
#
# Only the conversion/ prefix is swept. Anything under books/ is the
# product of OCR, proofreading and human review — the expensive part of
# this project — and must never be aged out by a storage rule.
resource "cloudflare_r2_bucket_lifecycle" "artifacts" {
  account_id  = var.account_id
  bucket_name = cloudflare_r2_bucket.artifacts.name

  # ORDER MATTERS, and not for behavioural reasons. R2 returns lifecycle
  # rules sorted by prefix — broadest first — while the provider compares
  # the list positionally. Listing these in any other order produces a
  # diff on every plan that an apply cannot settle, because the API keeps
  # handing them back in its own order. Keep the empty-prefix rule first.
  rules = [
    {
      id      = "abort-incomplete-uploads"
      enabled = true
      conditions = {
        prefix = ""
      }
      abort_multipart_uploads_transition = {
        condition = {
          type    = "Age"
          max_age = 604800 # 7 days
        }
      }
    },
    {
      id      = "expire-conversion-scratch"
      enabled = true
      conditions = {
        prefix = "conversion/"
      }
      delete_objects_transition = {
        condition = {
          type    = "Age"
          max_age = 2592000 # 30 days
        }
      }
    },
  ]
}
