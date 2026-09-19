/*
 * State lives in R2, under tf/.
 *
 * R2 speaks the S3 API, so the stock `s3` backend drives it — but it is
 * not AWS, and every skip_* below turns off a check that would otherwise
 * call an AWS service that does not exist here (STS, IMDS, the account
 * id lookup). skip_s3_checksum is the one that is easy to miss: modern
 * Terraform sends integrity headers R2 rejects, and without it every
 * write fails with an opaque 400.
 *
 * This is a PARTIAL configuration. The endpoint contains the Cloudflare
 * account id and the credentials are secrets, so neither is written
 * here — `infra/tf` exports both from the repo's .env as AWS_* variables
 * that the backend reads from the environment. Running bare `terraform`
 * without those exported will fail to initialise, which is the intended
 * failure: it cannot silently fall back to a local state file.
 *
 * The bucket is the artifacts bucket, which THIS configuration manages.
 * That circularity is survivable but has one sharp edge: `terraform
 * destroy` would delete the bucket holding the state that describes what
 * it is deleting. Never destroy this configuration wholesale; remove
 * resources individually if it ever comes to that.
 *
 * The tf/ prefix is deliberately outside books/ and conversion/. The
 * lifecycle rules in r2.tf sweep conversion/ on a 30-day clock, and an
 * expired state file is an unrecoverable loss rather than an
 * inconvenience.
 */
terraform {
  backend "s3" {
    bucket = "noblesee"
    key    = "tf/terraform.tfstate"

    # R2 is single-region per bucket and ignores this, but the backend
    # requires it to be set. Validation is off because "auto" is not an
    # AWS region name.
    region = "auto"

    skip_credentials_validation = true
    skip_metadata_api_check     = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_s3_checksum            = true
    use_path_style              = true

    # Native S3 locking, via a conditional PUT of tf/terraform.tfstate.tflock.
    # No DynamoDB table, which R2 has no equivalent of anyway.
    use_lockfile = true
  }
}
