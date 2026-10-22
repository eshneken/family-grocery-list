"""Lease TCP 6443 access for one authenticated GitHub runner, then remove it."""
import argparse
import ipaddress
import json
import os
from pathlib import Path
import re
import subprocess
import time
from urllib.request import urlopen
import uuid

from oci_target import load_target


def oci(*args):
    result = subprocess.run(['oci', *args], capture_output=True, text=True, timeout=60)
    if result.returncode:
        raise RuntimeError('OCI administrative access operation failed; private CLI output suppressed.')
    return json.loads(result.stdout)['data'] if result.stdout.strip() else None


def api_nsg(target):
    cluster = oci('ce', 'cluster', 'get', '--cluster-id', target['cluster_ocid'])
    if cluster['compartment-id'] != target['compartment_ocid']:
        raise ValueError('Cluster does not match approved compartment')
    groups = cluster['endpoint-config']['nsg-ids']
    if len(groups) != 1:
        raise ValueError('Expected exactly one API NSG')
    nsg = oci('network', 'nsg', 'get', '--nsg-id', groups[0])
    if (nsg['compartment-id'] != target['compartment_ocid'] or nsg['vcn-id'] != cluster['vcn-id']
            or nsg['display-name'] != 'family-grocery-oke-api'):
        raise ValueError('API NSG identity does not match the approved cluster')
    return groups[0]


def is_lease(rule, prefix):
    ports = (rule.get('tcp-options') or {}).get('destination-port-range') or {}
    try:
        source = ipaddress.IPv4Network(rule['source'], strict=True)
    except (KeyError, ValueError):
        return False
    return (rule.get('description', '').startswith(prefix) and source.prefixlen == 32
            and rule.get('direction') == 'INGRESS' and rule.get('protocol') == '6'
            and rule.get('source-type') == 'CIDR_BLOCK' and ports == {'min': 6443, 'max': 6443})


def remove(nsg, ids):
    if ids:
        oci('network', 'nsg', 'rules', 'remove', '--nsg-id', nsg,
            '--security-rule-ids', json.dumps(ids))


def open_access(path):
    target = load_target()
    repo = os.environ.get('GITHUB_REPOSITORY', '')
    if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', repo):
        raise ValueError('A GitHub repository identity is required')
    prefix = 'github-actions-api:' + repo + ':'
    nsg = api_nsg(target)
    rules = oci('network', 'nsg', 'rules', 'list', '--nsg-id', nsg, '--all') or []
    # Recover orphaned leases left by a terminated runner. Other rules are untouched.
    expired = []
    for rule in rules:
        suffix = rule.get('description', '')[len(prefix):]
        if is_lease(rule, prefix) and re.fullmatch(r'[0-9]+:[a-f0-9]{32}', suffix):
            if int(suffix.split(':')[0]) < time.time():
                expired.append(rule['id'])
    remove(nsg, expired)
    with urlopen('https://api.ipify.org', timeout=20) as response:
        address = ipaddress.IPv4Address(response.read(128).decode().strip())
    if not address.is_global:
        raise ValueError('Runner egress must be a public IPv4 address')
    description = prefix + str(int(time.time()) + 7200) + ':' + uuid.uuid4().hex
    lease = {'nsg': nsg, 'description': description, 'cidr': str(address) + '/32'}
    # Persist the unique marker BEFORE mutation so post cleanup also handles lost responses.
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as stream:
        json.dump(lease, stream)
    rule = {'direction': 'INGRESS', 'protocol': '6', 'sourceType': 'CIDR_BLOCK',
            'source': lease['cidr'], 'isStateless': False, 'description': description,
            'tcpOptions': {'destinationPortRange': {'min': 6443, 'max': 6443}}}
    oci('network', 'nsg', 'rules', 'add', '--nsg-id', nsg, '--security-rules', json.dumps([rule]))
    print('Temporary runner /32 access granted on the OKE API only; post-job cleanup registered.')


def close_access(path):
    if not path.exists():
        return
    lease = json.loads(path.read_text())
    nsg = api_nsg(load_target())
    if nsg != lease['nsg']:
        raise ValueError('Lease does not match the approved API NSG')
    rules = oci('network', 'nsg', 'rules', 'list', '--nsg-id', nsg, '--all') or []
    matches = [r['id'] for r in rules if is_lease(r, lease['description'])
               and r['description'] == lease['description'] and r['source'] == lease['cidr']]
    remove(nsg, matches)
    # A failed removal raises above and keeps the recovery marker.
    path.unlink()
    print('Temporary runner API ingress removed.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation', choices=['open', 'close'])
    parser.add_argument('lease_file', type=Path)
    args = parser.parse_args()
    (open_access if args.operation == 'open' else close_access)(args.lease_file)
