/*
 * Google Document AI, for OCR.
 *
 * OCR is the one stage of the pipeline that cannot run on a Worker: a
 * Worker has 128 MB of memory and at most five minutes of CPU, and
 * PaddleOCR needs neither of those in the quantities available. Calling
 * a hosted OCR service turns that compute into an HTTP request, which a
 * Worker is billed almost nothing for — see docs/CLOUDFLARE_ARCHITECTURE.md
 * for the CPU-shape argument this follows from.
 *
 * Batch processing rather than online. Online caps a request at 15 pages,
 * which for a 300-page book means twenty calls to orchestrate and
 * reassemble; batch takes 500 pages in one operation and does the
 * splitting itself. The cost is that batch does not answer inline — it
 * writes results into a bucket — which is why there is a bucket here.
 *
 * Everything in this file is in Google Cloud. R2 remains the canonical
 * store for books and artifacts; the bucket below is scratch space for
 * one stage of one job, and its lifecycle rule says so.
 */

resource "google_project_service" "documentai" {
  project = var.gcp_project
  service = "documentai.googleapis.com"

  # Turning the API off again should be a deliberate act, not a side
  # effect of destroying this configuration.
  disable_on_destroy = false
}

resource "google_project_service" "storage" {
  project            = var.gcp_project
  service            = "storage.googleapis.com"
  disable_on_destroy = false
}

/*
 * The OCR processor.
 *
 * `OCR_PROCESSOR` is Enterprise Document OCR — text and handwriting in
 * over 200 languages, which is what a library of Chinese scans needs.
 * Location is a multi-region and is fixed for the processor's life: a
 * processor cannot be moved, so changing it replaces it.
 */
resource "google_document_ai_processor" "ocr" {
  project      = var.gcp_project
  location     = var.documentai_location
  display_name = "noblesee-ocr-${var.environment}"
  type         = "OCR_PROCESSOR"

  depends_on = [google_project_service.documentai]
}

/*
 * Scratch space for batch OCR.
 *
 * Private, with public access prevented at the bucket level rather than
 * merely unset — a reader's private upload passes through here, and
 * CLAUDE.md section 6 is explicit that private conversion content must
 * not become publicly reachable.
 *
 * Uniform bucket-level access on purpose: per-object ACLs are a second
 * permission system to reason about, and one service account needs the
 * whole bucket.
 */
resource "google_storage_bucket" "conversion" {
  project  = var.gcp_project
  name     = var.documentai_bucket
  location = var.gcs_location

  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  # Nothing here is a record of anything. The source is already in R2 and
  # the OCR output is folded into the DOCX master, so a week is generous
  # for retrying a failed job and short enough that a reader's book does
  # not sit in a second cloud indefinitely.
  lifecycle_rule {
    condition {
      age = 7
    }
    action {
      type = "Delete"
    }
  }

  # Deleting a scratch bucket should not require emptying it by hand.
  force_destroy = true

  depends_on = [google_project_service.storage]
}

/*
 * The identity the Worker uses.
 *
 * A Worker cannot use workload identity federation from Cloudflare
 * without a trust configuration of its own, so this is a service account
 * with a key, and the key is a Worker secret. That makes it the one
 * long-lived Google credential in the system — hence the narrowest
 * possible grants below: OCR on the project, objects in one bucket, and
 * nothing else.
 */
resource "google_service_account" "converter" {
  project      = var.gcp_project
  account_id   = "noblesee-converter-${var.environment}"
  display_name = "NobleSee converter (Document AI + conversion bucket)"
}

# Calls Document AI. `apiUser` can run processors; it cannot create,
# edit or delete them, so a leaked key cannot reshape the pipeline.
resource "google_project_iam_member" "converter_documentai" {
  project = var.gcp_project
  role    = "roles/documentai.apiUser"
  member  = "serviceAccount:${google_service_account.converter.email}"
}

# Reads and writes objects in the scratch bucket, and only that bucket.
# `objectAdmin` rather than `admin`: no bucket-level configuration.
resource "google_storage_bucket_iam_member" "converter_objects" {
  bucket = google_storage_bucket.conversion.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.converter.email}"
}

/*
 * Document AI writes batch output as the *Document AI service agent*,
 * not as the caller, so that agent needs its own access to the bucket.
 * Missing this is the classic way a batch job fails with a permission
 * error naming an account nobody created.
 *
 * The agent is brought into existence explicitly rather than waited for.
 * Enabling the API does not create it immediately, and granting IAM to a
 * principal that does not exist yet is how a first `apply` fails — which
 * is the only reason google-beta is a dependency of this configuration.
 */
resource "google_project_service_identity" "documentai" {
  provider = google-beta
  project  = var.gcp_project
  service  = "documentai.googleapis.com"

  depends_on = [google_project_service.documentai]
}

resource "google_storage_bucket_iam_member" "documentai_agent_objects" {
  bucket = google_storage_bucket.conversion.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_project_service_identity.documentai.email}"
}

/*
 * The key, for the Worker secret.
 *
 * Marked sensitive and never printed. Put it into the Worker with:
 *
 *   terraform output -raw documentai_service_account_key |
 *     ./cf npx wrangler secret put GOOGLE_SERVICE_ACCOUNT_KEY
 *
 * It lands in Terraform state, which is why state is local and
 * gitignored — see the note in versions.tf.
 */
resource "google_service_account_key" "converter" {
  service_account_id = google_service_account.converter.name
}
