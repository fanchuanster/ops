# The application database.
#
# D1 rather than Hyperdrive-to-Postgres: Hyperdrive is a connection
# pooler, so it still requires a Postgres reachable from the public
# internet — which would mean adding a database vendor alongside
# Cloudflare, the opposite of what "Cloudflare-native" is for. D1 is
# Cloudflare's own, and Payload has a SQLite adapter.
#
# The cost of that choice, recorded here so it is not rediscovered
# later: the schema migrations were written for PostgreSQL and have to
# be regenerated for SQLite.
resource "cloudflare_d1_database" "app" {
  account_id            = var.account_id
  name                  = local.d1_name
  primary_location_hint = var.r2_location

  # Read replicas are off. Payload reads and writes on the same request
  # path (sessions, the download ledger), and an eventually-consistent
  # replica would let a reader's own download vanish from their history
  # for a moment — and, worse, let the download limit under-count.
  read_replication = {
    mode = "disabled"
  }
}
