/* Copy of natesteele888/apps watchlink.js: the original lives there, and the two files must stay the same. */
/* Watch link: how the family apps on a phone (Get Ready, Cube Clock, Read 20, Power Program, Gameday Picks, Practice Clock) talk to the
   Steele Family apps on a Wear OS watch (watch/family).

   One private link joins one phone to one watch. It is a single document in the nates-toolbox Firestore,
   fw_links/<key>, where the key is a 26-character random code that only that phone and that watch know: nobody can
   list the links, and nothing on GitHub or in this file knows a key. No sign-in is needed on either side.

   The document has one text field per app. Each side writes only its own fields, so the two never write over each
   other:
     gr   Get Ready's lists and check marks, written by the phone (the watch reads it).
     cc, r20, pp, gp   a short summary from Cube Clock, Read 20, Power Program (today's workout) and Gameday Picks
                       for the watch to show.
     sc   the schedule: games and practices for the next two weeks, written by the team app (LYBS Ballclub), plus the
          GameChanger team for live scores. See watch/shared/.../family/core/SchedCore.kt for its shape.
     pk   the practice running in Practice Clock (each block's name and length and the clock numbers), so the watch can
          show the station and buzz at every change by itself. {"none":true} when no practice is running.
     w    the watch's own log of what happened on the watch (a tick, a solve, a reading session, a finished exercise), written only by
          the watch. Each phone app takes the entries for it that it hasn't taken yet.

   Linking: the watch shows an 8-letter code. Typing it on the phone (any of the apps) puts this phone's key in
   fw_pair/<code> for the watch to pick up; the watch then deletes that note. All the apps on this site share one key
   (localStorage is per site), so linking once in one app links them all.

   Every app loads this file itself; Cube Clock (its own repo) keeps a copy: keep the two the same. Power Program (fitness-hub) loads this one from the site. */
