terraform {
  required_version = ">= 1.9"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }

    # OCR runs on Document AI, which is the one part of this system that
    # is not on Cloudflare. See documentai.tf for why.
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }

    # For exactly one resource: google_project_service_identity, which
    # creates the Document AI service agent. Batch OCR writes its output
    # as that agent rather than as the caller, so the agent needs access
    # to the bucket — and granting IAM to an agent that has not been
    # created yet is how a first `apply` fails. The GA provider has no
    # equivalent resource.
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 6.0"
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
  # State still holds secret material — the Document AI service account
  # key among it — so it stays out of git regardless of where it lives.
}
