# Shopping session timeout

Shopping runs become eligible for automatic completion four elapsed hours after `ShoppingTrip.startedAt`. Activity does not reset that time. The production Kubernetes CronJob checks every 15 minutes, so normal completion occurs at about four to four-and-a-quarter hours. There is no hard four-hour cutoff in the browser or purchase actions.

Automatic completion uses the manual completion logic: purchased, substituted, and rejected rows are preserved; pending rows from every store are marked carried forward and copied into the existing collecting list. Existing equivalent item/store requests prevent duplicate copies. The original shopper remains associated with the trip and audit outcomes; automatic carry-forward notes explicitly identify the system action. History labels the trip “Automatically completed after 4 hours.” `completedAt` records when completion actually ran.

Starting a new run first closes an overdue blocking run in the same transaction. Shopper Mode offers store selection for an overdue run while keeping the original shopper's purchase/completion controls available until actual completion. A recent active run still prevents another shopper from starting. Household row locks serialize request additions/edits, starting, recording outcomes, and both forms of completion across processes, preventing duplicate requests during carry-forward. The scheduled sweep rechecks each candidate after locking and safely skips runs already completed. Stale purchase forms cannot update a completed list; completion forms include the specific trip ID so they cannot close a replacement run. Existing foreground/navigation refresh behavior updates returning phones.

## Compatibility

The additive migration adds `ShoppingTrip.completionReason` with `manual` as the default, preserving existing history and older application writes. An index on `(status, startedAt)` supports the bounded overdue lookup without scanning shopping list history. Existing overdue active runs are eligible on the first sweep; no timestamp backfill or new list creation is necessary.

## Scheduling and operations

`deploy/k8s/application/shopping-timeout.yaml` is deployed alongside the app with the same immutable image digest. It runs `npm run shopping:expire` at quarter-hour intervals, forbids overlapping executions, retries a failed job once, and imposes a five-minute execution limit. It uses the existing database secret and TLS CA mount without Kubernetes API credentials. Each sweep processes at most 100 overdue runs, oldest first; larger backlogs continue on subsequent sweeps. After downtime, overdue runs remain eligible and are picked up when scheduling resumes. A failure rolls back that trip and exits unsuccessfully; already completed transactions are safe to revisit on retry.

The command logs one JSON summary with scanned/completed counts on success, or a generic failure message with nonzero exit status.

The manifest defaults to suspended. The deployment script suspends any existing scheduler before migrations, applies the new image while suspended, and enables scheduling only after the web rollout and external readiness check both pass. Failed deployments and rollback leave scheduling suspended; retry the deployment after resolving the failure to enable it. Suspension prevents future jobs but does not cancel an already-running job or reopen completed trips. Rolling back the web image does not undo completion or the additive migration. Applying the manifest manually without the deployment script leaves cleanup paused.

Observe scheduling and failures with:

```sh
kubectl --namespace grocery get cronjob grocery-shopping-timeout
kubectl --namespace grocery get jobs
kubectl --namespace grocery logs job/<job-name>
```

For a one-shot local check, pass the local `DATABASE_URL` to `npm run shopping:expire`. This checks expiration logic but does not validate Kubernetes scheduling or deployment. Testing the actual scheduled deployment requires deploying the production image and CronJob into a Kubernetes test environment with a separate database. `npm run dev` starts only the web app.

## Verification

Database tests cover the four-hour boundary, activity without extension, catch-up, preserved outcomes, store-specific duplicate handling, repeated/concurrent sweeps and manual completion, household isolation, batch limits, transaction rollback/retry, starting over an expired run, and stale form rejection. Browser E2E runs on Desktop Chrome and Mobile Safari with fixture timestamps aged in the database. It verifies automatic history labeling, purchased counts, carried-forward requests, and starting the next run. Coverage floors remain 95% in all four metrics.

Deployment-script tests exercise first deployment, an existing scheduler, migration/application/rollout/readiness failures, and failed activation. They assert that scheduling is never enabled before readiness and remains suspended on failure. These command-level tests do not substitute for observing the deployed Kubernetes CronJob.
