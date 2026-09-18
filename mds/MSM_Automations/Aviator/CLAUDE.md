# Aviator

Everything in the parent `MSM_Automations/CLAUDE.md` applies here. This file covers only
what is specific to this repo.

The shared commit rules are imported here as well, so the generated
`.github/copilot-instructions.md` carries them too — Copilot reads only this repo's own
file and would otherwise never see them.

@../CLAUDE-git.md

## Git workflow

Single-maintainer repo — **no merge request, no review**. Merge `wen_dev` straight into
`main` locally and push.

```bash
git checkout main && git merge wen_dev && git push origin main
bash .reset.sh          # rebuild local + remote wen_dev off the fresh main
```

- `main` is the default branch; `wen_dev` is the long-lived working branch.
- `.reset.sh` owns `wen_dev`'s lifecycle — it deletes both sides and recreates them from
  the current `main`. Never delete `wen_dev` as part of the merge itself. Run it with
  `bash`; the file is not executable.
- Keep real merge commits rather than squashing, so `wen_dev`'s individual commits stay
  in `main`'s history. Rewrite the merge commit message to describe the actual diff
  instead of leaving the default `Merge branch ...` text.

## Start service

The `alert` and `dashboard` containers run on the Kiosk server. Rebuild and restart with
`auto_remediation/launch.sh`:

```bash
cd auto_remediation
./launch.sh dashboard   # rebuild & restart dashboard
./launch.sh alert       # rebuild & restart alert orchestrator
./launch.sh             # both
```

## Dashboard layout

`auto_remediation/dashboard/` is a plain Flask app — no build step, no npm.

- `app.py` — the JSON API plus three routes that render the pages.
- `templates/` — Jinja pages, all extending `base.html`. A route passes only
  `page="<name>"`; the base pulls `static/css/<name>.css` and `static/js/<name>.js`.
- `static/css/base.css`, `static/js/common.js` — what every page shares (shell, banners,
  status palette). A page sheet loads after `base.css`, so it overrides by restating a
  selector.
- `static/vendor/alpine.min.js` — Alpine, vendored (the container has no outbound CDN
  access). Use it for widgets that are pure UI state; anything talking to the API stays
  plain JS.
- Served by gunicorn. `--reload` restarts workers on a `.py` change and
  `TEMPLATES_AUTO_RELOAD` picks up template edits, so the bind-mounted source needs no
  restart for either; static CSS/JS is read per request and cache-busted by mtime.
