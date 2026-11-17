/* Cube Clock's side of the watch link (see watchlink.js for the link itself).

   Two jobs, both small and kept apart from the page so they can be tested in Node:
     takeSolves  puts solves timed on the watch into the normal history, checking every field first, since the
                 watch's log is outside input.
     summaryOf   the short "cc" summary the watch shows: per puzzle the solve count, best single, current Ao5
                 and Ao12 and the last five times, worked out with the app's own helpers so the watch and the
                 phone always show the same numbers.
   makeSync joins them to WatchLink: read the link, take new solves, then write the summary if it changed. */
(function (root) {
  "use strict";
  var MIN_T = 300, MAX_T = 3600000, MAX_S = 400;
  var EARLIEST = Date.UTC(2020, 0, 1), SKEW = 10 * 60 * 1000;   // a watch clock a few minutes ahead is fine

  /* Watch log entries -> store.solves. Returns how many were added and which puzzles changed.
     Anything odd (unknown puzzle, a time out of range, a strange date) is skipped. Already-held solves are
     recognised the way a backup restore recognises them: same date and same time. */
  function takeSolves(solves, entries, ids, now) {
    var added = 0, touched = {}, seen = {};
    now = now || Date.now();
    (entries || []).forEach(function (e) {
      if (!e || typeof e !== "object") return;
      var id = e.puz;
      if (typeof id !== "string" || ids.indexOf(id) < 0) return;
      if (typeof e.t !== "number" || !isFinite(e.t) || e.t < MIN_T || e.t > MAX_T) return;
      if (e.p !== 0 && e.p !== 2000 && e.p !== -1) return;
      if (typeof e.at !== "number" || !isFinite(e.at) || e.at < EARLIEST || e.at > now + SKEW) return;
      var t = Math.round(e.t), d = Math.round(e.at);
      if (!Array.isArray(solves[id])) solves[id] = [];
      var list = solves[id];
      if (!seen[id]) { seen[id] = {}; list.forEach(function (s) { if (s) seen[id][s.d + ":" + s.t] = 1; }); }
      var k = d + ":" + t;
      if (seen[id][k]) return;
      seen[id][k] = 1;
      list.push({ t: t, p: e.p, d: d, s: (typeof e.s === "string" && e.s.length <= MAX_S) ? e.s : "" });
      touched[id] = 1;
      added++;
    });
    Object.keys(touched).forEach(function (id) { solves[id].sort(function (a, b) { return a.d - b.d; }); });
    return { added: added, puzzles: Object.keys(touched) };
  }

  /* The summary without its "at" stamp, so two summaries can be compared. n = {eff, avgOf, bestSingle} from the
     app. Times are whole ms, rounded down so they show the same hundredths as the phone; DNF is -1 and a
     figure that needs more solves is null. */
  function summaryOf(solves, ids, puz, n) {
    var ms = function (v) { return v === null || v === undefined ? null : (isFinite(v) ? Math.floor(v) : -1); };
    var p = {};
    ids.forEach(function (id) {
      var list = Array.isArray(solves[id]) ? solves[id] : [];
      p[id] = {
        n: list.length,
        best: ms(n.bestSingle(list)),
        ao5: list.length >= 5 ? ms(n.avgOf(list.slice(-5))) : null,
        ao12: list.length >= 12 ? ms(n.avgOf(list.slice(-12))) : null,
        last: list.slice(-5).reverse().map(function (s) { return ms(n.eff(s)); })   // newest first
      };
    });
    return { v: 1, puz: puz, p: p };
  }

  /* One sync function for the page. app = {
       solves(): store.solves, ids: puzzle ids, puz(): the puzzle open on the phone, num: {eff, avgOf, bestSingle},
       take(entries): save fresh watch entries (defaults to takeSolves on solves()); returns how many were added,
       busy(): true while a solve is being timed (the sync waits for the next turn) }
     Resolves {added, wrote} or {skipped}. Never makes a network call when the phone isn't linked. */
  function makeSync(WL, app) {
    var lastSent = "", running = null, again = false;
    function once() {
      if (!WL.linked()) return Promise.resolve({ skipped: "unlinked" });
      if (app.busy && app.busy()) return Promise.resolve({ skipped: "busy" });
      return WL.read().then(function (doc) {
        var fresh = WL.fresh(doc, "cc"), added = 0;
        if (fresh.length) {
          added = app.take ? app.take(fresh) : takeSolves(app.solves(), fresh, app.ids).added;
          WL.took("cc", fresh);           // only after they're saved, and odd ones too so they aren't re-read forever
        }
        var sum = summaryOf(app.solves(), app.ids, app.puz(), app.num), key = JSON.stringify(sum);
        if (key === lastSent) return { added: added, wrote: false };
        var out = { v: 1, at: Date.now(), puz: sum.puz, p: sum.p };
        return WL.write("cc", out).then(function () { lastSent = key; return { added: added, wrote: true }; });
      });
    }
    function sync() {
      if (running) { again = true; return running; }
      running = once().then(function (r) { running = null; if (again) { again = false; return sync(); } return r; },
                            function (err) { running = null; again = false; throw err; });
      return running;
    }
    sync.reset = function () { lastSent = ""; };   // a new link: send the summary again
    return sync;
  }

  var CCWatch = { takeSolves: takeSolves, summaryOf: summaryOf, makeSync: makeSync };
  root.CCWatch = CCWatch;
  if (typeof module !== "undefined" && module.exports) module.exports = CCWatch;
})(typeof window !== "undefined" ? window : globalThis);
