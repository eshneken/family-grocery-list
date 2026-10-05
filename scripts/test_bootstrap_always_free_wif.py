"""Target isolation and secret-handling checks for the operator bootstrap."""
import contextlib
import importlib.util
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("bootstrap", Path(__file__).with_name("bootstrap-always-free-wif.py"))
bootstrap = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bootstrap)


class BootstrapTests(unittest.TestCase):
    def test_only_approved_repository_environment_is_trusted(self):
        trust = bootstrap.payload("runtime-client", "domain-user")
        self.assertEqual(trust["issuer"], "https://token.actions.githubusercontent.com")
        self.assertEqual(trust["oauthClients"], ["runtime-client"])
        self.assertEqual(trust["impersonationServiceUsers"], [{
            "rule": "sub eq repo:eshneken/family-grocery-list:environment:always-free",
            "value": "domain-user",
        }])

    def test_wrong_profile_and_region_fail_closed(self):
        for content in ["[DEFAULT]\ntenancy=old\n", "[EDFREETIER]\ntenancy=old\nregion=us-ashburn-1\n",
                        "[EDFREETIER]\ntenancy=" + bootstrap.TENANCY + "\nregion=us-phoenix-1\n"]:
            with tempfile.TemporaryDirectory() as directory:
                config = Path(directory) / "config"
                config.write_text(content)
                with self.assertRaises(ValueError):
                    bootstrap.validate_profile(config)

    def test_empty_mapping_is_rejected(self):
        with self.assertRaises(ValueError):
            bootstrap.payload("", "user")

    def run_main(self, api_results, compartment=None):
        identity = {"data": compartment or {"compartment-id": bootstrap.TENANCY, "lifecycle-state": "ACTIVE"}}
        users = {"data": {"resources": [{"id": "domain-user"}]}}
        arguments = ["bootstrap", "--runtime-client-id", "runtime", "--service-user-ocid", "ocid1.user.oc1..test", "--admin-client-id", "admin"]
        output = io.StringIO()
        with patch("sys.argv", arguments), patch.object(bootstrap, "validate_profile"), \
             patch.object(bootstrap, "oci_json", side_effect=[identity, users]), \
             patch.object(bootstrap.getpass, "getpass", return_value="test-admin-secret"), \
             patch.object(bootstrap, "request", side_effect=api_results) as request, \
             contextlib.redirect_stdout(output):
            bootstrap.main()
        return output.getvalue(), request

    def test_success_does_not_print_admin_secret_or_token(self):
        output, request = self.run_main([
            {"access_token": "test-admin-token"}, {"totalResults": 0, "Resources": []},
            {"id": "trust-id", "name": bootstrap.TRUST_NAME, "active": True},
        ])
        self.assertNotIn("test-admin-secret", output)
        self.assertNotIn("test-admin-token", output)
        self.assertEqual(request.call_count, 3)
        self.assertEqual(request.call_args.kwargs["body"]["oauthClients"], ["runtime"])

    def test_existing_trust_is_not_overwritten(self):
        with self.assertRaisesRegex(ValueError, "already exists"):
            self.run_main([{"access_token": "test-token"}, {"totalResults": 1, "Resources": [{"id": "existing"}]}])

    def test_wrong_compartment_stops_before_admin_token_request(self):
        with self.assertRaisesRegex(ValueError, "compartment"):
            self.run_main([], compartment={"compartment-id": "old-tenancy", "lifecycle-state": "ACTIVE"})


if __name__ == "__main__":
    unittest.main()
