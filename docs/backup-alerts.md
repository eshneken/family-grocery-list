# Production backup alerts

The hourly Always Free backup-health workflow checks only the new grocery tenancy (iddiywf0v4j6) and its pinned OKE cluster. It uses an isolated federation action so legacy production deployment authentication remains unchanged. No infrastructure is provisioned and no database/archive contents are read.

Set OCI_BACKUP_MONITOR_ENABLED=true in the always-free environment after production cutover and daily backup activation. The environment must permit master for this scheduled job. Leave the migration branch unmerged until its separate retirement checkpoint.

Checks fail on stale (>30 hours), missing, incomplete or empty backups, excessive completed retention (>5), newer failed Jobs, stuck Jobs (>40 minutes), a suspended daily CronJob, or an access failure. A later complete backup clears an older failure. Restore drills remain required. Application uptime, node health, disk use and TLS are outside this checker’s scope.

Enable GitHub Actions email notifications for failed workflows only. The operator confirmed receipt of a controlled failure notification on October 8, 2026. Scheduling may be delayed or dropped; no run means no failure notification. Scheduled notification ownership follows GitHub’s schedule actor rules. This monitor does not deduplicate repeated failures.

Tests: python3 -B scripts/test_backup_health.py. Stop monitoring with OCI_BACKUP_MONITOR_ENABLED=false; backup Jobs are unaffected.
