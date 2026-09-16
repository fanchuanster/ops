# Dev environment

- Source is cloned to the Kiosk server **ALMKIOSK-01**, which also serves
  `auto_remediation`, the dashboard, PostgreSQL and ChromaDB.
- Jenkins server `almprodjenkins.saas.microfocus.com` (internal `10.211.36.170`),
  reached as `ssh jenkins`. It hosts the `alm_jenkins` master container and the
  `aviator-agent` container (label `aviator` in groovy); `docker exec` into either.
  ```bash
  ssh jenkins
  docker exec -it alm_jenkins bash
  ```
- Inside `alm_jenkins`, `kubectl` has pre-configured kubeconfigs under `~/.kube/`. Use
  `$HOME/.kube/...`, **not** `~/.kube/...` — tilde is not expanded after
  `--kubeconfig=`.
  - `$HOME/.kube/fra-config` — ALM fra cluster (`alm-eks-eu-central-1`, `k8s/tf/infra`)
  - `$HOME/.kube/adm-devops-fra-kubeconfig` — ADM DevOps fra cluster
    (`adm-devops-eks-eu-central-1`, `k8s/tf/adm-devops-k8s-cluster`)
  - e.g. `kubectl --kubeconfig=$HOME/.kube/fra-config get nodes`
- ALM servers from `alm_jenkins`: user `ec2-user` or `ubuntu`, key
  `~/.ssh/Infra-ALM-key.pem`.

# GitLab access

- Instance `hmf.gitlab.otxlab.net` (e.g. `git@hmf.gitlab.otxlab.net:csd/adm/Aviator.git`).
- `GITLAB_TOKEN` is already set in the shell — pass it as a `PRIVATE-TOKEN` header:
  ```bash
  curl -s --header "PRIVATE-TOKEN: $GITLAB_TOKEN" "https://hmf.gitlab.otxlab.net/api/v4/<endpoint>"
  ```
- Never print `$GITLAB_TOKEN` to output or logs — pass it straight into the header.
