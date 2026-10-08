resource "kubernetes_config_map_v1" "postgres_init" {
  metadata {
    name      = "postgres-init-scripts"
    namespace = var.namespace
  }
  data = {
    "01-roles.sh" = <<-SCRIPT
      #!/bin/sh
      set -eu
      psql -v ON_ERROR_STOP=1 --username postgres --dbname postgres \
        -v owner_password="$GROCERY_OWNER_PASSWORD" \
        -v app_password="$GROCERY_APP_PASSWORD" \
        -v backup_password="$GROCERY_BACKUP_PASSWORD" <<'SQL'
      CREATE ROLE grocery_owner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD :'owner_password';
      CREATE ROLE grocery_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD :'app_password';
      CREATE ROLE grocery_backup LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD :'backup_password';
      ALTER DATABASE postgres OWNER TO grocery_owner;
      ALTER SCHEMA public OWNER TO grocery_owner;
      REVOKE CREATE ON SCHEMA public FROM PUBLIC;
      GRANT USAGE ON SCHEMA public TO grocery_app, grocery_backup;
      ALTER DEFAULT PRIVILEGES FOR ROLE grocery_owner IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO grocery_app;
      ALTER DEFAULT PRIVILEGES FOR ROLE grocery_owner IN SCHEMA public GRANT USAGE,SELECT ON SEQUENCES TO grocery_app;
      GRANT pg_read_all_data TO grocery_backup;
      SQL
    SCRIPT
    "pg_hba.conf" = <<-HBA
      local all all trust
      hostssl all all 0.0.0.0/0 scram-sha-256
      hostnossl all all 0.0.0.0/0 reject
      hostssl all all ::/0 scram-sha-256
      hostnossl all all ::/0 reject
    HBA
  }
  depends_on = [kubernetes_namespace_v1.grocery]
}
resource "kubernetes_service_v1" "postgres" {
  metadata {
    name      = "postgres"
    namespace = var.namespace
  }
  spec {
    selector = { app = "postgres" }
    port { port = 5432 }
    type = "ClusterIP"
  }
  depends_on = [kubernetes_namespace_v1.grocery]
}
resource "kubernetes_stateful_set_v1" "postgres" {
  metadata {
    name      = "postgres"
    namespace = var.namespace
  }
  spec {
    service_name = kubernetes_service_v1.postgres.metadata[0].name
    replicas     = 1
    selector { match_labels = { app = "postgres" } }
    template {
      metadata {
        labels      = { app = "postgres" }
        annotations = { tls-hash = sha256(jsonencode(local.postgres_tls)) }
      }
      spec {
        automount_service_account_token  = false
        termination_grace_period_seconds = 120
        init_container {
          name    = "init-postgres-directory-and-tls"
          image   = var.postgres_image
          command = ["sh", "-ec", "mkdir -p /shared/postgres; chown 999:999 /shared/postgres; chmod 700 /shared/postgres; cp /tls-secret/server.* /tls/; chown 999:999 /tls/server.*; chmod 600 /tls/server.key"]
          volume_mount {
            name       = "data"
            mount_path = "/shared"
          }
          volume_mount {
            name       = "tls-secret"
            mount_path = "/tls-secret"
            read_only  = true
          }
          volume_mount {
            name       = "tls"
            mount_path = "/tls"
          }
        }
        container {
          name  = "postgres"
          image = var.postgres_image
          args  = ["postgres", "-c", "ssl=on", "-c", "ssl_cert_file=/tls/server.crt", "-c", "ssl_key_file=/tls/server.key", "-c", "hba_file=/etc/postgres/pg_hba.conf", "-c", "max_connections=50", "-c", "shared_buffers=256MB", "-c", "work_mem=4MB", "-c", "max_wal_size=1GB"]
          security_context {
            run_as_user                = 999
            run_as_group               = 999
            allow_privilege_escalation = false
          }
          env {
            name  = "PGDATA"
            value = "/var/lib/postgresql/data/pgdata"
          }
          env {
            name  = "POSTGRES_INITDB_ARGS"
            value = "--encoding=UTF8 --locale=C.UTF-8 --auth-host=scram-sha-256"
          }
          env_from {
            secret_ref { name = kubernetes_secret_v1.postgres_init.metadata[0].name }
          }
          port { container_port = 5432 }
          volume_mount {
            name       = "data"
            mount_path = "/var/lib/postgresql/data"
            sub_path   = "postgres"
          }
          volume_mount {
            name       = "init"
            mount_path = "/docker-entrypoint-initdb.d/01-roles.sh"
            sub_path   = "01-roles.sh"
            read_only  = true
          }
          volume_mount {
            name       = "init"
            mount_path = "/etc/postgres/pg_hba.conf"
            sub_path   = "pg_hba.conf"
            read_only  = true
          }
          volume_mount {
            name       = "tls"
            mount_path = "/tls"
            read_only  = true
          }
          resources {
            requests = { cpu = "500m", memory = "1Gi" }
            limits   = { memory = "3Gi" }
          }
          startup_probe {
            exec { command = ["pg_isready", "-U", "postgres"] }
            period_seconds    = 10
            failure_threshold = 120
          }
          readiness_probe {
            exec { command = ["pg_isready", "-U", "postgres"] }
            period_seconds = 10
          }
        }
        volume {
          name = "data"
          persistent_volume_claim { claim_name = kubernetes_persistent_volume_claim_v1.platform.metadata[0].name }
        }
        volume {
          name = "init"
          config_map { name = kubernetes_config_map_v1.postgres_init.metadata[0].name }
        }
        volume {
          name = "tls-secret"
          secret { secret_name = kubernetes_secret_v1.postgres_tls.metadata[0].name }
        }
        volume {
          name = "tls"
          empty_dir { medium = "Memory" }
        }
      }
    }
  }
}
