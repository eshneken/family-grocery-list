resource "kubernetes_cron_job_v1" "postgres_backup" {
  metadata {
    name      = "grocery-postgres-backup"
    namespace = var.namespace
  }
  spec {
    schedule                      = "0 9 * * *"
    timezone                      = "Etc/UTC"
    suspend                       = !var.backups_enabled
    concurrency_policy            = "Forbid"
    starting_deadline_seconds     = 3600
    successful_jobs_history_limit = 1
    failed_jobs_history_limit     = 3
    job_template {
      metadata { labels = { task = "postgres-backup" } }
      spec {
        backoff_limit              = 0
        active_deadline_seconds    = 1800
        ttl_seconds_after_finished = 86400
        template {
          metadata { labels = { task = "postgres-backup" } }
          spec {
            restart_policy                  = "Never"
            automount_service_account_token = false
            security_context {
              run_as_user  = 999
              run_as_group = 999
              fs_group     = 999
            }
            container {
              name  = "backup"
              image = var.backup_image
              env {
                name  = "OCI_NAMESPACE"
                value = "iddiywf0v4j6"
              }
              env {
                name  = "BACKUP_BUCKET"
                value = "grocery-always-free-backups"
              }
              env {
                name  = "AGE_RECIPIENT"
                value = var.backup_age_recipient
              }
              env {
                name = "DATABASE_URL"
                value_from {
                  secret_key_ref {
                    name = "database-backup"
                    key  = "DATABASE_URL"
                  }
                }
              }
              volume_mount {
                name       = "ca"
                mount_path = "/var/run/postgres-ca"
                read_only  = true
              }
              volume_mount {
                name       = "scratch"
                mount_path = "/scratch"
              }
              resources {
                requests = { cpu = "100m", memory = "256Mi", ephemeral-storage = "1Gi" }
                limits   = { cpu = "500m", memory = "768Mi", ephemeral-storage = "2Gi" }
              }
              security_context { allow_privilege_escalation = false }
            }
            volume {
              name = "ca"
              config_map { name = "postgres-ca" }
            }
            volume {
              name = "scratch"
              empty_dir { size_limit = "2Gi" }
            }
          }
        }
      }
    }
  }
  depends_on = [kubernetes_namespace_v1.grocery, kubernetes_secret_v1.database, kubernetes_config_map_v1.postgres_ca]
}
