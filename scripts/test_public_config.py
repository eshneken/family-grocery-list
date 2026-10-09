"""Prevent deployed infrastructure identifiers from returning to public source."""
import ipaddress
from pathlib import Path
import re
import subprocess
import unittest

ROOT = Path(__file__).resolve().parent.parent


def public_files():
    names = set(subprocess.check_output(['git', 'ls-files'], cwd=ROOT, text=True).splitlines())
    names.update(subprocess.check_output(['git', 'ls-files', '--others', '--exclude-standard'], cwd=ROOT, text=True).splitlines())
    return [ROOT / name for name in sorted(names) if (ROOT / name).is_file()]


class PublicConfiguration(unittest.TestCase):
    def test_deployment_examples_use_reserved_hostnames(self):
        for path in (ROOT / 'infra').rglob('terraform.tfvars.example'):
            match = re.search(r'app_hostname\s*=\s*"([^"]+)"', path.read_text())
            if match:
                self.assertTrue(match[1] == 'example.com' or match[1].endswith('.example.com'))

    def test_operator_source_uses_only_example_or_service_domains(self):
        allowed = ('example.com', 'example.org', 'example.net', 'github.com',
                   'githubusercontent.com', 'google.com', 'googleusercontent.com',
                   'oracle.com', 'oraclecloud.com', 'kubernetes.io', 'k8s.io',
                   'terraform.io', 'docker.io', 'ghcr.io', 'postgresql.org',
                   'prisma.io', 'w3.org', 'nextjs.org', 'dicebear.com')
        failures = []
        for path in public_files():
            relative = path.relative_to(ROOT)
            if relative.parts[0] not in ('docs', 'scripts', 'infra', '.github', 'diagrams', 'deploy') and relative != Path('README.md'):
                continue
            if path.suffix in ('.png', '.jpg', '.pdf'):
                continue
            text = path.read_text(errors='replace')
            domains = re.findall(r'(?<![\w.-])(?:[A-Za-z0-9-]{1,63}\.){1,5}(?:com|net|org|io|dev|cloud|edu|gov)(?![\w.-])', text)
            for domain in domains:
                if not any(domain.lower() == base or domain.lower().endswith('.' + base) for base in allowed):
                    failures.append(str(relative) + ': unreviewed domain literal')
        self.assertFalse(failures, '\n'.join(sorted(set(failures))))

    def test_no_hosting_transition_records_or_temporary_branch_access(self):
        phrases = ('rehearsal', 'cutover', 'retirement', 'codex/oci-' + 'always-free')
        failures = []
        for path in public_files():
            if path.suffix not in ('.md', '.yml', '.yaml', '.mmd'):
                continue
            if any(phrase in path.read_text().lower() for phrase in phrases):
                failures.append(str(path.relative_to(ROOT)))
        self.assertFalse(failures, '\n'.join(failures))

    def test_documentation_local_links_resolve(self):
        failures = []
        for path in public_files():
            if path.suffix != '.md':
                continue
            for target in re.findall(r'!?\[[^\]\n]*\]\(([^)\s]+)\)', path.read_text()):
                if ':' in target or target.startswith('#'):
                    continue
                local = target.split('#', 1)[0]
                if local and not (path.parent / local).exists():
                    failures.append(str(path.relative_to(ROOT)) + ': ' + target)
        self.assertFalse(failures, '\n'.join(failures))

    def test_public_files_contain_no_deployed_identity_literals(self):
        failures = []
        patterns = [r'ocid1\.[a-z0-9_.-]*[a-z0-9]{20,}', r'idcs-[a-f0-9]{32}',
                    r'/' + r'Users/[^/\s]+/', r'age1[a-z0-9]{40,}']
        for path in public_files():
            name = str(path.relative_to(ROOT))
            if not path.is_file() or path.suffix in ['.png', '.jpg', '.pdf']:
                continue
            data = path.read_bytes()
            if b'\0' in data:
                continue
            text = data.decode(errors='replace')
            if any(re.search(pattern, text) for pattern in patterns):
                failures.append(name + ': deployed identifier or local user path')
            for literal in re.findall(r'(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])', text):
                try:
                    address = ipaddress.ip_address(literal)
                except ValueError:
                    continue  # Version strings are not IP addresses.
                if address.is_global:
                    failures.append(name + ': literal public IP address')
        self.assertFalse(failures, '\n'.join(sorted(set(failures))))


if __name__ == '__main__':
    unittest.main()
