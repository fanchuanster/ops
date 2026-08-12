provider "cloudflare" {
  # The token comes from the environment, never a variable — a variable
  # would put it in terraform.tfvars and in state.
  #
  # NobleSee keeps a single Cloudflare token, CLOUDFLARE_CUSTOM_TOKEN.
  # The provider reads CLOUDFLARE_API_TOKEN, so use the `infra/tf`
  # wrapper, which bridges the two names and fails loudly if the token
  # is missing. Required scopes are in infra/README.md.
}
