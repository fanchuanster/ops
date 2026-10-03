---
name: feedback_test_in_alm_jenkins
description: "Execution environments: aviator-agent for Jenkins jobs, alm_jenkins for kubectl/EKS access"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: aa2bd557-5524-4692-9443-fd4a5a0cd009
---

Two distinct containers on the native host serve different purposes:

- **`aviator-agent`** — Jenkins jobs defined in Groovy files under `ai/` and `aviator/` run here. To reproduce a Jenkins job step locally: `docker exec -it aviator-agent bash`.
- **`alm_jenkins`** — Jenkins master; also the only place with `kubectl` and EKS cluster credentials configured.

**Why:** `aviator-agent` is the Jenkins agent container where pipeline steps actually execute. `alm_jenkins` is the controller with cluster access. Do not confuse the two.

**How to apply:**
- To run pipeline commands (questionnaire ingest, autofill, etc.) as Jenkins would: `docker exec -it aviator-agent bash`
- For kubectl/EKS: `docker exec -it alm_jenkins bash`, then run `kubectl` commands normally.
