// ---------------------------------------------------------------------------
// Cube Clock -- shared leaderboard.
//
// Identity is an anonymous Firebase account plus a nickname the player picks.
// No email, no password, nothing for a kid to remember or leak. The nickname is
// public to anyone with the link, which is the whole point of a leaderboard.
//
// Only one row per player per puzzle is ever written (their best), so the
// database stays tiny and comfortably inside the free tier no matter how many
// solves they do -- every individual solve stays on their own device.
// ---------------------------------------------------------------------------

import { firebaseConfig, configured } from "./firebase-config.js";

const SDK = "https://www.gstatic.com/firebasejs/11.6.0";

const listeners = new Set();
export const lb = {
  // "off"        -> no Firebase config yet, local-only
  // "connecting" -> signing in
  // "live"       -> signed in, leaderboard usable
  // "error"      -> something went wrong; message explains
  status: configured ? "connecting" : "off",
  message: configured ? "" : "Leaderboard is offline until Firebase is set up.",
  uid: null,
  name: "",
  group: "all",
  available: configured
};

function emit() { listeners.forEach(fn => { try { fn(lb); } catch (e) { /* listener bug */ } }); }
export function onChange(fn) { listeners.add(fn); fn(lb); return () => listeners.delete(fn); }

const LS_NAME = "cubeclock.name";
const LS_GROUP = "cubeclock.group";
function readLocal(key, fallback) {
  try { return localStorage.getItem(key) || fallback; } catch (e) { return fallback; }
}
function writeLocal(key, value) {
  try { localStorage.setItem(key, value); } catch (e) { /* blocked storage */ }
}

export function cleanName(raw) {
  return String(raw || "").replace(/[\n\r\t]/g, " ").trim().slice(0, 16);
}
export function cleanGroup(raw) {
  const g = String(raw || "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 24);
  return g || "all";
}

let fb = null;   // { app, auth, db, api }

async function connect() {
  if (!configured) return null;
  if (fb) return fb;
  const [{ initializeApp }, auth, store] = await Promise.all([
    import(`${SDK}/firebase-app.js`),
    import(`${SDK}/firebase-auth.js`),
    import(`${SDK}/firebase-firestore.js`)
  ]);
  const app = initializeApp(firebaseConfig);
  fb = { app, auth: auth.getAuth(app), db: store.getFirestore(app), A: auth, S: store };
  return fb;
}

export async function init() {
  lb.name = readLocal(LS_NAME, "");
  lb.group = cleanGroup(readLocal(LS_GROUP, "all"));
  if (!configured) { emit(); return; }

  try {
    const { auth, A } = await connect();
    await new Promise((resolve) => {
      A.onAuthStateChanged(auth, (user) => {
        if (user) {
          lb.uid = user.uid;
          lb.status = "live";
          lb.message = "";
          emit();
          resolve();
        }
      });
      A.signInAnonymously(auth).catch((err) => {
        lb.status = "error";
        lb.message = err && err.code === "auth/admin-restricted-operation"
          ? "Turn on Anonymous sign-in in the Firebase console (Authentication → Sign-in method)."
          : "Could not reach the leaderboard.";
        emit();
        resolve();
      });
    });
  } catch (err) {
    lb.status = "error";
    lb.message = "Could not load Firebase.";
    emit();
  }
}

export async function setName(raw) {
  const name = cleanName(raw);
  if (!name) return false;
  lb.name = name;
  writeLocal(LS_NAME, name);
  emit();
  await savePlayer();
  return true;
}

export async function setGroup(raw) {
  lb.group = cleanGroup(raw);
  writeLocal(LS_GROUP, lb.group);
  emit();
  await savePlayer();
  return lb.group;
}

async function savePlayer() {
  if (lb.status !== "live" || !lb.uid || !lb.name) return;
  const { db, S } = fb;
  try {
    await S.setDoc(S.doc(db, "players", lb.uid), {
      name: lb.name,
      group: lb.group,
      updatedAt: S.serverTimestamp()
    });
  } catch (err) { /* a failed profile write must never break the timer */ }
}

/**
 * Publish this player's best figures for one puzzle. Called only when the
 * numbers actually change, never on a timer or on every render.
 */
export async function publish(puzzle, stats) {
  if (lb.status !== "live" || !lb.uid || !lb.name) return false;
  if (!stats || !isFinite(stats.best) || stats.best < 300 || stats.best > 3600000) return false;
  const { db, S } = fb;
  const clean = (v) => (typeof v === "number" && isFinite(v) && v >= 300 && v <= 3600000) ? Math.round(v) : null;
  try {
    await S.setDoc(S.doc(db, "scores", `${lb.uid}__${puzzle}`), {
      uid: lb.uid,
      name: lb.name,
      group: lb.group,
      puzzle,
      best: Math.round(stats.best),
      ao5: clean(stats.ao5),
      ao12: clean(stats.ao12),
      solves: Math.max(1, Math.round(stats.solves || 1)),
      updatedAt: S.serverTimestamp()
    });
    return true;
  } catch (err) {
    if (err && err.code === "permission-denied") {
      lb.message = "The leaderboard rejected that score.";
      emit();
    }
    return false;
  }
}

/**
 * Live top-N for one puzzle in the current group.
 * Returns an unsubscribe function; safe to call when offline.
 */
export function watch(puzzle, take, cb) {
  if (lb.status !== "live") { cb([]); return () => {}; }
  const { db, S } = fb;
  const q = S.query(
    S.collection(db, "scores"),
    S.where("group", "==", lb.group),
    S.where("puzzle", "==", puzzle),
    S.orderBy("best", "asc"),
    S.limit(take)
  );
  return S.onSnapshot(q,
    (snap) => {
      cb(snap.docs.map((d, i) => {
        const v = d.data();
        return {
          rank: i + 1,
          uid: v.uid,
          name: v.name,
          best: v.best,
          ao5: v.ao5,
          ao12: v.ao12,
          solves: v.solves,
          me: v.uid === lb.uid
        };
      }));
    },
    (err) => {
      // A missing composite index is the one failure worth naming out loud,
      // because the console link in the error is how you fix it.
      lb.status = "error";
      lb.message = err && err.code === "failed-precondition"
        ? "The leaderboard index is still building — try again in a minute."
        : "Leaderboard connection lost.";
      emit();
      cb([]);
    }
  );
}
