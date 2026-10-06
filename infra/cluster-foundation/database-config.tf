resource "kubernetes_config_map_v1" "postgres_ca" {
  metadata {
    name      = "postgres-ca"
    namespace = var.namespace
  }
  data       = { "ca.crt" = local.postgres_tls.ca }
  depends_on = [kubernetes_namespace_v1.grocery]
}
resource "kubernetes_secret_v1" "database" {
  for_each = { database = "grocery_app", database-migration = "grocery_owner", database-backup = "grocery_backup" }
  metadata {
    name      = each.key
    namespace = var.namespace
  }
  data = {
    DATABASE_URL  = local.database_urls[each.value]
    DATABASE_HOST = local.postgres_host
    DATABASE_PORT = "5432"
  }
  depends_on = [kubernetes_namespace_v1.grocery]
}
resource "kubernetes_secret_v1" "postgres_init" {
  metadata {
    name      = "postgres-init"
    namespace = var.namespace
  }
  data = {
    POSTGRES_PASSWORD       = local.postgres_passwords.postgres
    GROCERY_OWNER_PASSWORD  = local.postgres_passwords.grocery_owner
    GROCERY_APP_PASSWORD    = local.postgres_passwords.grocery_app
    GROCERY_BACKUP_PASSWORD = local.postgres_passwords.grocery_backup
  }
  depends_on = [kubernetes_namespace_v1.grocery]
}
resource "kubernetes_secret_v1" "postgres_tls" {
  metadata {
    name      = "postgres-tls"
    namespace = var.namespace
  }
  data       = { "server.crt" = local.postgres_tls.cert, "server.key" = local.postgres_tls.key }
  depends_on = [kubernetes_namespace_v1.grocery]
}
