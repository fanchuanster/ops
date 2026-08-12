provider "cloudflare" {
  # Supplied via CLOUDFLARE_API_TOKEN in the environment rather than a
  # variable, so a token never lands in a .tfvars file or in state.
  # Use the account+zone scoped token (see infra/README.md).
}
