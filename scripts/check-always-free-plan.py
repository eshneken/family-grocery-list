"""Reject unexpected cost-bearing resources, replacements and wrong target plans."""
import json
import os
import sys

from oci_target import load_target
ALLOWED_OCI = {
    'oci_kms_vault', 'oci_kms_key', 'oci_objectstorage_bucket', 'oci_vault_secret',
    'oci_containerengine_cluster', 'oci_containerengine_node_pool', 'oci_bastion_bastion',
    'oci_core_vcn', 'oci_core_subnet', 'oci_core_route_table', 'oci_core_internet_gateway',
    'oci_core_nat_gateway', 'oci_core_service_gateway', 'oci_core_public_ip',
    'oci_core_security_list', 'oci_core_network_security_group',
    'oci_core_network_security_group_security_rule',
    'oci_identity_tag_namespace', 'oci_identity_tag', 'oci_identity_dynamic_group', 'oci_identity_policy',
}


def check(plan, nodepool_retry_only=False, target=None):
    target = target or load_target(allow_unprovisioned_cluster=True)
    for key in ("tenancy_ocid", "compartment_ocid", "region"):
        if key in plan.get("variables", {}) and plan["variables"][key]["value"] != target[key]:
            raise ValueError("Plan inputs differ from the approved target")
    changes = []
    for resource in plan.get('resource_changes', []):
        if resource.get('mode') != 'managed':
            continue
        typ = resource['type']
        change = resource['change']
        after = change.get('after') or {}
        if nodepool_retry_only and change['actions'] != ['no-op']:
            if not (resource['address'] == 'oci_containerengine_node_pool.grocery'
                    and typ == 'oci_containerengine_node_pool' and change['actions'] == ['create']):
                raise ValueError('Node-pool retry forbids other resource changes: ' + resource['address'])
        if 'delete' in change['actions']:
            raise ValueError('Deletion/replacement requires separate reviewed maintenance: ' + resource['address'])
        if typ.startswith('oci_') and typ not in ALLOWED_OCI:
            raise ValueError('Unapproved OCI resource type: ' + typ)
        compartment = after.get('compartment_id')
        if compartment and compartment not in (target['tenancy_ocid'], target['compartment_ocid']):
            raise ValueError('Resource targets another tenancy/compartment')
        if typ == 'oci_containerengine_cluster' and after.get('type') != 'BASIC_CLUSTER':
            raise ValueError('Cluster must be Basic')
        if typ == 'oci_containerengine_node_pool':
            shape = after['node_shape_config'][0]
            if (after['node_shape'], shape['ocpus'], shape['memory_in_gbs'], after['node_config_details'][0]['size'],
                str(after['node_source_details'][0]['boot_volume_size_in_gbs'])) != ('VM.Standard.A1.Flex', 2, 12, 1, '50'):
                raise ValueError('Worker exceeds the Always Free envelope')
            if after.get('node_metadata', {}).get('areLegacyImdsEndpointsDisabled') != 'true':
                raise ValueError('IMDSv1 must be disabled at launch')
        if typ == 'oci_kms_vault' and after.get('vault_type') != 'DEFAULT':
            raise ValueError('Only DEFAULT Vault is allowed')
        if typ == 'oci_kms_key' and after.get('protection_mode') != 'SOFTWARE':
            raise ValueError('Only SOFTWARE keys are allowed')
        if typ == 'kubernetes_persistent_volume_claim_v1':
            spec = after['spec'][0]
            if spec['resources'][0]['requests']['storage'] != '50Gi' or spec['access_modes'] != ['ReadWriteOnce']:
                raise ValueError('Shared claim must be 50Gi ReadWriteOnce')
        if typ == 'kubernetes_service_v1' and after['spec'][0]['type'] == 'LoadBalancer':
            annotations = after['metadata'][0]['annotations']
            for key in ['service.beta.kubernetes.io/oci-load-balancer-shape-flex-min', 'service.beta.kubernetes.io/oci-load-balancer-shape-flex-max']:
                if annotations.get(key) != '10':
                    raise ValueError('Load balancer must be fixed at 10 Mbps')
            if annotations.get('service.beta.kubernetes.io/oci-load-balancer-backend-protocol') != 'TCP':
                raise ValueError('TLS must pass through the LB to Caddy')
        if change['actions'] != ['no-op']:
            changes.append(resource['address'] + ': ' + ','.join(change['actions']))
    return changes


if __name__ == '__main__':
    try:
        changes = check(json.load(sys.stdin), nodepool_retry_only=os.environ.get('ALWAYS_FREE_NODEPOOL_RETRY_ONLY') == 'true')
        print('Always Free plan guard passed. Proposed resource changes:')
        print('\n'.join(changes) or '(none)')
    except (ValueError, KeyError, TypeError) as error:
        sys.exit('Plan rejected: ' + str(error))
