---
name: project-oregon-vpce-private-dns-incident
description: Four interface endpoints created by hand in the shared Oregon ALM_app VPC hijacked STS/EC2/ECR DNS VPC-wide and broke DB-server cronjobs
metadata:
  type: project
---

On 2026-09-04 03:41-04:10 UTC, during the LRE EKS work (Octane 488008), four
interface VPC endpoints were created **by aws-cli from the Jenkins host**
(`RestrictedJenkinsRole/i-0f5f00c440701bfe6`), not by terraform, in the *shared*
Oregon `ALM_app` VPC `vpc-53708f34`, all with **private DNS enabled**:
`sts` (`vpce-09288e22801d029e8`), `ec2` (`vpce-018971f4fddbe37d1`),
`ecr.api` (`vpce-0488868815f9a3872`), `ecr.dkr` (`vpce-0646377cb0f0bd65a`).

**Why it hurt:** private DNS rewrites those service names for *every* instance in
the VPC, but the SG attached was the EKS node SG
(`sg-0638a3bfce5501700`), which allowed 443 only from the cluster SG and itself.
Every other host in the VPC — the `lreorgprdpdb*` DB servers included — resolved
`sts.us-west-2.amazonaws.com` to the endpoint ENIs (10.210.32.9 / .33.58 / .34.38 /
.35.87) and hit a black hole, so their AWS CLI cronjobs failed "STS-related".
A DBA added `tcp/443 from sg-8a425ff3 (alm-db)` to the node SG at
2026-09-05 02:35 UTC as a manual workaround.

**Measured fact worth keeping:** the ALM_app Oregon subnets route `0.0.0.0/0` to
`tgw-02ad95fde6a77390c` and that path *does* reach the public AWS APIs. Verified
from EKS node 10.210.33.177 on 2026-09-05: public STS 302, ECR api 404, ECR dkr 401,
ECR S3 layer bucket 403, EC2 API 301 — all real service responses. So none of the
four endpoints are needed; `lre/k8s/README.md` claiming the ECR endpoints are what
lets nodes pull images without a NAT gateway is **wrong** and should be corrected.

**How to apply:** never attach a *node* SG to an interface endpoint in a shared VPC,
and never enable private DNS there without an SG that admits the whole VPC CIDR
(`10.210.8.0/22`, `10.210.12.0/23`, `10.210.32.0/21`, `10.208.26.128/25`). Anything
kept must be codified in `lre/k8s/tf/infra/`, not created from the CLI.
See [[project-hermes-readonly-mount]] for the other click-ops-vs-code trap.
