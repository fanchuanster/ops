---
name: feedback_jenkins_domain_not_ip
description: "when linking to Jenkins server/jobs, use the domain name not the internal IP"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: fe21b617-315b-49b6-a2aa-9e07ad83f89d
  modified: 2026-08-09T02:40:41.812Z
---

When referencing the Jenkins server or job URLs (e.g. build links), use the domain name `almprodjenkins.saas.microfocus.com`, not the internal IP `10.211.36.170` — even though Jenkins MCP tool responses (`jenkins_trigger_build`, `jenkins_get_build_status`, etc.) return IP-based URLs by default.

**Why:** user explicitly asked not to use the IP form.

**How to apply:** when surfacing a Jenkins URL to the user, replace the `https://10.211.36.170/...` prefix from tool output with `https://almprodjenkins.saas.microfocus.com/...` before displaying it. The IP mapping is documented in the project CLAUDE.md.
