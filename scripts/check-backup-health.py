"""Inspect encrypted backup metadata and Kubernetes Jobs without reading backup data."""
import argparse
import datetime
import json
import pathlib
import re
import subprocess
import sys

UTC = datetime.timezone.utc
from oci_target import load_target
PATTERN = re.compile(r"^postgres/(\d{8}T\d{6}Z-[a-f0-9]{32})\.(json|dump\.age)$")


def time_value(value):
    result = datetime.datetime.fromisoformat(value.replace("Z", "+00:00"))
    if result.tzinfo is None:
        raise ValueError("Timestamp must include a timezone")
    return result


def evaluate(objects, jobs, now):
    by_name = {obj["name"]: obj for obj in objects}
    completed = []
    issues = []
    for name, obj in by_name.items():
        match = PATTERN.fullmatch(name)
        if not match or match[2] != "json":
            continue
        archive = by_name.get(name[:-5] + ".dump.age")
        if archive is None:
            issues.append("Completion manifest is missing its archive.")
            continue
        if "size" in archive and int(archive["size"]) <= 0:
            issues.append("Encrypted backup archive is empty.")
            continue
        started = datetime.datetime.strptime(match[1][:16], "%Y%m%dT%H%M%SZ").replace(tzinfo=UTC)
        created = obj.get("time-created", obj.get("timeCreated"))
        completed.append((started, time_value(created) if created else started))
    latest = max(completed, default=None)
    if latest is None:
        issues.append("No complete encrypted backup exists.")
    elif latest[0] > now + datetime.timedelta(minutes=5) or latest[1] > now + datetime.timedelta(minutes=5):
        issues.append("Latest backup timestamp is in the future.")
    elif now - latest[0] > datetime.timedelta(hours=30):
        issues.append("Latest complete backup is older than 30 hours.")
    if len(completed) > 5:
        issues.append("More than five complete backups remain.")
    for job in jobs:
        metadata = job.get("metadata", {})
        if metadata.get("labels", {}).get("task") != "postgres-backup":
            continue
        status = job.get("status", {})
        start = status.get("startTime")
        failures = [condition for condition in status.get("conditions", [])
                    if condition.get("type") == "Failed" and condition.get("status") == "True"]
        if failures:
            failed_at = failures[0].get("lastTransitionTime") or status.get("completionTime") or start
            if not failed_at or latest is None or time_value(failed_at) >= latest[1]:
                issues.append("Backup Job failed after the latest complete backup: " + metadata["name"])
        if status.get("active"):
            if not start or now - time_value(start) > datetime.timedelta(minutes=40):
                issues.append("Backup Job is active beyond its runtime limit: " + metadata["name"])
    return {
        "healthy": not issues,
        "issues": issues,
        "complete_backups": len(completed),
        "latest_backup_utc": latest[0].isoformat() if latest else None,
        "backup_age_hours": round((now - latest[0]).total_seconds() / 3600, 2) if latest else None,
    }


def verify_target(config, context_name, target=None):
    target = target or load_target()
    context = next(c["context"] for c in config["contexts"] if c["name"] == context_name)
    user = next(u["user"] for u in config["users"] if u["name"] == context["user"])
    args = user["exec"]["args"]
    cluster_args = [args[i + 1] for i, value in enumerate(args[:-1]) if value == "--cluster-id"]
    if cluster_args != [target['cluster_ocid']]:
        raise ValueError("Unexpected target cluster")


def object_list(response):
    data = json.loads(response)["data"] if response.strip() else []
    if isinstance(data, dict):
        data = data["objects"]
    if not isinstance(data, list):
        raise ValueError("Unexpected Object Storage response")
    return data


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--kubeconfig", required=True)
    parser.add_argument("--context", required=True)
    parser.add_argument("--kubectl", default="kubectl")
    parser.add_argument("--oci-profile", required=True)
    parser.add_argument("--oci-auth", choices=["api_key", "security_token"], default="api_key")
    parser.add_argument("--allow-suspended", action="store_true", help="Permit a deliberately paused installation/recovery check")
    parser.add_argument("--report")
    args = parser.parse_args()
    target = load_target()

    def run(command):
        result = subprocess.run(command, capture_output=True, text=True, timeout=60)
        if result.returncode:
            # CLI stderr may contain authentication details; never copy it to Actions logs.
            raise RuntimeError("Read-only monitor query failed")
        return result.stdout

    identity = ["--profile", args.oci_profile, "--auth", args.oci_auth, "--region", "us-ashburn-1"]
    if json.loads(run(["oci", "os", "ns", "get"] + identity))["data"] != target['namespace']:
        raise ValueError("Unexpected tenancy namespace")
    kube = [args.kubectl, "--kubeconfig", args.kubeconfig, "--context", args.context, "-n", "grocery"]
    verify_target(json.loads(run(kube + ["config", "view", "-o", "json"])), args.context, target)
    objects = object_list(run(["oci", "os", "object", "list", "--namespace-name", target["namespace"],
                               "--bucket-name", target["backup_bucket"], "--all"] + identity))
    jobs = json.loads(run(kube + ["get", "jobs", "-o", "json"]))["items"]
    cron = json.loads(run(kube + ["get", "cronjob", "grocery-postgres-backup", "-o", "json"]))
    result = evaluate(objects, jobs, datetime.datetime.now(UTC))
    result["daily_schedule_suspended"] = cron["spec"].get("suspend", False)
    if result["daily_schedule_suspended"] and not args.allow_suspended:
        result["issues"].append("Daily backup schedule is suspended.")
        result["healthy"] = False
    if args.report:
        pathlib.Path(args.report).write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))
    return 0 if result["healthy"] else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (RuntimeError, ValueError, KeyError, TypeError, IndexError, StopIteration, OSError,
            subprocess.TimeoutExpired):
        print("Backup monitor could not verify health; inspect authenticated operator access.", file=sys.stderr)
        sys.exit(1)
