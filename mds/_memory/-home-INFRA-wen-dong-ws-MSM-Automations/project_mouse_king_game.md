---
name: mouse-king-game
description: "mouse-king-game lives at Aviator/mouse-king-game/index.html, serve it on port 5005"
metadata: 
  node_type: memory
  type: project
  originSessionId: c732dc76-ad81-4e3b-b5c3-0d909f502ff1
---

The mouse-king-game (single-file HTML5 canvas game) lives at `Aviator/mouse-king-game/index.html` in MSM_Automations. The user wants it served via `python3 -m http.server 5005` (run from that directory) — port 5005 specifically, not an arbitrary port.

**Why:** User explicitly asked to standardize on port 5005 so the URL stays consistent across sessions.

**How to apply:** When asked to "start"/"serve"/"run" this game, launch `python3 -m http.server 5005` from `Aviator/mouse-king-game/` and point the user to `http://localhost:5005/index.html`. Kill any stale http.server process already bound to 5005 first (check `ss -ltnp | grep 5005`) since a stale instance may be serving a now-deleted path.
