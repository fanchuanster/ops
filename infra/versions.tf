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

  # State is local for now.
  #
  # The obvious Cloudflare-native answer is an S3-compatible backend on
  # R2, but that has a bootstrapping problem: this configuration is what
  # creates the buckets, so the state bucket cannot be one of them. When
  # this moves to a team, create a separate `noblesee-tfstate` bucket by
  # hand (or in a tiny separate config) and point a backend block here.
  # Until then, terraform.tfstate stays out of git — it holds resource
  # ids and, for some resources, secret material.
}
