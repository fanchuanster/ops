output "documentai_processor_id" {
  description = "Processor resource name, for DOCUMENT_AI_PROCESSOR."
  value       = google_document_ai_processor.ocr.id
}

output "documentai_location" {
  description = "Multi-region the processor lives in. The API endpoint is derived from it."
  value       = var.documentai_location
}

output "documentai_bucket" {
  description = "Scratch bucket for batch OCR input and output."
  value       = google_storage_bucket.conversion.name
}

output "documentai_service_account" {
  description = "Service account the Worker authenticates as."
  value       = google_service_account.converter.email
}

output "documentai_service_account_key" {
  description = "Base64 service-account JSON. Pipe into `wrangler secret put GOOGLE_SERVICE_ACCOUNT_KEY`."
  value       = google_service_account_key.converter.private_key
  sensitive   = true
}
