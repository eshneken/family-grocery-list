"""Fail image builds that retain the compromised eMudhra G3 trust anchor."""
import hashlib
from pathlib import Path
import re
import ssl

import certifi
import pip._vendor.certifi


BAD_ROOT = '86a1ecba089c4a8d3bbe2734c612ba341d813e043cf9e8a862cd5c57a36bbe6b'

for name, path in [
    ('system', '/etc/ssl/certs/ca-certificates.crt'),
    ('OCI SDK', certifi.where()),
    ('pip', pip._vendor.certifi.where()),
]:
    certificates = re.findall(
        r'-----BEGIN CERTIFICATE-----.*?-----END CERTIFICATE-----',
        Path(path).read_text(), re.DOTALL,
    )
    if not certificates:
        raise SystemExit(f'{name}: CA bundle is empty')
    for certificate in certificates:
        fingerprint = hashlib.sha256(ssl.PEM_cert_to_DER_cert(certificate)).hexdigest()
        if fingerprint == BAD_ROOT:
            raise SystemExit(f'{name}: compromised emSign G3 root is still trusted')
    print(f'{name}: compromised emSign G3 root absent')
