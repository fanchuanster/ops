---
name: eks-notready-node-unresolved
description: "ondemand managed-node-group EC2 instances in alm-eks-eu-central-1 intermittently went NotReady ~9-37 min after boot due to VPC CNI ipamd pre-attaching extra ENIs before NetworkManager could hand them off cleanly. Fix (WARM_ENI_TARGET=0) is committed in Terraform and live on the cluster as of Jun 20 14:24 UTC, but required a manual kubectl patch because the EKS-managed addon update got permanently wedged."
metadata:
  node_type: memory
  type: project
  originSessionId: 8ce92ecd-1f16-45cb-8174-e596f7d0e091
---

Two ondemand managed-node-group instances in `alm-eks-eu-central-1` (eu-central-1) repeatedly went `NotReady`/`Unknown` 9-37 minutes after boot, with console output showing `SSM Agent unable to acquire credentials` or kubelet simply stopping posting status.

**Theory 1 (disproven):** IMDS `http_put_response_hop_limit=1`. Fixed via commit `2d8231b5` — didn't help. Don't re-propose.

**Theory 2 (disproven):** Secondary-ENI per-table routing missing the TGW default route — checked live `ip route`/`ip rule`, this part is fine. Don't re-propose.

**Root cause (confirmed):** VPC CNI's `ipamd` itself (not the launch template, not nodeadm) pre-attaches 2 extra "warm" ENIs in the first ~6 minutes of boot (`WARM_ENI_TARGET` default of 1, confirmed via CloudTrail `AttachNetworkInterface` calls carrying `userAgent: amazon-vpc-cni-k8s/v1.22.2` and the node's own assumed-role session). nodeadm's pre-kubelet bootstrap only has a few seconds to mark a non-primary ENI "unmanaged" by NetworkManager before kubelet starts; if ipamd's warm ENI is already attached when that race is lost, NetworkManager keeps its own DHCP default route alongside the primary ENI's — two competing default routes for the life of the node, eventually causing outbound traffic (SSM credential refresh, kubelet→API) to get silently misrouted.

By contrast, fresh Karpenter-provisioned nodes only have one ENI at the equivalent boot stage and never hit this race — confirming `WARM_ENI_TARGET=0` (no pre-warmed extra ENIs) as the fix: every node then boots looking like a Karpenter node.

**Fix applied:**
- `k8s/tf/infra/main.tf` — `vpc-cni` addon block now sets `configuration_values = jsonencode({ env = { WARM_ENI_TARGET = "0" } })`. Committed `88641d79` (and cleanup commits through `03a35639`) on `wen_dev`.
- `terraform plan -target='module.eks.aws_eks_addon.this["vpc-cni"]'` against the fra state shows **no drift** — the Terraform-desired config already matches what's submitted to AWS, so a plain `terraform apply` is a no-op here; it does not itself unstick a wedged addon update.

**Operational gotcha — EKS managed-addon updates can wedge indefinitely:** Calling `aws eks update-addon --addon-name vpc-cni --resolve-conflicts OVERWRITE` got accepted with no error, but `aws eks describe-addon` stayed in `status: UPDATING` for 26+ minutes straight, citing a stale `health.issues` message (`FailedDaemonPod ... aws-node-md8lv on node ip-10-211-28-219`) referencing a node/pod that had already been terminated. The live `aws-node` DaemonSet never actually received the new `WARM_ENI_TARGET=0` env var the whole time — `kubectl get ds aws-node -o jsonpath='{.spec.template.spec.containers[0].env}'` kept showing the old default (`=1`). This also explains the earlier Jenkins "K8s" build #1629 failure (S147/obs 7259-7262): the addon update was/is wedged the same way, unrelated to the underlying NotReady bug itself.

**Resolution used (Jun 20, ~14:24 UTC):** Worked around the wedged addon controller by patching the live object directly: `kubectl set env ds/aws-node -n kube-system WARM_ENI_TARGET=0`. Rolled out cleanly to all 4 nodes within seconds, all `aws-node` pods `2/2 Running`. This does not fight with Terraform/the addon's desired config since the value already matches what's configured — when/if the wedged `UPDATE_FAILED`→`UPDATING` addon update ever resolves itself, it should converge without reverting the patch.

**How to apply:** Don't re-propose hop_limit or per-ENI-routing-table fixes — both disproven. The ENI-race root cause is understood and the real fix is in place and live. If a *new* NotReady episode recurs after this point, suspect something else (this exact failure mode should no longer be possible with `WARM_ENI_TARGET=0` live). If the vpc-cni EKS addon needs another config change in the future, expect the same wedging behavior if a node/pod referenced in its cached health state gets removed mid-update — check `kubectl get ds aws-node -o jsonpath=...env` directly rather than trusting `aws eks describe-addon` status, and fall back to `kubectl set env`/`kubectl patch` on the DaemonSet if the managed update doesn't converge within a few minutes.
