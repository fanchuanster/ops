---
name: reference-k8s-tools-mix-replicas
description: Jenkins K8s_Tools job param to set minimal replicas for a farm during restart actions
metadata: 
  node_type: memory
  type: reference
  originSessionId: 0b909c9d-2420-41c6-ae06-5bbf9c34c219
  modified: 2026-08-04T20:15:20.721Z
---

The Jenkins job at `https://almprodjenkins.saas.microfocus.com/job/K8s_Tools/build?delay=0sec` accepts a `farmname:mix_replicas` parameter (e.g. `ALMFRA9007P:32`) to set the minimal replica count for a farm — used for restart actions.

**Why:** Not documented anywhere in the MSM_Automations repo; useful when building/extending k8s restart automation (see `k8s/main.py`).
**How to apply:** When implementing or troubleshooting farm restart logic that needs to control minimum replica counts, trigger/reference the K8s_Tools Jenkins job with this param format instead of inventing a new mechanism. Per [[feedback_no_live_jenkins_jobs]], never actually trigger this job during investigation/testing — read-only/replay only unless the user explicitly asks for a live run.
