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

variable "email_dns_records" {
  description = <<-EOT
    DNS records that prove NobleSee may send mail as the domain.

    Kindle delivery emails the book to the reader's @kindle.com address,
    and Amazon drops anything that fails SPF/DKIM. The exact records are
    issued by the mail provider when the sending domain is verified, so
    they cannot be written here in advance — paste them in once Resend
    shows them.

    Empty by default: the site runs perfectly well without Kindle
    delivery, and an unverified sending domain is worse than none at all
    because it produces mail that silently disappears.

    Example:

      email_dns_records = [
        { name = "send",              type = "MX",  content = "feedback-smtp.eu-west-1.amazonses.com", priority = 10 },
        { name = "send",              type = "TXT", content = "v=spf1 include:amazonses.com ~all" },
        { name = "resend._domainkey", type = "TXT", content = "p=MIGfMA0GCSq..." },
      ]
  EOT
  type = list(object({
    name     = string
    type     = string
    content  = string
    priority = optional(number)
  }))
  default = []
}

# --- Google Cloud, for Document AI OCR -----------------------------------
#
# Separate from everything above: these describe a second cloud. The
# Cloudflare side needs none of them, and `terraform plan` will not ask
# for them unless the Document AI resources are in scope.

variable "gcp_project" {
  description = "Google Cloud project id that owns the Document AI processor and the conversion bucket."
  type        = string
}

variable "documentai_location" {
  description = <<-EOT
    Document AI multi-region. Fixed for a processor's life — changing it
    replaces the processor. `eu` keeps documents in Europe; `us` is the
    other multi-region. Enterprise Document OCR is also available in
    several single regions.
  EOT
  type        = string
  default     = "eu"

  validation {
    condition = contains([
      "us", "eu", "asia-south1", "asia-southeast1", "australia-southeast1",
      "europe-west2", "europe-west3", "northamerica-northeast1",
    ], var.documentai_location)
    error_message = "Not a location Enterprise Document OCR is offered in."
  }
}

variable "gcs_location" {
  description = "Location for the conversion bucket. Keep it with the processor so batch jobs are not cross-region."
  type        = string
  default     = "EU"
}

variable "documentai_bucket" {
  description = "Globally unique name for the private conversion bucket."
  type        = string
}
