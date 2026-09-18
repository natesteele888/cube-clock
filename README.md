# Cube Clock

A speedcubing timer for 2×2, 3×3, 4×4, 5×5, Pyraminx and Megaminx, with a
shared leaderboard. Built for a phone held sideways.

**Setup:** see [SETUP.md](SETUP.md).

## What it does

- **Real scrambles** in WCA notation, generated per solve — 11 moves on 2×2,
  20 on 3×3, 44 and 60 with wide turns on 4×4/5×5, 10 + tips on Pyraminx,
  7 lines of `R++ D--` on Megaminx.
- **Hold-and-release timing**, the way competition timers work. Touch first;
  the spacebar also works on a desktop.
- **WCA inspection** — optional 15-second countdown, amber at 8 seconds,
  automatic +2 over 15s and DNF over 17s.
- **+2 / DNF / delete** on any solve, with averages that drop the best and
  worst and go DNF on a second DNF, as competitions score them.
- **Sessions**, split automatically after an hour away or started by hand.
- **Statistics** — personal best, best Ao5/Ao12, average of all, days
  practised, a trend graph of every single with a rolling average of 5 over it,
  and the full solve history with scrambles.
- **Shared leaderboard**, live, per puzzle, with optional group codes.
- **Backup** to a file or to text you can paste somewhere safe.

## Layout

```
public/
  index.html          markup
  styles.css          all styling, light + dark
  app.js              timer, scrambles, stats, views
  leaderboard.js      anonymous auth + Firestore
  firebase-config.js  your project's config (you fill this in)
firestore.rules       who may write what
firestore.indexes.json
firebase.json         hosting + Firestore config
```

No build step and no bundler. The Firebase SDK loads as an ES module from
Google's CDN, so `public/` is deployable exactly as it sits.

## Running it locally

```bash
npx http-server public -p 8742
# or
python3 -m http.server 8742 --directory public
```

The leaderboard needs the config from SETUP.md; without it the timer still runs
in full and the board reports itself as off.

## Data

Solves never leave the device. The only thing uploaded is one row per player
per puzzle holding their best single, best Ao5, best Ao12 and solve count —
written only when one of those actually changes.
