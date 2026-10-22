"""Exercise CIDR rejection, scoped plan checks, and runner lease cleanup failures."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch, Mock

from oci_admin_cidrs import parse
from oci_target_fixture import TARGET
import oke_ci_access as access

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('network_guard', ROOT / 'scripts/check-always-free-plan.py')
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)


def rule(source='203.0.113.14/32', description='test-lease'):
    return {'id': 'lease-id', 'description': description, 'direction': 'INGRESS', 'protocol': '6',
            'source-type': 'CIDR_BLOCK', 'source': source,
            'tcp-options': {'destination-port-range': {'min': 6443, 'max': 6443}}}


class NetworkAccessTests(unittest.TestCase):
    def test_admin_configuration_fails_closed(self):
        self.assertEqual(parse('["203.0.113.14/32", "203.0.113.14/32"]'), ['203.0.113.14/32'])
        for raw in ['', '[]', '{}', 'null', '"203.0.113.14/32"', '[1]', '["0.0.0.0/0"]',
                    '["203.0.113.14/24"]', '["::/0"]', '["bad"]']:
            with self.subTest(raw=raw), self.assertRaises(ValueError):
                parse(raw)

    def test_only_obsolete_api_rules_can_be_deleted(self):
        change = {'mode': 'managed', 'type': 'oci_core_network_security_group_security_rule',
                  'address': 'oci_core_network_security_group_security_rule.api_public_ingress["old"]',
                  'change': {'actions': ['delete'], 'after': None}}
        plan = {'resource_changes': [change]}
        guard.check(plan, target=TARGET, network_access_only=True)
        for address in ['oci_core_network_security_group_security_rule.lb_https',
                        'oci_core_network_security_group.oke_api']:
            change['address'] = address
            with self.assertRaises(ValueError):
                guard.check(plan, target=TARGET, network_access_only=True)

    def test_network_only_plan_rejects_unrelated_updates(self):
        plan = {'resource_changes': [{'mode': 'managed', 'type': 'oci_core_vcn',
                'address': 'oci_core_vcn.grocery', 'change': {'actions': ['update'], 'after': {}}}]}
        with self.assertRaisesRegex(ValueError, 'unrelated'):
            guard.check(plan, target=TARGET, network_access_only=True)

    def test_api_rule_must_match_config_and_port(self):
        after = {'source': '203.0.113.14/32', 'direction': 'INGRESS', 'protocol': '6',
                 'source_type': 'CIDR_BLOCK',
                 'tcp_options': [{'destination_port_range': [{'min': 6443, 'max': 6443}]}]}
        plan = {'variables': {'admin_cidrs': {'value': ['203.0.113.14/32']}},
                'resource_changes': [{'mode': 'managed', 'type': 'oci_core_network_security_group_security_rule',
                 'address': 'oci_core_network_security_group_security_rule.api_public_ingress["new"]',
                 'change': {'actions': ['create'], 'after': after}}]}
        guard.check(plan, target=TARGET, network_access_only=True)
        after['source'] = '0.0.0.0/0'
        with self.assertRaisesRegex(ValueError, 'reviewed'):
            guard.check(plan, target=TARGET, network_access_only=True)
        after['source'] = '203.0.113.14/32'
        after['tcp_options'][0]['destination_port_range'][0]['max'] = 65535
        with self.assertRaises(ValueError):
            guard.check(plan, target=TARGET, network_access_only=True)

    def test_cleanup_cannot_remove_admin_or_other_job_rules(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'lease.json'
            path.write_text(json.dumps({'nsg': 'approved', 'description': 'test-lease', 'cidr': '203.0.113.14/32'}))
            rules = [rule(), rule(description='test-lease-other-job'), rule(source='203.0.113.0/24')]
            with patch.object(access, 'load_target', return_value=TARGET), patch.object(access, 'api_nsg', return_value='approved'), patch.object(access, 'oci', return_value=rules), patch.object(access, 'remove') as remove:
                access.close_access(path)
                remove.assert_called_once_with('approved', ['lease-id'])
            self.assertFalse(path.exists())

    def test_cleanup_failure_retains_marker_for_recovery(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'lease.json'
            path.write_text(json.dumps({'nsg': 'approved', 'description': 'test-lease', 'cidr': '203.0.113.14/32'}))
            with patch.object(access, 'load_target', return_value=TARGET), patch.object(access, 'api_nsg', return_value='approved'), patch.object(access, 'oci', return_value=[rule()]), patch.object(access, 'remove', side_effect=RuntimeError('denied')):
                with self.assertRaises(RuntimeError):
                    access.close_access(path)
            self.assertTrue(path.exists())

    def test_lost_add_response_keeps_cleanup_marker(self):
        response = Mock()
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        response.read.return_value = '.'.join(['8'] * 4).encode()
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'lease.json'
            with patch.dict(os.environ, {'GITHUB_REPOSITORY': 'example/repository'}), patch.object(access, 'load_target', return_value=TARGET), patch.object(access, 'api_nsg', return_value='approved'), patch.object(access, 'oci', side_effect=[[], RuntimeError('lost response')]), patch.object(access, 'urlopen', return_value=response):
                with self.assertRaises(RuntimeError):
                    access.open_access(path)
            self.assertEqual(json.loads(path.read_text())['nsg'], 'approved')

    def test_bastion_security_list_has_only_worker_ssh_egress(self):
        rule = {'protocol': '6', 'destination_type': 'CIDR_BLOCK', 'destination': '10.40.10.0/24',
                'stateless': False, 'tcp_options': [{'min': 22, 'max': 22}]}
        after = {'ingress_security_rules': [], 'egress_security_rules': [rule]}
        plan = {'variables': {'worker_subnet_cidr': {'value': '10.40.10.0/24'}},
                'resource_changes': [{'mode': 'managed', 'type': 'oci_core_security_list',
                 'address': 'oci_core_security_list.bastion',
                 'change': {'actions': ['create'], 'after': after}}]}
        guard.check(plan, target=TARGET)
        for field, value in [('destination', '0.0.0.0/0'), ('protocol', 'all'), ('stateless', True),
                             ('tcp_options', [{'min': 22, 'max': 65535}])]:
            saved = rule[field]
            rule[field] = value
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, 'SSH egress'):
                guard.check(plan, target=TARGET)
            rule[field] = saved
        after['ingress_security_rules'] = [{'source': '0.0.0.0/0'}]
        with self.assertRaises(ValueError):
            guard.check(plan, target=TARGET)

    def test_worker_ssh_must_come_from_bastion_subnet(self):
        after = {'direction': 'INGRESS', 'protocol': '6', 'source_type': 'CIDR_BLOCK',
                 'source': '10.40.40.0/28', 'stateless': False,
                 'tcp_options': [{'destination_port_range': [{'min': 22, 'max': 22}]}]}
        plan = {'variables': {'bastion_subnet_cidr': {'value': '10.40.40.0/28'}},
                'resource_changes': [{'mode': 'managed', 'type': 'oci_core_network_security_group_security_rule',
                 'address': 'oci_core_network_security_group_security_rule.workers_ssh_from_bastion',
                 'change': {'actions': ['create'], 'after': after}}]}
        guard.check(plan, target=TARGET)
        after['source'] = '0.0.0.0/0'
        with self.assertRaisesRegex(ValueError, 'Bastion subnet only'):
            guard.check(plan, target=TARGET)
        after['source'] = '10.40.40.0/28'
        after['tcp_options'][0]['destination_port_range'][0]['max'] = 6443
        with self.assertRaises(ValueError):
            guard.check(plan, target=TARGET)

    def test_cidr_maintenance_cannot_create_bastion_ssh_path(self):
        plan = {'resource_changes': [{'mode': 'managed', 'type': 'oci_core_security_list',
                'address': 'oci_core_security_list.bastion',
                'change': {'actions': ['create'], 'after': {}}}]}
        with self.assertRaisesRegex(ValueError, 'unrelated'):
            guard.check(plan, target=TARGET, network_access_only=True)


if __name__ == '__main__':
    unittest.main()
