locals {
  # Production keeps the bare name so existing references (and the
  # R2_BUCKET default in docker-compose.yml) stay correct; other
  # environments get a suffix.
  suffix = var.environment == "production" ? "" : "-${var.environment}"

  bucket_name = "noblesee${local.suffix}"
  d1_name     = "noblesee${local.suffix}"
  worker_name = "noblesee${local.suffix}"

  hostname = var.environment == "production" ? var.domain : "${var.environment}.${var.domain}"

  tags = {
    project     = "noblesee"
    environment = var.environment
    managed_by  = "terraform"
  }
}
