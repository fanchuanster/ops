# ALM Farm SA Schema Naming (EC2 and EKS farms)

Every ALM farm's Oracle schema alternates between two slots, `{FARM}_SA` and
`{FARM}_SA_CPY`. The convention and the `upgrade/upgrade.py` module implementing it are
shared — identical for EC2-based and EKS-based (`k8s/`) farms.

- Only one slot is active at a time. Which one is tracked by the farm's `sa` field in
  MSM backoffice, **not** by the name: `_SA` active is not a default state, and `_SA_CPY`
  can be (and often is) the active one.
- An upgrade (`copyAndUpgrade`) copies the active slot's data into the *other* slot at
  the new version and cuts the farm over — so the active name flips between `_SA` and
  `_SA_CPY` across successive upgrades.
- The slot it copied *from* is left behind, holding the data as it was before the
  upgrade: that is the way back from a bad one. It is reclaimed only by the next upgrade
  in the other direction, whose "ensure `<slot>` is free" step prompts (30 min timeout,
  showing the schema's `admin_version`) before dropping it. So the steady state is both
  slots populated, and an upgrade needing its target slot is a confirmation the operator
  has to answer, not something the job decides.
- `Upgrade.get_upgrade_type_from_versions` compares **only the major version** parsed
  from each side's `admin_version`. A target major lower than the active schema's is
  `NONE`/`ABORT` (downgrade guard), whatever Jenkins action triggered it. This surprises
  you when the target string doesn't look older — an `admin_version` major of 19 vs 20
  is not obvious from a display string like "25.1 Patch 2".
- The Jenkins `K8s` job's `Deploy_Force` action, on that ABORT case, raw
  drop-and-recreates **only** the currently-active (backoffice `sa`-registered) slot; it
  never touches the other.

# Changing Shared Infrastructure — Hard-Won Rules

From the 2026-09-04 Oregon incident: `sts`/`ec2`/`ecr` interface endpoints created by
hand in the shared `ALM_app` VPC (`vpc-53708f34`) to give EKS nodes a private path they
already had. Their VPC-wide private DNS pointed every host — the `lreorgprdpdb*` DB
servers included — at ENIs no SG let them reach, breaking AWS CLI cronjobs for a day.

1. **Verify the assumption, especially in a hurry.** Measure the limitation from the
   host that has it before building around it — one `curl` from a node would have shown
   public STS answering. "It can't reach X" and "my change can't have caused this" are
   both hypotheses until a command proves them. CloudTrail `lookup-events` answers who
   changed what; its `userAgent` separates terraform from a hand-run `aws-cli`.
2. **Scope the blast radius first.** `ALM_app` holds farm servers, LRE Controllers and
   DB servers. `PrivateDnsEnabled` is a VPC-wide DNS takeover, not a workload setting;
   an endpoint SG must admit the VPC CIDRs (`10.210.8.0/22`, `10.210.12.0/23`,
   `10.210.32.0/21`, `10.208.26.128/25`), never a workload SG.
3. **Nothing enters AWS except through terraform.** CLI-created resources sit in no
   state, no grep, no MR. Use the CLI to read, or to undo what a `grep` of the state in
   `s3://qc-installation/tfvars/` proves is unmanaged.
