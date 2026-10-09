"""Load the approved deployment identity from private configuration; never infer it."""
import argparse
import json
import os
from pathlib import Path
import shlex
import stat
import sys
from urllib.parse import urlparse

REQUIRED = ('tenancy_ocid', 'compartment_ocid', 'region', 'namespace', 'cluster_ocid',
            'state_bucket', 'backup_bucket', 'operator_profile', 'wif_domain_url',
            'wif_client_id', 'wif_service_user_ocid', 'wif_audience', 'node_image_id', 'node_availability_domain', 'app_hostname', 'caddy_acme_email', 'backup_age_recipient')


def load_target(*, allow_unprovisioned_cluster=False):
    raw = os.environ.get('OCI_TARGET_CONFIG_JSON')
    if raw is None:
        path = os.environ.get('OCI_TARGET_CONFIG_FILE')
        if not path:
            raise ValueError('Approved OCI target configuration is required')
        file = Path(path)
        if stat.S_IMODE(file.stat().st_mode) & 0o077:
            raise ValueError('OCI target configuration must be readable only by its owner')
        raw = file.read_text()
    try:
        target = json.loads(raw)
    except (ValueError, TypeError):
        raise ValueError('Invalid OCI target configuration') from None
    required_strings = [k for k in REQUIRED if k != 'cluster_ocid']
    if not isinstance(target, dict) or set(target) != set(REQUIRED) or any(
            not isinstance(target.get(k), str) or not target[k].strip()
            or any(c in target[k] for c in '\r\n') for k in required_strings):
        raise ValueError('Approved OCI target configuration is incomplete')
    cluster = target['cluster_ocid']
    if cluster is None and allow_unprovisioned_cluster:
        pass
    elif not isinstance(cluster, str) or not cluster.strip() or any(c in cluster for c in '\r\n'):
        raise ValueError('Approved cluster identity is required')
    for key, kind in [('tenancy_ocid', 'tenancy'), ('compartment_ocid', 'compartment'),
                      ('cluster_ocid', 'cluster'), ('wif_service_user_ocid', 'user'), ('node_image_id', 'image')]:
        if key == 'cluster_ocid' and target[key] is None and allow_unprovisioned_cluster:
            continue
        if not target[key].startswith('ocid1.' + kind + '.'):
            raise ValueError('Invalid OCI target identifier type')
    if target['region'] != 'us-ashburn-1':
        raise ValueError('Only the reviewed deployment region is permitted')
    url = urlparse(target['wif_domain_url'])
    if url.scheme != 'https' or not url.hostname or url.username or url.password or url.query or url.fragment:
        raise ValueError('Identity domain must be an HTTPS endpoint')
    return target


def exports(target):
    env = {'OCI_' + k.upper(): v for k, v in target.items() if v is not None}
    env['OCI_OBJECT_NAMESPACE'] = target['namespace']
    env['APP_HOSTNAME'] = target['app_hostname']
    env['TF_VAR_approved_target'] = json.dumps({k: target[k] for k in ['tenancy_ocid', 'compartment_ocid', 'region']})
    for variable, key in [('tenancy_ocid','tenancy_ocid'), ('compartment_ocid','compartment_ocid'),
                          ('region','region'), ('state_namespace','namespace'), ('state_bucket_name','state_bucket'),
                          ('backup_bucket_name','backup_bucket'), ('node_image_id','node_image_id'),
                          ('node_availability_domain','node_availability_domain'), ('app_hostname','app_hostname'),
                          ('caddy_acme_email','caddy_acme_email'), ('backup_age_recipient','backup_age_recipient')]:
        env['TF_VAR_' + variable] = target[key]
    return env


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--shell', action='store_true')
    p.add_argument('--github', action='store_true')
    p.add_argument('--allow-unprovisioned-cluster', action='store_true',
                   help='Infrastructure setup only; permit a null cluster identity before creation')
    args = p.parse_args()
    target = load_target(allow_unprovisioned_cluster=args.allow_unprovisioned_cluster)
    env = exports(target)
    if args.github:
        for value in set(env.values()):
            # Escape workflow-command control characters before registering masks.
            escaped = value.replace('%', '%25').replace('\r', '%0D').replace('\n', '%0A')
            print('::add-mask::' + escaped)
        private = Path(os.environ['RUNNER_TEMP']) / 'oci-target.json'
        descriptor = os.open(private, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(descriptor, 'w') as f:
            json.dump(target, f)
        private.chmod(0o600)
        env['OCI_TARGET_CONFIG_FILE'] = str(private)
        with open(os.environ['GITHUB_ENV'], 'a') as f:
            for key, value in env.items():
                f.write(key + '=' + value + '\n')
    elif args.shell:
        for key, value in env.items():
            print('export ' + key + '=' + shlex.quote(value))
    else:
        print('Approved OCI target configuration validated.')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError):
        sys.exit('Approved OCI target configuration is missing or invalid; values suppressed.')
