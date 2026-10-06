# OCI Always Free target preflight

Checked October 5, 2026 using OCI CLI profile `EDFREETIER`. All API operations were read-only; no infrastructure, IAM, GitHub environment, or DNS was changed. These findings supplement the [proposed design and migration runbook](oci-always-free-design.md).

The operator confirmed the Console plan is **Free Tier**, with no expiration displayed, and account creation on October 5. The operator expects the initial trial to end after approximately one month; an exact transition date is not established by the Console information provided. Repeat free-only entitlement checks after that transition. Subsequent branch/GitHub setup is recorded in [execution checkpoints](oci-always-free-checkpoints.md); it does not change the read-only nature of the preflight checks below.

## Verified target identity

| Setting | Verified value |
|---|---|
| Local profile | `EDFREETIER`, in `/Users/eshneken/.oci/config` |
| Tenancy name | `edfreetier` |
| Tenancy OCID | `ocid1.tenancy.oc1..aaaaaaaaxr2zj2tokqai2vyetuiinhzdr2i6yupriqasl5im3jwv7yjfa2ua` |
| Compartment | `grocery`, ACTIVE, directly under the verified tenancy |
| Compartment OCID | `ocid1.compartment.oc1..aaaaaaaayhvqxmlrywosn7ef2jtruuvatnovwluou2bhwzbtstg5sq2gtppa` |
| Home/target region | `us-ashburn-1` / Ashburn; region subscription READY |
| Object Storage namespace | `iddiywf0v4j6` |
| Availability domains | `oYVn:US-ASHBURN-AD-1`, `oYVn:US-ASHBURN-AD-2`, `oYVn:US-ASHBURN-AD-3` |

The profile authenticates successfully. Do not substitute another profile or a default tenancy during subsequent work. Private keys, fingerprints, passwords, and tokens are not recorded here.

## Current service limits and usage

Values below come from Limits `ListLimitValues` and, where supported, `GetResourceAvailability` for the target compartment in Ashburn. General service limits are not Always Free billing allowances.

| Resource / limit | Limit | Reported used / available | Implication |
|---|---:|---|---|
| Basic OKE `cluster-count` | 1 | 0 / 1 | One cluster fits current quota |
| A1 regional OCPUs | 16 | 0 / 16 | Planned 2 OCPUs fit; do not provision to the service-limit maximum |
| A1 regional memory | 96 GB | 0 / 96 GB | Planned 12 GB fit; retain the conservative free-hour budget |
| A1 OCPUs in each of AD-1, AD-2, AD-3 | 41 per AD | 0 / 41 in each AD | AD-level limits also permit the planned worker |
| Regional free combined boot/block storage | 200 GB | 0 / 200 GB | Approximately 100 GB initial shared-storage design fits |
| Flexible load balancer count | 36 | 0 / 36 | Service quota permits creation; provision only one with min/max 10 Mbps |
| NAT Gateway `nat-gateway-count` | 1 | Usage/availability API fields are null | Nonzero gateway limit; do not interpret null as zero or as unused capacity |

Cluster, Compute-instance, and VCN list calls returned no resources in `grocery`. This is an inventory of this compartment, not a claim that every compartment in the tenancy is empty.

The VCN limits-definition/value API did not expose a dedicated Service Gateway limit. Service Gateway remains in the design; its actual creation permission/VCN-specific limit must be checked during the approved provisioning step. No gateway was created as a test. NAT's nonzero limit removes the previously suspected zero-quota condition in the current account state, but does not establish account entitlements after a trial or account-mode change.

## Kubernetes and ARM image options

The target cluster-options API offers `v1.36.4`, currently the latest patch in its returned version list, and both `OCI_VCN_IP_NATIVE` and `FLANNEL_OVERLAY`. Preserve VCN-native networking.

Node-pool options queried specifically for `v1.36.4` and `aarch64` include `VM.Standard.A1.Flex` and these managed OKE images:

| Image name | Image OCID |
|---|---|
| `Oracle-Linux-9.8-aarch64-2026.08.14-0-OKE-1.36.4-1820` | `ocid1.image.oc1.iad.aaaaaaaaq45fqvrmfngvzptbuis2lrinuc4kawc5z5roalcuvlgcptc3fu7q` |
| `Oracle-Linux-8.10-aarch64-2026.08.14-0-OKE-1.36.4-1820` | `ocid1.image.oc1.iad.aaaaaaaaacfk3xybe5zevvge6zftwt4qpsp4ywo3tpqdqseyijjj25rfevua` |

Prefer the eligible Oracle Linux 9 image after compatibility validation; pin the reviewed image explicitly rather than relying on the first array entry. Requery immediately before provisioning for newer production-supported versions/images. IMDSv1 must be disabled in launch configuration; no worker exists yet to inspect.

## Remaining acceptance checks

- Confirm actual account mode/trial status and the applicable long-term free allowances. The tenancy name and general service quotas do not establish billing status. Repeat eligibility checks after any trial transition.
- A1 physical capacity is not proved by these quotas/image options. Select an AD when provisioning, keep one worker, and do not substitute a paid shape if placement fails.
- Verify Basic OKE creation, gateway creation, and the fixed 10/10 Mbps LB under the selected account mode during approved provisioning.
- Bootstrap target GitHub federation, backup instance-principal IAM, and operator Lens access; then validate effective permissions, public API restrictions, and IMDSv2 behavior.
- Complete tenancy-wide usage/cost verification and bucket inventories before apply; measure the real encrypted dump during rehearsal.
- Implementation was subsequently authorized. Branch/GitHub identity preparation is underway; cloud provisioning and data-cutover hold points remain separate.
