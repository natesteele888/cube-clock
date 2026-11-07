# Notes for Claude sessions in cube-clock

## Nate AI Brain (shared memory)
This app is one of several that share parts and lessons through the private
`natesteele888/nate-brain` repo.
- **Start here, every session:** get the latest brain
  (`git -C /Volumes/AutoNuvo_1/nate-brain pull --ff-only`; a cloud session's attached
  copy is already current), then read `state/FRESHNESS.md`: what every app's code
  says right now, what's in flight, and where the brain's notes are behind. **If a
  note disagrees with it, the code wins.** Pull this repo too before you edit; never
  work in a copy that's behind.
- **Live and relied on:** only the Bengals coaching app (ASL-Bengals dev2). Test
  before you push there. Everything else is safe to improve and push freely.
- **Apps & links:** `apps.md` lists every app's live link, repo and Toolbox id,
  explains Nate's Toolbox app (his hub, natesteele888.github.io/apps/toolbox/) and
  how to send it updates. Never guess an app URL; if one changes, update
  `natesteele888/apps/registry.json`.
- **Read first:** before building, check `lessons.md`, and check `parts.md` for
  anything that already exists (sign-in, rules, calendar export, offline install,
  rosters…). Reuse the keeper version and follow its `playbooks/<id>.md`.
- **Write back:** when you hit a bug, gotcha or better way another project would
  want, add a dated entry to `nate-brain/lessons.md`. If you change a shared part
  here, update its entry in `parts.md`.
- Know-how only in nate-brain: never copy names, contact info, stats or secrets into it.
