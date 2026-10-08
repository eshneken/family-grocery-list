"""Daily encrypted logical backup. Instance principal may upload/list/delete only."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import uuid
from urllib.parse import parse_qs, unquote, urlsplit

PREFIX = 'postgres/'
MANIFEST = re.compile(r'^postgres/(\d{8}T\d{6}Z-[a-f0-9]{32})\.json$')
MAX_ARCHIVE_BYTES = 400 * 1024 * 1024


def prune(client, namespace, bucket, manifests, retain=5):
    """Called only after both uploads succeed; partial archives never count."""
    completed = sorted(name for name in manifests if MANIFEST.fullmatch(name))
    for name in completed[:-retain]:
        # Delete marker first: a crash must never count a missing archive as valid.
        client.delete_object(namespace, bucket, name)
        client.delete_object(namespace, bucket, name[:-5] + '.dump.age')


def database_env(url):
    parsed = urlsplit(url)
    query = parse_qs(parsed.query)
    if parsed.hostname != 'postgres.grocery.svc.cluster.local':
        raise ValueError('Backup must target the internal PostgreSQL Service')
    if query.get('sslmode') != ['verify-full']:
        raise ValueError('Backup requires verified PostgreSQL TLS')
    return dict(os.environ, PGHOST=parsed.hostname, PGPORT=str(parsed.port or 5432),
                PGUSER=unquote(parsed.username or ''), PGPASSWORD=unquote(parsed.password or ''),
                PGDATABASE=parsed.path.lstrip('/'), PGSSLMODE='verify-full',
                PGSSLROOTCERT='/var/run/postgres-ca/ca.crt', PGCONNECT_TIMEOUT='20')


def backup_target(env):
    keys = ['OCI_NAMESPACE', 'BACKUP_BUCKET', 'EXPECTED_OCI_NAMESPACE', 'EXPECTED_BACKUP_BUCKET']
    if any(not env.get(key) for key in keys):
        raise ValueError('Explicit backup target and approved values are required')
    if env['OCI_NAMESPACE'] != env['EXPECTED_OCI_NAMESPACE'] or env['BACKUP_BUCKET'] != env['EXPECTED_BACKUP_BUCKET']:
        raise ValueError('Backup target is not the approved bucket')
    return env['OCI_NAMESPACE'], env['BACKUP_BUCKET']


def main():
    import oci
    namespace, bucket = backup_target(os.environ)
    recipient = os.environ['AGE_RECIPIENT']
    if not re.fullmatch(r'age1[a-z0-9]+', recipient):
        raise ValueError('Invalid public age recipient')
    signer = oci.auth.signers.InstancePrincipalsSecurityTokenSigner()
    client = oci.object_storage.ObjectStorageClient({'region': 'us-ashburn-1'}, signer=signer)
    ident = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ-') + uuid.uuid4().hex
    with tempfile.TemporaryDirectory(dir='/scratch') as directory:
        dump = Path(directory) / 'postgres.dump'
        archive = Path(directory) / 'postgres.dump.age'
        subprocess.run(['pg_dump', '--format=custom', '--no-owner', '--no-acl', '--file', str(dump)],
                       env=database_env(os.environ['DATABASE_URL']), check=True, timeout=900)
        # Verify the archive table of contents before encryption/upload.
        subprocess.run(['pg_restore', '--list', str(dump)], check=True, stdout=subprocess.DEVNULL, timeout=60)
        subprocess.run(['age', '--recipient', recipient, '--output', str(archive), str(dump)], check=True, timeout=300)
        size = archive.stat().st_size
        if size > MAX_ARCHIVE_BYTES:
            raise ValueError('Encrypted dump exceeds 400 MiB planning limit; retention/storage budget must be reviewed')
        with archive.open('rb') as content:
            checksum = hashlib.file_digest(content, 'sha256').hexdigest()
        key = PREFIX + ident
        with archive.open('rb') as content:
            client.put_object(namespace, bucket, key + '.dump.age', content, content_length=size)
        manifest = json.dumps({'id': ident, 'archive': key + '.dump.age', 'bytes': size,
                               'sha256': checksum, 'database': 'postgres', 'format': 'custom',
                               'postgres_major': 16}).encode()
        client.put_object(namespace, bucket, key + '.json', manifest, content_length=len(manifest))
        objects = oci.pagination.list_call_get_all_results(client.list_objects, namespace, bucket, prefix=PREFIX).data.objects
        names = [obj.name for obj in objects]
        prune(client, namespace, bucket, names)
        # Remove incomplete archive uploads after a two-day grace period. Only
        # exact generated keys without a completion marker qualify.
        markers = set(names)
        cutoff = (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=2)).strftime('%Y%m%dT%H%M%SZ')
        for name in names:
            if re.fullmatch(r'postgres/\d{8}T\d{6}Z-[a-f0-9]{32}\.dump\.age', name):
                if name[:-9] + '.json' not in markers and name[len(PREFIX):len(PREFIX)+16] < cutoff:
                    client.delete_object(namespace, bucket, name)
        print('Backup complete: ' + ident + '; encrypted bytes=' + str(size) + '; retaining last 5 successful backups')


if __name__ == '__main__':
    main()
