provider "cloudflare" {
  # The token comes from CLOUDFLARE_API_TOKEN in the environment, never
  # a Terraform variable — a variable would put it in terraform.tfvars
  # and in state.
  #
  # `infra/tf` loads it from the repo's .env. Required scopes are listed
  # in infra/README.md.
}