(function (root) {
  "use strict";
  const BASE = "https://firestore.googleapis.com/v1/projects/nates-toolbox/databases/(default)/documents/";
  const KEY = "steele.watchlink", SEEN = "steele.watchlink.seen.";
  const ABC = "abcdefghijklmnopqrstuvwxyz234567";
  const FIELDS = ["gr", "cc", "r20", "pp", "gp", "sc", "pk", "w"];
  const listeners = new Set();

  const lsGet = k => { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } };
  const lsSet = (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch (e) {} };
  const validKey = k => /^[a-z2-7]{26}$/.test(k || "");
  const newKey = () => {
    const b = new Uint8Array(26); (root.crypto || {}).getRandomValues ? root.crypto.getRandomValues(b) : b.forEach((_, i) => { b[i] = Math.random() * 256; });
    return Array.from(b, x => ABC[x & 31]).join("");
  };
  /* What the watch shows, typed any way (capitals, spaces, a dash), as the code in its document id. Null when it can't be one. */
  const cleanCode = s => { const c = String(s || "").toLowerCase().replace(/[\s-]/g, "").replace(/0/g, "o").replace(/1/g, "l"); return /^[a-z2-7]{8}$/.test(c) ? c : null; };

  const W = {};
  W.key = () => { const k = lsGet(KEY); return validKey(k) ? k : ""; };
  W.linked = () => !!W.key();
  W.cleanCode = cleanCode;
  W.onChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };
  const emit = () => listeners.forEach(fn => { try { fn(W.linked()); } catch (e) {} });
  if (root.addEventListener) root.addEventListener("storage", e => { if (e.key === KEY) emit(); });

  const fetchJson = async (url, opt) => {
    const r = await fetch(url, Object.assign({ cache: "no-store" }, opt || {}));
    const t = await r.text();
    let j = null; try { j = t ? JSON.parse(t) : null; } catch (e) {}
    return { ok: r.ok, status: r.status, json: j };
  };

  /* Link this phone to the watch showing `code`. Resolves true, or throws an Error with a message for the person. */
  W.pair = async code => {
    const c = cleanCode(code);
    if (!c) throw new Error("Type the 8 letters and numbers the watch shows.");
    const k = W.key() || newKey();
    const body = { fields: { k: { stringValue: k }, at: { timestampValue: new Date().toISOString() } } };
    let r;
    try { r = await fetchJson(BASE + "fw_pair?documentId=" + c, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
    catch (e) { throw new Error("No connection. Try again when you have signal."); }
    if (r.status === 409) throw new Error("That code was already used. Open the app on the watch again for a new one.");
    if (!r.ok) throw new Error(r.status === 403 ? "The watch link isn't switched on yet (the database rules need publishing)." : "That didn't work. Try again.");
    lsSet(KEY, k); emit();
    return true;
  };
  W.unlink = () => { lsSet(KEY, ""); emit(); };

  /* The link document, each field parsed (null where missing or damaged). Null with no link or no document yet. */
  W.read = async () => {
    const k = W.key(); if (!k) return null;
    const r = await fetchJson(BASE + "fw_links/" + k);
    if (r.status === 404) return null;
    if (!r.ok || !r.json) throw new Error("watch link HTTP " + r.status);
    const f = r.json.fields || {}, out = {};
    FIELDS.forEach(n => { const s = f[n] && f[n].stringValue; let v = null; if (s) { try { v = JSON.parse(s); } catch (e) {} } out[n] = v; });
    return out;
  };
  /* Write this app's own field (and nothing else) as JSON. Creates the document the first time. */
  W.write = async (field, obj) => {
    const k = W.key(); if (!k) return false;
    if (!FIELDS.includes(field) || field === "w") throw new Error("not a phone field: " + field);
    const body = { fields: { [field]: { stringValue: JSON.stringify(obj) }, updated: { timestampValue: new Date().toISOString() } } };
    const r = await fetchJson(BASE + "fw_links/" + k + "?updateMask.fieldPaths=" + field + "&updateMask.fieldPaths=updated", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error("watch link HTTP " + r.status);
    return true;
  };

  /* The watch's log entries for one app ("gr", "cc", "r20", "pp") that this phone hasn't taken yet, oldest first.
     Call W.took(app, entries) once they're saved, so they are never taken twice. */
  const seen = app => { try { const a = JSON.parse(lsGet(SEEN + app) || "[]"); return Array.isArray(a) ? a : []; } catch (e) { return []; } };
  W.fresh = (doc, app) => {
    const log = doc && doc.w && Array.isArray(doc.w.e) ? doc.w.e : [], had = new Set(seen(app));
    return log.filter(x => x && typeof x === "object" && x.a === app && typeof x.id === "string" && !had.has(x.id)).sort((a, b) => (a.at || 0) - (b.at || 0));
  };
  W.took = (app, entries) => {
    const ids = seen(app).concat((entries || []).map(x => x.id)).slice(-3000);
    lsSet(SEEN + app, JSON.stringify(ids));
  };

  /* The linking card each app puts in its settings. `app` only changes the words. */
  W.panel = (el, opt) => {
    opt = opt || {};
    const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
    const draw = msg => {
      if (W.linked()) {
        el.innerHTML = '<p class="wl-line">⌚ Linked to your watch. ' + esc(opt.linkedText || "") + '</p>' +
          '<button type="button" class="' + esc(opt.btn || "btn") + '" data-wl="off">Unlink the watch</button>' + (msg ? '<p class="wl-msg" role="status">' + esc(msg) + "</p>" : "");
      } else {
        el.innerHTML = '<p class="wl-line">' + esc(opt.intro || "Open the app on the watch. It shows a code: type it here.") + '</p>' +
          '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><input class="wl-code" aria-label="Code from the watch" placeholder="ABCD 2345" maxlength="11" autocapitalize="characters" autocomplete="off" spellcheck="false" style="font:inherit;font-size:1.2em;letter-spacing:.12em;width:9.5em;padding:8px;text-transform:uppercase">' +
          '<button type="button" class="' + esc(opt.btnPri || opt.btn || "btn") + '" data-wl="on">Link watch</button></div>' + (msg ? '<p class="wl-msg" role="status">' + esc(msg) + "</p>" : "");
      }
    };
    el.addEventListener("click", async e => {
      const b = e.target.closest("[data-wl]"); if (!b) return;
      if (b.dataset.wl === "off") { W.unlink(); draw("Unlinked. The watch keeps what it has until you link again."); return; }
      const inp = el.querySelector(".wl-code"); b.disabled = true;
      try { await W.pair(inp && inp.value); draw("Linked! The watch picks it up in a few seconds."); if (opt.onLinked) opt.onLinked(); }
      catch (err) { draw(err.message); }
    });
    draw("");
    return draw;
  };

  root.WatchLink = W;
  if (typeof module !== "undefined" && module.exports) module.exports = W;
})(typeof window !== "undefined" ? window : globalThis);
