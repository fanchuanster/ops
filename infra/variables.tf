variable "account_id" {
  description = "Cloudflare account that owns the R2 bucket, D1 database and Worker."
  type        = string
}

variable "zone_id" {
  description = "Cloudflare zone for noblesee.com."
  type        = string
}

variable "domain" {
  description = "Apex domain the site is served on."
  type        = string
  default     = "noblesee.com"
}

variable "environment" {
  description = "Deployment environment. Names are suffixed with it so a non-production apply can never collide with production."
  type        = string
  default     = "production"

  validation {
    condition     = contains(["production", "staging"], var.environment)
    error_message = "environment must be production or staging."
  }
}

variable "r2_location" {
  description = "Location hint for the R2 bucket. Cloudflare places data near this region; it is a hint, not a guarantee."
  type        = string
  default     = "APAC"
}

variable "manage_redirect_ruleset" {
  description = <<-EOT
    Whether Terraform manages the www→apex redirect ruleset.

    The Rulesets API needs a zone permission beyond DNS and Zone Settings.
    In the token UI it is called "Single Redirect" — Cloudflare's Single
    Redirects feature IS the http_request_dynamic_redirect phase this
    ruleset targets; "dynamic redirect" is the API's name for it, not the
    dashboard's, and there is no permission by that name.

    Set false while the token lacks it, so the rest of the configuration
    still applies cleanly, and true once it is granted.
  EOT
  type        = bool
  default     = true
}
