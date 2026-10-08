"""Prevent deployed infrastructure identifiers from returning to public source."""
import ipaddress
from pathlib import Path
import re
import subprocess
import unittest

ROOT = Path(__file__).resolve().parent.parent


class PublicConfiguration(unittest.TestCase):
    def test_public_files_contain_no_deployed_identity_literals(self):
        failures = []
        patterns = [r'ocid1\.[a-z0-9_.-]*[a-z0-9]{20,}', r'idcs-[a-f0-9]{32}',
                    r'/Users/[^/\s]+/', r'age1[a-z0-9]{40,}']
        for name in subprocess.check_output(['git', 'ls-files'], cwd=ROOT, text=True).splitlines():
            path = ROOT / name
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
