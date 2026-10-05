#!/usr/bin/env python3
"""Operator-run, target-bound OCI identity trust bootstrap; no secret arguments."""

import argparse
import base64
import configparser
import getpass
import json
from pathlib import Path
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request

PROFILE = "EDFREETIER"
TENANCY = "ocid1.tenancy.oc1..aaaaaaaaxr2zj2tokqai2vyetuiinhzdr2i6yupriqasl5im3jwv7yjfa2ua"
COMPARTMENT = "ocid1.compartment.oc1..aaaaaaaayhvqxmlrywosn7ef2jtruuvatnovwluou2bhwzbtstg5sq2gtppa"
DOMAIN = "https://idcs-a17d6a11db0544fa99f7562f8c569990.identity.oraclecloud.com:443"
AUDIENCE = "grocery-always-free-github"
SUBJECT = "repo:eshneken/family-grocery-list:environment:always-free"
TRUST_NAME = "grocery-always-free-github-actions"


def payload(client_id, user_id):
    if not client_id.strip() or not user_id.strip():
        raise ValueError("Runtime client ID and identity-domain user ID are required")
    return {
        "schemas": ["urn:ietf:params:scim:schemas:oracle:idcs:IdentityPropagationTrust"],
        "name": TRUST_NAME,
        "type": "JWT",
        "issuer": "https://token.actions.githubusercontent.com",
        "publicKeyEndpoint": "https://token.actions.githubusercontent.com/.well-known/jwks",
        "subjectType": "User",
        "clientClaimName": "aud",
        "clientClaimValues": [AUDIENCE],
        "oauthClients": [client_id],
        "allowImpersonation": True,
        "impersonationServiceUsers": [{"rule": "sub eq " + SUBJECT, "value": user_id}],
        "active": True,
    }


def validate_profile(config_path):
    config = configparser.ConfigParser(interpolation=None)
    config.read(config_path)
    if PROFILE not in config:
        raise ValueError("EDFREETIER profile is missing; no default-profile fallback")
    selected = config[PROFILE]
    if selected.get("tenancy") != TENANCY or selected.get("region") != "us-ashburn-1":
        raise ValueError("EDFREETIER tenancy/region differs from the approved target")


def oci_json(*args):
    result = subprocess.run(
        ["oci", *args, "--profile", PROFILE, "--connection-timeout", "10", "--read-timeout", "20"],
        check=True, capture_output=True, text=True,
    )
    return json.loads(result.stdout)


def request(path, *, token=None, form=None, body=None, basic=None):
    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    if basic:
        headers["Authorization"] = "Basic " + base64.b64encode(basic.encode()).decode()
    data = None
    if form is not None:
        headers["Content-Type"] = "application/x-www-form-urlencoded"
        data = urllib.parse.urlencode(form).encode()
    if body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode()
    req = urllib.request.Request(DOMAIN + path, data=data, headers=headers)
    # Never redirect credential-bearing requests to another URL.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            return None
    with urllib.request.build_opener(NoRedirect).open(req, timeout=30) as response:
        return json.load(response)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runtime-client-id", required=True)
    parser.add_argument("--service-user-ocid", required=True)
    parser.add_argument("--admin-client-id")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--service-user-id", help="Identity-domain ID, required for offline dry-run")
    args = parser.parse_args()
    if not args.service_user_ocid.startswith("ocid1.user."):
        parser.error("service-user-ocid must be an OCI user OCID")
    if args.dry_run:
        if not args.service_user_id:
            parser.error("offline dry-run requires --service-user-id")
        print(json.dumps(payload(args.runtime_client_id, args.service_user_id), indent=2))
        return
    if not args.admin_client_id:
        parser.error("--admin-client-id is required for trust creation")

    validate_profile(Path.home() / ".oci/config")
    compartment = oci_json("iam", "compartment", "get", "--compartment-id", COMPARTMENT)["data"]
    if compartment["compartment-id"] != TENANCY or compartment["lifecycle-state"] != "ACTIVE":
        raise ValueError("Target compartment identity/state mismatch")
    users = oci_json("identity-domains", "users", "list", "--endpoint", DOMAIN,
                     "--filter", 'ocid eq "' + args.service_user_ocid + '"')["data"]["resources"]
    if len(users) != 1 or not users[0].get("id"):
        raise ValueError("Service user was not uniquely found in the new identity domain")
    trust = payload(args.runtime_client_id, users[0]["id"])
    print("Target: EDFREETIER / grocery. Trust accepts only " + SUBJECT)
    secret = getpass.getpass("Temporary administrator client secret (hidden): ")
    if not secret:
        raise ValueError("Administrator secret cannot be empty")
    token = request("/oauth2/v1/token", basic=args.admin_client_id + ":" + secret,
                    form={"grant_type": "client_credentials", "scope": "urn:opc:idm:__myscopes__"})["access_token"]
    query = urllib.parse.urlencode({"filter": 'name eq "' + TRUST_NAME + '"'})
    existing = request("/admin/v1/IdentityPropagationTrusts?" + query, token=token)
    if existing.get("totalResults", 0) or existing.get("Resources"):
        raise ValueError("Trust already exists; inspect it and run verification instead of creating a duplicate")
    created = request("/admin/v1/IdentityPropagationTrusts", token=token, body=trust)
    if not created.get("id") or created.get("active") is not True:
        raise ValueError("Creation response did not confirm an active trust; inspect before retrying")
    print(json.dumps({"id": created["id"], "name": created.get("name"), "active": created["active"]}, indent=2))
    print("Set OCI_WIF_CLIENT_ID=" + args.runtime_client_id)
    print("Set OCI_WIF_SERVICE_USER_OCID=" + args.service_user_ocid)
    print("Enter the runtime client secret directly in GitHub always-free; never enter the administrator secret there.")
    print("Deactivate/delete the temporary administrator application after federation verification passes.")


if __name__ == "__main__":
    try:
        main()
    except urllib.error.HTTPError as exc:
        sys.exit("Identity API returned HTTP " + str(exc.code) + "; response/token contents suppressed. Inspect target before retrying.")
    except subprocess.CalledProcessError:
        sys.exit("Read-only OCI identity lookup failed; check EDFREETIER permissions. Captured output suppressed.")
    except (ValueError, KeyError, urllib.error.URLError, OSError) as exc:
        sys.exit(str(exc))
