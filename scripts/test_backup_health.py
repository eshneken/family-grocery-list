"""Behavior tests for backup freshness, failed Jobs and target isolation."""
import datetime
import importlib.util
import pathlib
import unittest

spec = importlib.util.spec_from_file_location("monitor", pathlib.Path(__file__).with_name("check-backup-health.py"))
monitor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(monitor)
NOW = datetime.datetime(2026, 10, 8, 14, tzinfo=datetime.timezone.utc)


def objects(timestamp="20261008T090000Z", created=None):
    base = "postgres/" + timestamp + "-" + "a" * 32
    manifest = {"name": base + ".json"}
    if created:
        manifest["time-created"] = created
    return [manifest, {"name": base + ".dump.age", "size": 200}]


def job(start, failed=False, active=False, transition=None):
    condition = {"type": "Failed", "status": "True"}
    if transition:
        condition["lastTransitionTime"] = transition
    return {
        "metadata": {"name": "grocery-backup", "labels": {"task": "postgres-backup"}},
        "status": {"startTime": start, "active": int(active), "conditions": [condition] if failed else []},
    }


class Health(unittest.TestCase):
    def test_fresh_complete_backup(self):
        self.assertTrue(monitor.evaluate(objects(), [], NOW)["healthy"])

    def test_stale_backup(self):
        self.assertFalse(monitor.evaluate(objects("20261007T070000Z"), [], NOW)["healthy"])

    def test_future_timestamp(self):
        self.assertFalse(monitor.evaluate(objects("20261009T090000Z"), [], NOW)["healthy"])

    def test_missing_archive(self):
        self.assertFalse(monitor.evaluate(objects()[:1], [], NOW)["healthy"])

    def test_empty_archive(self):
        data = objects()
        data[1]["size"] = 0
        self.assertFalse(monitor.evaluate(data, [], NOW)["healthy"])

    def test_failure_after_success(self):
        jobs = [job("2026-10-08T10:00:00Z", failed=True)]
        self.assertFalse(monitor.evaluate(objects(), jobs, NOW)["healthy"])

    def test_prune_failure_after_own_upload(self):
        jobs = [job("2026-10-08T09:00:00Z", failed=True, transition="2026-10-08T09:02:00Z")]
        data = objects(created="2026-10-08T09:01:00Z")
        self.assertFalse(monitor.evaluate(data, jobs, NOW)["healthy"])
        # A later fully successful upload clears the earlier failure.
        data = objects("20261008T100000Z", created="2026-10-08T10:01:00Z")
        self.assertTrue(monitor.evaluate(data, jobs, NOW)["healthy"])

    def test_failure_recovered_by_success(self):
        jobs = [job("2026-10-08T08:00:00Z", failed=True)]
        self.assertTrue(monitor.evaluate(objects(), jobs, NOW)["healthy"])

    def test_job_stuck(self):
        jobs = [job("2026-10-08T13:00:00Z", active=True)]
        self.assertFalse(monitor.evaluate(objects(), jobs, NOW)["healthy"])

    def test_other_job_ignored(self):
        other = job("2026-10-08T10:00:00Z", failed=True)
        other["metadata"]["labels"]["task"] = "unrelated"
        self.assertTrue(monitor.evaluate(objects(), [other], NOW)["healthy"])

    def test_retention_limit(self):
        data = sum([objects(f"20261008T0{hour}0000Z") for hour in range(1, 7)], [])
        self.assertFalse(monitor.evaluate(data, [], NOW)["healthy"])

    def test_no_complete_backups(self):
        self.assertFalse(monitor.evaluate([], [], NOW)["healthy"])

    def test_object_list_response_variants(self):
        self.assertEqual(monitor.object_list('{"data": []}'), [])
        self.assertEqual(monitor.object_list('{"data": {"objects": []}}'), [])
        self.assertEqual(monitor.object_list(''), [])
        with self.assertRaises(ValueError):
            monitor.object_list('{"data": null}')

    def test_target_cluster_is_exact(self):
        config = {"contexts": [{"name": "target", "context": {"user": "operator"}}],
                  "users": [{"name": "operator", "user": {"exec": {"args": ["--cluster-id", monitor.CLUSTER_ID]}}}]}
        monitor.verify_target(config, "target")
        config["users"][0]["user"]["exec"]["args"] = ["--cluster-id", "other-cluster", monitor.CLUSTER_ID]
        with self.assertRaises(ValueError):
            monitor.verify_target(config, "target")


if __name__ == "__main__":
    unittest.main()
