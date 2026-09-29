---
name: project_hermes_readonly_mount
description: "hermes container's write access to mounted MSM_Automations is controlled by a host POSIX ACL, not the docker-compose mount"
metadata: 
  node_type: memory
  type: project
  originSessionId: cef6ed1f-8f62-4003-8616-d598dc39915b
  modified: 2026-08-05T18:27:59.526Z
---

The hermes container's write access to `/home/kiosk/ws/MSM_Automations` is gated by a **host-level POSIX ACL** on the directory (owner `kiosk:kiosk`, mode `750`), not by the Docker volume mount — `Aviator/infra/docker-compose.yaml` already mounts it plain read-write. The hermes process inside the container runs as uid `10000` (user `hermes`), and the host ACL originally granted that uid only `r-x`.

Access must be granted **in both directions**. Whichever uid writes a file becomes its
owner, and the base mode leaves `other::---`, so a file hermes rewrites is unreadable by
kiosk (git then fails with `Permission denied` / `cannot hash <file>`) and vice versa.
Grant a named ACL entry for *each* uid — kiosk `1004`, hermes `10000` — plus matching
defaults so new files inherit them:

```bash
sudo setfacl -R    -m u:1004:rwx,u:10000:rwx /home/kiosk/ws/MSM_Automations
sudo setfacl -R -d -m u:1004:rwx,u:10000:rwx /home/kiosk/ws/MSM_Automations
```

Applied 2026-08-05 (hermes only) and 2026-08-19 (added kiosk after hermes-owned files
locked kiosk out). ACL changes are live — no container restart needed. Use `sudo`:
root-owned gitignored artifacts (`__pycache__/*.pyc`,
`Aviator/auto_remediation/test/reasoning_eval/results_*.json`) can't be re-ACL'd as kiosk.
Symlinks never carry ACLs — permissions resolve through the target, not a gap.

**Why:** If edits fail from either side, check `getfacl <path>` for `user:1004:` *and*
`user:10000:` before assuming it's a docker-compose/mount issue — the compose file was
always correct. A recursive `chown` is not the fix (and is blocked by the permission
classifier); the paired ACL is.

**How to apply:** Re-run the two `sudo setfacl` commands after anything that recreates
files (`git clean`, fresh checkout, a bulk write from the container). Verify with
`sudo setpriv --reuid 10000 --regid 10000 --clear-groups bash -c 'touch ./.x && rm ./.x'`
(`sudo -u '#10000'` does not work on this host).

**Gotcha:** unreadable files make `git status` report them as *modified* — that is git
failing to hash them, not real edits. Fix the ACL first, then re-read status before
concluding anything was changed.
