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
 * Credentials come from the environment, not from a Terraform variable —
 * same reason as the Cloudflare token: a variable ends up in
 * terraform.tfvars.
 *
 * gcloud is not installed on this host and runs in a container instead
 * (`infra/gc`), so its application-default credentials land in
 * `infra/.gcloud-home/`. `infra/tf` points
 * GOOGLE_APPLICATION_CREDENTIALS at them.
 */
provider "google" {
  project = var.gcp_project
  region  = var.gcs_location
}

provider "google-beta" {
  project = var.gcp_project
  region  = var.gcs_location
}
