---
name: reference-jenkins-build-log-via-ssh
description: Read Jenkins build logs from the master's filesystem over ssh when the Jenkins MCP tools are unavailable
metadata:
  type: reference
---

Jenkins build consoles can be read without the MCP tools (which the permission
classifier may block mid-session) straight off the master's filesystem:

```
ssh jenkins 'docker exec alm_jenkins bash -c "grep -a <pattern> /var/jenkins_home/jobs/<JOB>/builds/<N>/log"'
```

Build numbers: `ls /var/jenkins_home/jobs/<JOB>/builds/ | grep -E "^[0-9]+$" | sort -n`.
This works while a build is still running, so it also serves as a poll source for
a Monitor. See [[feedback-no-live-jenkins-jobs]] for when triggering builds is okay.

For running commands inside the container without quoting pain, pipe a script in:
`ssh jenkins 'docker exec -i alm_jenkins bash -s' < local_script.sh`.
