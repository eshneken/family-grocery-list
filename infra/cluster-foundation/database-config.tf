resource "kubernetes_config_map_v1" "postgres_ca" {
  metadata {
    name      = "postgres-ca"
    namespace = kubernetes_namespace_v1.grocery.metadata[0].name
  }

  data = {
    "ca.crt" = data.oci_psql_db_system_connection_detail.grocery.ca_certificate
  }
}

resource "kubernetes_secret_v1" "database" {
  metadata {
    name      = "database"
    namespace = kubernetes_namespace_v1.grocery.metadata[0].name
  }

  data = {
    DATABASE_URL  = local.database_url
    DATABASE_HOST = local.postgres_endpoint.fqdn
    DATABASE_PORT = tostring(local.postgres_endpoint.port)
  }

  type = "Opaque"
}
