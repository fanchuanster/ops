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
