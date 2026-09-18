# Setting up the leaderboard

> **Not needed yet.** The app runs as a complete single-player timer with none
> of this done — the leaderboard simply stays hidden. Come back to this page
> when you want to switch it on.

About 10 minutes, all on the free tier. Until you finish, the app already works
as a full local timer — the leaderboard just reports itself as off.

---

## 1. Install the Firebase CLI

```bash
npm install -g firebase-tools
firebase login
```

## 2. Create the project

Go to <https://console.firebase.google.com> → **Add project**. Call it something
like `cube-clock`. You can switch Google Analytics **off** — it isn't used.

## 3. Turn on anonymous sign-in

**Build → Authentication → Get started → Sign-in method → Anonymous → Enable.**

This is what lets his friends join by just opening the link and typing a name.
No email, no password, nothing for an 11-year-old to remember or hand out.

> If you skip this step the app will say *"Turn on Anonymous sign-in in the
> Firebase console"* — that message is telling you exactly this.

## 4. Create the database

**Build → Firestore Database → Create database → Production mode**, then pick
the region closest to you.

Production mode is correct here: it starts locked down, and step 6 uploads the
rules in `firestore.rules` which open up exactly what's needed and nothing more.

## 5. Paste the web config

**Project settings (gear icon) → Your apps → Web (`</>`) → register the app.**

Firebase shows you a `firebaseConfig` object. Copy those six values into
[`public/firebase-config.js`](public/firebase-config.js), replacing the
`PASTE_…` placeholders.

These values are **not secrets** — a Firebase web config is designed to ship in
the browser. What protects the data is `firestore.rules`, not hiding this file.

## 6. Connect this folder and deploy

```bash
cd "/Volumes/AutoNuvo_1/cube-clock"
firebase use --add        # pick your project, alias it "default"
firebase deploy
```

The CLI prints your live URL, something like `https://cube-clock-a1b2c.web.app`.
**That's the link to send his friends.** It works on any phone, no account
needed beyond typing a name.

> The first deploy also builds a database index. If the leaderboard says
> *"index is still building"*, give it a minute and reload.

---

## Day-to-day

```bash
firebase deploy --only hosting            # after changing the app
firebase deploy --only firestore:rules    # after changing the rules
```

## Things worth knowing

**What's public.** Anyone with the link sees every player's chosen name and
their best times. Use first names or handles — not full names, not schools.

**What stays private.** Every individual solve, scramble and session lives only
in that person's own browser. Only a player's *best* figures per puzzle are
ever uploaded — one row per person per puzzle.

**Removing someone.** Firestore console → `scores` collection → delete the row.
Same for `players`. You own the project, so you're the moderator.

**Cheating.** The rules stop the easy attacks: nobody can write to another
player's row, and times outside 0.3s–60min are rejected outright. They cannot
stop someone typing a fake time into their own device — it's a friendly
leaderboard between kids, not a sanctioned competition.

**Cost.** One row per player per puzzle and a handful of reads per session sits
far inside the free Spark plan. A group of friends will not come close.
