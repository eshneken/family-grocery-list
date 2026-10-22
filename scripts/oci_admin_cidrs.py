"""Validate private GitHub environment configuration without a permissive fallback."""
import ipaddress
import json
import os
import sys


def parse(raw):
    try:
        values = json.loads(raw)
        if not isinstance(values, list) or not values:
            raise ValueError()
        networks = [ipaddress.IPv4Network(value, strict=True) for value in values
                    if isinstance(value, str)]
        if len(networks) != len(values) or any(n.prefixlen == 0 for n in networks):
            raise ValueError()
        return sorted(set(str(n) for n in networks))
    except (ValueError, TypeError):
        raise ValueError('OCI_ADMIN_CIDRS must be a nonempty JSON array of canonical IPv4 CIDRs; /0 is forbidden.') from None


if __name__ == '__main__':
    try:
        print(json.dumps(parse(os.environ.get('OCI_ADMIN_CIDRS', ''))))
    except ValueError as error:
        sys.exit(str(error))
