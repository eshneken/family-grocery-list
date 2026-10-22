"""Reject unexpected cost-bearing resources, replacements and wrong target plans."""
import json
import os
import sys

from oci_target import load_target
from oci_admin_cidrs import parse as parse_admin_cidrs
ALLOWED_OCI = {
    'oci_kms_vault', 'oci_kms_key', 'oci_objectstorage_bucket', 'oci_vault_secret',
    'oci_containerengine_cluster', 'oci_containerengine_node_pool', 'oci_bastion_bastion',
    'oci_core_vcn', 'oci_core_subnet', 'oci_core_route_table', 'oci_core_internet_gateway',
    'oci_core_nat_gateway', 'oci_core_service_gateway', 'oci_core_public_ip',
    'oci_core_security_list', 'oci_core_network_security_group',
    'oci_core_network_security_group_security_rule',
    'oci_identity_tag_namespace', 'oci_identity_tag', 'oci_identity_dynamic_group', 'oci_identity_policy',
}


def check(plan, nodepool_retry_only=False, target=None, network_access_only=False):
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
        api_rule = (typ == 'oci_core_network_security_group_security_rule'
                    and resource['address'].startswith('oci_core_network_security_group_security_rule.api_public_ingress['))
        bastion = typ == 'oci_bastion_bastion' and resource['address'] == 'oci_bastion_bastion.grocery[0]'
        if network_access_only and change['actions'] != ['no-op']:
            if not (api_rule or (bastion and change['actions'] == ['update'])):
                raise ValueError('Network access update forbids unrelated resource changes: ' + resource['address'])
        if bastion and after:
            allowed = parse_admin_cidrs(json.dumps(plan.get('variables', {}).get('admin_cidrs', {}).get('value')))
            actual = parse_admin_cidrs(json.dumps(after.get('client_cidr_block_allow_list')))
            if set(actual) != set(allowed):
                raise ValueError('Bastion client allowlist must match the reviewed administrative CIDRs')
            if after.get('bastion_type') != 'STANDARD' or after.get('max_session_ttl_in_seconds') != 3600:
                raise ValueError('Bastion must be STANDARD with a maximum session TTL of one hour')
        if api_rule and after:
            allowed = parse_admin_cidrs(json.dumps(plan.get('variables', {}).get('admin_cidrs', {}).get('value')))
            ports = after.get('tcp_options', [{}])[0].get('destination_port_range', [{}])[0]
            if (after.get('direction'), after.get('protocol'), after.get('source_type'),
                ports.get('min'), ports.get('max')) != ('INGRESS', '6', 'CIDR_BLOCK', 6443, 6443) or after.get('source') not in allowed:
                raise ValueError('API ingress must match the reviewed administrative CIDRs on TCP 6443')
        if resource['address'] == 'oci_core_security_list.bastion' and after:
            rules = after.get('egress_security_rules', [])
            rule = rules[0] if len(rules) == 1 else {}
            ports = rule.get('tcp_options', [{}])[0]
            worker_cidr = plan.get('variables', {}).get('worker_subnet_cidr', {}).get('value')
            if (after.get('ingress_security_rules') or len(rules) != 1 or not worker_cidr
                    or (rule.get('protocol'), rule.get('destination_type'), rule.get('destination'),
                        rule.get('stateless'), ports.get('min'), ports.get('max'))
                    != ('6', 'CIDR_BLOCK', worker_cidr, False, 22, 22)):
                raise ValueError('Bastion security list must allow only stateful worker SSH egress and no ingress')
        if resource['address'] == 'oci_core_network_security_group_security_rule.workers_ssh_from_bastion' and after:
            ports = after.get('tcp_options', [{}])[0].get('destination_port_range', [{}])[0]
            bastion_cidr = plan.get('variables', {}).get('bastion_subnet_cidr', {}).get('value')
            if (not bastion_cidr or (after.get('direction'), after.get('protocol'), after.get('source_type'),
                    after.get('source'), after.get('stateless'), ports.get('min'), ports.get('max'))
                    != ('INGRESS', '6', 'CIDR_BLOCK', bastion_cidr, False, 22, 22)):
                raise ValueError('Worker SSH ingress must be stateful TCP 22 from the Bastion subnet only')
        if nodepool_retry_only and change['actions'] != ['no-op']:
            if not (resource['address'] == 'oci_containerengine_node_pool.grocery'
                    and typ == 'oci_containerengine_node_pool' and change['actions'] == ['create']):
                raise ValueError('Node-pool retry forbids other resource changes: ' + resource['address'])
        # Removing an obsolete API CIDR rule is necessary when an operator IP changes.
        # This exception cannot replace/delete the NSG, Bastion, VM or any other resource.
        if 'delete' in change['actions'] and not (api_rule and change['actions'] == ['delete']):
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
        changes = check(json.load(sys.stdin), nodepool_retry_only=os.environ.get('ALWAYS_FREE_NODEPOOL_RETRY_ONLY') == 'true',
                        network_access_only=os.environ.get('ALWAYS_FREE_NETWORK_ACCESS_ONLY') == 'true')
        print('Always Free plan guard passed. Proposed resource changes:')
        print('\n'.join(changes) or '(none)')
    except (ValueError, KeyError, TypeError) as error:
        sys.exit('Plan rejected: ' + str(error))
