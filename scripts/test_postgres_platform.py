"""Exercise the actual pinned PostgreSQL image, init roles, TLS and logical recovery."""
from pathlib import Path
import re
import subprocess
import tempfile
import time
import uuid

ROOT = Path(__file__).resolve().parent.parent


def run(args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


def main():
    source = (ROOT / 'infra/cluster-foundation/postgres.tf').read_text()
    script = re.search(r'"01-roles.sh"\s*=\s*<<-SCRIPT\n(.*?)\n\s*SCRIPT', source, re.S)[1]
    script = '\n'.join(line[6:] for line in script.splitlines()) + '\n'
    hba = re.search(r'"pg_hba.conf"\s*=\s*<<-HBA\n(.*?)\n\s*HBA', source, re.S)[1]
    image = re.search(r'default\s*=\s*"(docker.io/library/postgres@sha256:[a-f0-9]+)"',
                      (ROOT / 'infra/cluster-foundation/variables.tf').read_text())[1]
    name = 'grocery-postgres-test-' + uuid.uuid4().hex[:10]
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory)
        path.chmod(0o755)
        (path / '01-roles.sh').write_text(script)
        (path / '01-roles.sh').chmod(0o644)
        (path / 'pg_hba.conf').write_text(hba)
        (path / 'pg_hba.conf').chmod(0o644)
        # Disposable test-only credentials; no application or OCI secrets are used.
        env = {'POSTGRES_PASSWORD': 'test-admin', 'GROCERY_OWNER_PASSWORD': 'test-owner',
               'GROCERY_APP_PASSWORD': 'test-app', 'GROCERY_BACKUP_PASSWORD': 'test-backup'}
        env_file = path / 'environment'
        env_file.write_text('\n'.join(key + '=' + value for key, value in env.items()))
        env_file.chmod(0o600)
        run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', str(path / 'server.key'),
             '-out', str(path / 'server.crt'), '-days', '1', '-subj', '/CN=localhost',
             '-addext', 'subjectAltName=DNS:localhost'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        (path / 'server.crt').chmod(0o644)
        try:
            run(['docker', 'run', '-d', '--name', name, '--env-file', str(env_file),
                 '--mount', 'type=bind,source=' + directory + ',target=/test,readonly',
                 '--mount', 'type=bind,source=' + str(path / '01-roles.sh') + ',target=/docker-entrypoint-initdb.d/01-roles.sh,readonly',
                 '--tmpfs', '/var/lib/postgresql/data', '--tmpfs', '/tls', '--entrypoint', 'bash', image,
                 '-ec', 'cp /test/server.* /tls/; chown 999:999 /tls/server.*; chmod 600 /tls/server.key; exec docker-entrypoint.sh postgres -c ssl=on -c ssl_cert_file=/tls/server.crt -c ssl_key_file=/tls/server.key -c hba_file=/test/pg_hba.conf'], stdout=subprocess.DEVNULL)
            for _ in range(90):
                ready = subprocess.run(['docker', 'exec', name, 'pg_isready', '-U', 'postgres'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                if ready.returncode == 0:
                    time.sleep(2)
                    break
                time.sleep(1)
            else:
                raise RuntimeError('PostgreSQL startup timed out')

            def sql(role, password, query, expect_success=True, ssl='verify-full'):
                args = ['docker', 'exec', '--user', '999', '-e', 'PGPASSWORD=' + password,
                        '-e', 'PGSSLMODE=' + ssl, '-e', 'PGSSLROOTCERT=/tls/server.crt', name,
                        'psql', '-h', 'localhost', '-U', role, '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atc', query]
                result = subprocess.run(args, capture_output=True, text=True)
                if expect_success and result.returncode:
                    raise RuntimeError(result.stderr)
                if not expect_success and not result.returncode:
                    raise AssertionError('Restricted operation unexpectedly succeeded')
                return result.stdout.strip()

            sql('grocery_owner', 'test-owner', 'CREATE TABLE public.backup_probe (id int PRIMARY KEY, value text); INSERT INTO public.backup_probe VALUES (1, \'before-backup\');')
            assert sql('grocery_app', 'test-app', 'SELECT value FROM public.backup_probe') == 'before-backup'
            sql('grocery_app', 'test-app', "UPDATE public.backup_probe SET value='runtime-write' WHERE id=1")
            sql('grocery_app', 'test-app', 'CREATE TABLE public.forbidden (id int)', expect_success=False)
            sql('grocery_backup', 'test-backup', 'DELETE FROM public.backup_probe', expect_success=False)
            sql('grocery_app', 'test-app', 'SELECT 1', expect_success=False, ssl='disable')
            run(['docker', 'exec', '-e', 'PGPASSWORD=test-backup', '-e', 'PGSSLMODE=verify-full',
                 '-e', 'PGSSLROOTCERT=/tls/server.crt', name, 'pg_dump', '-h', 'localhost',
                 '-U', 'grocery_backup', '-d', 'postgres', '--format=custom', '--no-owner', '--no-acl', '-f', '/tmp/recovery.dump'])
            sql('grocery_owner', 'test-owner', 'DROP TABLE public.backup_probe')
            run(['docker', 'exec', '-e', 'PGPASSWORD=test-owner', '-e', 'PGSSLMODE=verify-full',
                 '-e', 'PGSSLROOTCERT=/tls/server.crt', name, 'pg_restore', '-h', 'localhost',
                 '-U', 'grocery_owner', '-d', 'postgres', '--no-owner', '--no-acl', '--exit-on-error', '/tmp/recovery.dump'])
            assert sql('grocery_app', 'test-app', 'SELECT value FROM public.backup_probe') == 'runtime-write'
            print('PostgreSQL integration passed: verified TLS, role isolation, runtime writes and backup-role dump/owner-role restore.')
        finally:
            subprocess.run(['docker', 'rm', '-f', name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


if __name__ == '__main__':
    main()
