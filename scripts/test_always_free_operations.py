"""Check migration cost boundaries and backup recovery/retention behavior."""
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import Mock


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


ROOT = Path(__file__).resolve().parent.parent
backup = load('backup', ROOT / 'deploy/backup/backup.py')
guard = load('guard', ROOT / 'scripts/check-always-free-plan.py')


class SafetyTests(unittest.TestCase):
    def plan(self, typ, after, actions=None):
        return {'resource_changes': [{'mode': 'managed', 'address': typ + '.grocery', 'type': typ,
                                      'change': {'after': after, 'actions': actions or ['create']}}]}

    def test_paid_database_and_worker_substitution_rejected(self):
        with self.assertRaisesRegex(ValueError, 'Unapproved'):
            guard.check(self.plan('oci_psql_db_system', {}))
        node = {'node_shape': 'VM.Standard.A1.Flex', 'node_shape_config': [{'ocpus': 2, 'memory_in_gbs': 12}],
                'node_config_details': [{'size': 1}], 'node_source_details': [{'boot_volume_size_in_gbs': 50}],
                'node_metadata': {'areLegacyImdsEndpointsDisabled': 'true'}}
        guard.check(self.plan('oci_containerengine_node_pool', node))
        for field, value in [('node_shape', 'VM.Standard.E5.Flex'), ('node_metadata', {})]:
            with self.assertRaises(ValueError):
                guard.check(self.plan('oci_containerengine_node_pool', dict(node, **{field: value})))
        node['node_config_details'][0]['size'] = 2
        with self.assertRaisesRegex(ValueError, 'envelope'):
            guard.check(self.plan('oci_containerengine_node_pool', node))

    def test_wrong_compartment_and_replacement_rejected(self):
        with self.assertRaisesRegex(ValueError, 'another tenancy'):
            guard.check(self.plan('oci_core_vcn', {'compartment_id': 'legacy'}))
        with self.assertRaisesRegex(ValueError, 'replacement'):
            guard.check(self.plan('oci_core_vcn', {}, ['delete', 'create']))

    def test_backup_keeps_five_and_ignores_partial_archives(self):
        client = Mock()
        names = ['postgres/2026100' + str(day) + 'T090000Z-' + 'a' * 32 + '.json' for day in range(1, 8)]
        backup.prune(client, 'namespace', 'bucket', names[::-1] + ['postgres/partial.dump.age', 'unrelated.json'])
        self.assertEqual(client.delete_object.call_count, 4)
        self.assertEqual(client.delete_object.call_args_list[0].args[2], names[0])
        self.assertEqual(client.delete_object.call_args_list[1].args[2], names[0][:-5] + '.dump.age')

    def test_retention_stops_on_failed_marker_deletion(self):
        client = Mock()
        client.delete_object.side_effect = RuntimeError('simulated denied deletion')
        names = ['postgres/2026100' + str(day) + 'T090000Z-' + 'a' * 32 + '.json' for day in range(1, 7)]
        with self.assertRaises(RuntimeError):
            backup.prune(client, 'namespace', 'bucket', names)
        self.assertEqual(client.delete_object.call_count, 1)

    def test_backup_refuses_plaintext_or_wrong_database_endpoint(self):
        for url in ['postgresql://backup:password@public.example/postgres?sslmode=verify-full',
                    'postgresql://backup:password@postgres.grocery.svc.cluster.local/postgres?sslmode=disable']:
            with self.assertRaises(ValueError):
                backup.database_env(url)
        env = backup.database_env('postgresql://grocery_backup:p%40ss@postgres.grocery.svc.cluster.local/postgres?sslmode=verify-full')
        self.assertEqual(env['PGPASSWORD'], 'p@ss')
        self.assertEqual(env['PGSSLMODE'], 'verify-full')


if __name__ == '__main__':
    unittest.main()
