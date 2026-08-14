provider "cloudflare" {
  # The token comes from CLOUDFLARE_API_TOKEN in the environment, never
  # a Terraform variable — a variable would put it in terraform.tfvars
  # and in state.
  #
  # `infra/tf` loads it from the repo's .env. Required scopes are listed
  # in infra/README.md.
}

/*
 * Google Cloud, for Document AI only.
 *
 * Credentials come from the environment — GOOGLE_APPLICATION_CREDENTIALS,
 * or `gcloud auth application-default login` — and deliberately not from
 * a Terraform variable, for the same reason the Cloudflare token is not
 * one: a variable ends up in terraform.tfvars.
 */
provider "google" {
  project = var.gcp_project
  region  = var.gcs_location
}

provider "google-beta" {
  project = var.gcp_project
  region  = var.gcs_location
}
