# Always Free cluster foundation

Uses only the new production state and a short-lived target kubeconfig. Creates PostgreSQL 16 with verified TLS, runtime/migration/backup Secrets, PostgreSQL CA ConfigMap, Caddy, one retained 50 GiB `platform-data` claim, one 10/10 Mbps TCP flexible LB and the daily backup CronJob.

Both PostgreSQL and Caddy use the same ReadWriteOnce claim, with separate `postgres` and `caddy` subdirectories. Init containers create/own only their own directory; no shared pod-level fsGroup recursively changes the disk. Never replace the shared PVC to roll out an application.

The official PostgreSQL Bookworm and Caddy image indexes are pinned by digest and include ARM64. Rehearsal must verify the source PostgreSQL encoding, locale/collation and extensions against the destination before final restore; change the reviewed image/init settings if they differ. Do not infer compatibility from the major version alone.

The backup image is built by **Build PostgreSQL backup image** and pinned with `OCI_BACKUP_IMAGE`. Set an external age public recipient with `OCI_BACKUP_AGE_RECIPIENT`. Keep its private key outside OCI/GitHub. `backups_enabled=false` is the initial default; enable via reviewed Terraform only after successful encrypted backup/restore and instance-principal permission checks.

Use authenticated `kubectl port-forward service/postgres 5432:5432` for administration. The certificate name is `postgres.grocery.svc.cluster.local`; with local libpq set `PGHOST` to that name and `PGHOSTADDR=127.0.0.1`, plus the exported CA and your separately retrieved administrator/owner password. Never expose port 5432 publicly.

See the [operator runbook](../../docs/oci-always-free-operations.md) and [full migration design](../../docs/oci-always-free-design.md).
