terraform {
  required_version = ">= 1.9"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
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
