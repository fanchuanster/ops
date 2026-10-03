---
name: ccoe-ami-karpenter-kms
description: Karpenter needs explicit KMS permissions to launch the encrypted CCoE AMI; without them instances die ~3s after launch
metadata: 
  node_type: memory
  type: project
  originSessionId: 65997e12-e494-462c-9e9c-115750056ec4
  modified: 2026-08-28T21:48:41.024Z
---

Karpenter on `alm-eks-eu-central-1` runs the CCoE AMI (`ami-05eb4ca13d64f28b7`,
`CCoE-AL2023-eks-nodeadm-fix-1.35-x86_64`, owned by CCoE account 986148801171),
the same image as the managed node group. **Resolved and verified working
2026-08-28** — before that it was impossible, for a non-obvious reason worth keeping.

**The failure mode.** The CCoE image's root snapshot is encrypted under a
customer-managed CMK in the CCoE account. Launching from it makes EC2 decrypt that
foreign key and re-encrypt the new root volume with our AWS-managed `alias/aws/ebs`
key (`5462b292-…`). The second half needs no IAM permission — an AWS-managed key's
policy admits any in-account principal calling via EC2. The first half does, and
`KarpenterController-…001` had **zero KMS statements**. So EC2 could not build the
root volume and discarded each instance **~3 seconds** after `RunInstances`, before
boot, with **no `TerminateInstances` API call** — surfacing only as an
`instance_terminated` interruption message that reads exactly like a node
self-terminating. Ten instances churned in ~12s.

**The fix** (`31e3f4fb`): `aws_iam_role_policy.karpenter_encrypted_ami_kms` in
`k8s/tf/infra/karpenter.tf` grants the controller role `kms:Decrypt`/`DescribeKey`/
`GenerateDataKeyWithoutPlaintext`/`ReEncryptFrom`/`ReEncryptTo` (conditioned on
`kms:ViaService = ec2.<region>`) plus `kms:CreateGrant` (conditioned on
`kms:GrantIsForAWSResource`). `Resource = "*"` because the CCoE CMK's ARN is not
readable from our account. **No CCoE-side change was needed** — their key policy
already admits the account; only our IAM was missing. Do not remove this while the
EC2NodeClass is pinned by id (`a8d8a79a`).

Why the managed node group was never affected: it launches through
`AWSServiceRoleForAutoScaling`, which already carries that access. Same account,
same subnets, **same node IAM role** (`alm-eks-eu-central-1-ondemand` — both
instance profiles wrap it). The only difference is the principal calling
`RunInstances`. Ruled out along the way: the node role, spot reclaim, the AMI's
bootstrap, and any governance lambda.

**Server-side-apply trap** (`3c615911`): a `kubectl patch` on the live EC2NodeClass
makes `kubectl-patch` the owner of that field, and Terraform is then refused
forever — `Apply failed with 1 conflict: … .spec.amiSelectorTerms`. An emergency
patch is exactly when this bites. `kubectl_manifest.karpenter_node_class` now sets
`force_conflicts = true` so Terraform reclaims the field.

Pinning by id means the node image no longer floats: bumping it means updating
`ami_id` in the region's tfvars, same as the node group.

adm-devops pins the same two encrypted CCoE AMIs (`ami-05eb4ca13d64f28b7` amd64,
`ami-0e2c72c24a35b22e4` arm64) and its Karpenter controller role has **not** been
given this KMS access — it has simply never provisioned a node, so the fault is
latent there. See [[adm-devops-karpenter-never-provisioned]].
