terraform {
  required_version = ">= 1.9"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
  }

  # State lives in R2 — see backend.tf.
  #
  # It is stored in the artifacts bucket, which this configuration also
  # creates. The bootstrapping problem that argued for a separate bucket
  # turned out to be a one-time cost rather than a standing one: the
  # bucket already existed by the time the backend was added, so there
  # was nothing to bootstrap. What remains is the destroy hazard
  # documented in backend.tf.
  #
  # State has held secret material — the Document AI service account key
  # among it, until those resources were destroyed on 2026-08-19 — so it
  # stays out of git regardless of where it lives. Old state versions in
  # R2 still contain that key; it is revoked, not redacted.
}
