"""Private configuration and cross-target rejection regressions."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from oci_target import load_target, exports
from oci_target_fixture import TARGET

spec = importlib.util.spec_from_file_location('guard', Path(__file__).with_name('check-always-free-plan.py'))
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)


class TargetTests(unittest.TestCase):
    def test_each_federated_job_loads_private_config_before_authentication(self):
        root = Path(__file__).resolve().parent.parent
        import re
        for name in ['application.yml', 'oci-infrastructure.yml', 'oci-wif-verify.yml', 'always-free-backup-health.yml']:
            source = (root / '.github/workflows' / name).read_text()
            for job in re.split(r'^  [a-zA-Z0-9_-]+:\n', source, flags=re.M):
                auth = re.search(r'uses: \./\.github/actions/setup-(?:oci|always-free-monitor)-wif', job)
                if auth:
                    self.assertIn('environment: always-free', job)
                    self.assertLess(job.index('uses: ./.github/actions/load-oci-target'), auth.start())
        application = (root / '.github/workflows/application.yml').read_text()
        container = application.split('  container:', 1)[1].split('  deploy:', 1)[0]
        self.assertNotIn('secrets.OCI_TARGET_CONFIG', container)

    def test_no_implicit_identity_or_profile_fallback(self):
        with patch.dict(os.environ, {}, clear=True), self.assertRaises(ValueError):
            load_target()

    def test_missing_values_and_wrong_identifier_types_fail(self):
        for change in [{'namespace': ''}, {'compartment_ocid': TARGET['tenancy_ocid']},
                       {'region': 'us-phoenix-1'}, {'wif_domain_url': 'http://identity.example.com'},
                       {'namespace': 'value\nENV=injection'}]:
            with patch.dict(os.environ, {'OCI_TARGET_CONFIG_JSON': json.dumps(TARGET | change)}), self.assertRaises(ValueError):
                load_target()

    def test_initial_setup_requires_explicit_null_cluster_permission(self):
        target = TARGET | {'cluster_ocid': None}
        with patch.dict(os.environ, {'OCI_TARGET_CONFIG_JSON': json.dumps(target)}):
            with self.assertRaises(ValueError):
                load_target()
            self.assertEqual(load_target(allow_unprovisioned_cluster=True), target)
            self.assertNotIn('OCI_CLUSTER_OCID', exports(target))

    def test_initial_setup_does_not_relax_other_target_checks(self):
        for change in [{'cluster_ocid': ''}, {'cluster_ocid': TARGET['tenancy_ocid']},
                       {'cluster_ocid': None, 'compartment_ocid': TARGET['tenancy_ocid']}]:
            with patch.dict(os.environ, {'OCI_TARGET_CONFIG_JSON': json.dumps(TARGET | change)}):
                with self.assertRaises(ValueError):
                    load_target(allow_unprovisioned_cluster=True)

    def test_template_matches_private_schema(self):
        template = json.loads((Path(__file__).resolve().parent.parent / 'docs/oci-target.example.json').read_text())
        self.assertEqual(set(template), set(TARGET))
        self.assertIsNone(template['cluster_ocid'])

    def test_private_file_permissions_required(self):
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / 'target.json'
            file.write_text(json.dumps(TARGET))
            with patch.dict(os.environ, {'OCI_TARGET_CONFIG_FILE': str(file)}, clear=True):
                file.chmod(0o644)
                with self.assertRaises(ValueError):
                    load_target()
                file.chmod(0o600)
                self.assertEqual(load_target(), TARGET)

    def test_var_file_cannot_override_approved_identity(self):
        plan = {'variables': {'tenancy_ocid': {'value': 'other'}}, 'resource_changes': []}
        with self.assertRaisesRegex(ValueError, 'Plan inputs'):
            guard.check(plan, target=TARGET)

    def test_noop_resource_in_another_compartment_is_rejected(self):
        plan = {'resource_changes': [{'mode': 'managed', 'address': 'oci_core_vcn.example',
                'type': 'oci_core_vcn', 'change': {'actions': ['no-op'], 'after': {'compartment_id': 'other'}}}]}
        with self.assertRaisesRegex(ValueError, 'another tenancy'):
            guard.check(plan, target=TARGET)


if __name__ == '__main__':
    unittest.main()
