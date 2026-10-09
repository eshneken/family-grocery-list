# Database backup alerts

The **Always Free backup health** workflow (`.github/workflows/always-free-backup-health.yml`) runs hourly at minute 17 on `master` and supports manual dispatch. It verifies the exact configured namespace and OKE cluster using private `OCI_TARGET_CONFIG` and short-lived OCI federation. It reads object metadata and Kubernetes Job/CronJob status; it provisions no infrastructure and reads no database rows or archive contents.

After enabling and validating daily backups, set `OCI_BACKUP_MONITOR_ENABLED=true` in the `always-free` environment. Permit `master` in its deployment branch rules. Trigger a manual healthy check, then verify receipt of a controlled failed-workflow notification before relying on alerts. Do not alter production backups to test notification delivery.

Checks fail on stale (>30 hours), missing, incomplete or empty backups, excessive completed retention (>5), newer failed Jobs, stuck Jobs (>40 minutes), a suspended daily CronJob, access failure or wrong target. A later complete backup clears an older failure. Restore drills remain required. Application uptime, node health, disk use and TLS are outside this checker's scope.

Enable GitHub Actions failed-workflow email notifications for the account responsible for scheduled runs. Scheduling may be delayed or dropped; no run means no failure notification. This monitor does not deduplicate repeated failures. Review recent successful runs periodically.

Run local tests with `python3 -B scripts/test_backup_health.py`. Set `OCI_BACKUP_MONITOR_ENABLED=false` to stop health queries; backup Jobs are unaffected. See [operations](oci-operations.md#github-actions-backup-alerts).
