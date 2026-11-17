// Watch link tests: plain Node, no browser and no emulator.
//   node --test tests/watch.test.mjs
// Loads the real public/watchlink.js and public/watch-sync.js with a stubbed fetch and localStorage, and the
// app's own time/average helpers straight out of public/app.js, so the summary is checked against the same
// maths the phone shows.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const require = createRequire(import.meta.url);

// ---- a browser-ish localStorage and a fake Firestore behind fetch ----
const mem = new Map();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: k => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: k => mem.delete(k),
  },
});
const calls = [];
let docs = {};            // "fw_links/<key>" -> {fields}
let offline = false;
globalThis.fetch = async (url, opt = {}) => {
  calls.push({ url, method: opt.method || "GET", body: opt.body ? JSON.parse(opt.body) : null });
  if (offline) throw new TypeError("Failed to fetch");
  const path = url.split("/documents/")[1];
  const res = (status, json) => ({ ok: status < 300, status, text: async () => (json ? JSON.stringify(json) : "") });
  if (path.startsWith("fw_pair?documentId=")) return res(200, {});
  const name = path.split("?")[0];
  if ((opt.method || "GET") === "GET") return docs[name] ? res(200, docs[name]) : res(404, null);
  if (opt.method === "PATCH") {
    const body = JSON.parse(opt.body);
    docs[name] = { fields: Object.assign({}, (docs[name] || {}).fields, body.fields) };
    return res(200, docs[name]);
  }
  return res(400, null);
};

const WL = require("../public/watchlink.js");
const CW = require("../public/watch-sync.js");

// ---- the phone's own helpers, lifted from app.js ----
const appSrc = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const from = appSrc.indexOf("/* ============ numbers ============ */"), to = appSrc.indexOf("function dayKey");
assert.ok(from > 0 && to > from, "numbers block found in app.js");
const num = vm.runInNewContext(appSrc.slice(from, to) + ";({ eff, avgOf, bestSingle, bestAvg, fmt })");

const IDS = ["222", "333", "444", "555", "pyra", "mega"];
const NOW = Date.UTC(2026, 10, 17, 18, 0, 0);
let n = 0;
const entry = o => Object.assign({ id: "e" + ++n, a: "cc", at: NOW - 60000, puz: "333", t: 15230, p: 0, s: "R U R' U'" }, o);
const linkDoc = (key, w) => { docs["fw_links/" + key] = { fields: { w: { stringValue: JSON.stringify({ v: 1, e: w }) } } }; };
const reset = () => { mem.clear(); calls.length = 0; docs = {}; offline = false; };

test("not linked: no network at all", async () => {
  reset();
  assert.equal(WL.linked(), false);
  assert.equal(await WL.read(), null);
  const sync = CW.makeSync(WL, { solves: () => ({}), ids: IDS, puz: () => "333", num });
  assert.deepEqual(await sync(), { skipped: "unlinked" });
  assert.equal(calls.length, 0);
});

test("takeSolves keeps good watch solves and skips odd ones", () => {
  const solves = { "333": [{ t: 20000, p: 0, d: NOW - 5000, s: "" }, { t: 15230, p: 0, d: NOW - 1000, s: "" }] };
  const r = CW.takeSolves(solves, [
    entry({ at: NOW - 3000, t: 18000.4 }),                 // good, lands between the two
    entry({ at: NOW - 1000, t: 15230 }),                   // already here (same d:t)
    entry({ at: NOW - 2000, t: 18000, puz: "777" }),       // unknown puzzle
    entry({ t: 120 }),                                     // too fast
    entry({ t: 3600001 }),                                 // over an hour
    entry({ t: "15000" }),                                 // not a number
    entry({ p: 1000 }),                                    // not a penalty Cube Clock has
    entry({ at: NOW + 86400000 }),                         // tomorrow
    entry({ at: Date.UTC(2019, 0, 1) }),                   // before the app existed
    entry({ puz: "pyra", at: NOW - 4000, t: 4100, p: -1, s: "x".repeat(401) }),   // good, DNF, scramble too long
    null, "junk",
  ], IDS, NOW);
  assert.equal(r.added, 2);
  assert.deepEqual(r.puzzles.sort(), ["333", "pyra"]);
  assert.deepEqual(solves["333"].map(s => s.d), [NOW - 5000, NOW - 3000, NOW - 1000], "kept in date order");
  assert.deepEqual(solves["333"][1], { t: 18000, p: 0, d: NOW - 3000, s: "R U R' U'" });
  assert.deepEqual(solves.pyra, [{ t: 4100, p: -1, d: NOW - 4000, s: "" }]);
  // the same entries again add nothing
  assert.equal(CW.takeSolves(solves, [entry({ at: NOW - 3000, t: 18000 })], IDS, NOW).added, 0);
});

test("summary matches the phone's numbers", () => {
  const mk = (ts, pens = []) => ts.map((t, i) => ({ t, p: pens[i] || 0, d: NOW - (ts.length - i) * 1000, s: "" }));
  const solves = {
    "333": mk([20001, 19004, 18337, 21000, 17000, 16000], [0, 0, 2000]),
    "222": mk([5000, 6000, 7000, 8000, 9000], [-1, 0, 0, 0, -1]),   // two DNFs: Ao5 is DNF
    "444": mk([60000, 61000]),
  };
  const s = CW.summaryOf(solves, IDS, "333", num);
  assert.equal(s.v, 1);
  assert.equal(s.puz, "333");
  assert.deepEqual(Object.keys(s.p), IDS);
  const l3 = solves["333"];
  assert.equal(s.p["333"].n, 6);
  assert.equal(s.p["333"].best, 16000);
  assert.equal(s.p["333"].ao5, Math.floor(num.avgOf(l3.slice(-5))));
  assert.equal(num.fmt(s.p["333"].ao5), num.fmt(num.avgOf(l3.slice(-5))), "same hundredths as the phone");
  assert.equal(s.p["333"].ao12, null);
  assert.deepEqual(s.p["333"].last, [16000, 17000, 21000, 20337, 19004], "newest first, +2 included");
  assert.equal(s.p["222"].ao5, -1);
  assert.deepEqual(s.p["222"].last, [-1, 8000, 7000, 6000, -1]);
  assert.equal(s.p["222"].best, 6000);
  assert.deepEqual(s.p["444"], { n: 2, best: 60000, ao5: null, ao12: null, last: [61000, 60000] });
  assert.deepEqual(s.p.mega, { n: 0, best: null, ao5: null, ao12: null, last: [] });
});

test("pair, then sync takes watch solves once and writes the summary only when it changes", async () => {
  reset();
  assert.equal(await WL.pair("ABCD-2345"), true);
  const pair = calls[0];
  assert.match(pair.url, /fw_pair\?documentId=abcd2345$/);
  const key = WL.key();
  assert.match(key, /^[a-z2-7]{26}$/);
  assert.equal(pair.body.fields.k.stringValue, key);

  const store = { "333": [] };
  linkDoc(key, [
    entry({ at: NOW - 9000, t: 14000 }),
    { id: "g1", a: "gr", at: NOW, d: "2026-11-17", i: "x", on: 1 },     // another app's entry: left alone
    entry({ at: NOW - 8000, t: 13000, p: 2000 }),
  ]);
  let saved = 0;
  const sync = CW.makeSync(WL, {
    solves: () => store, ids: IDS, puz: () => "333", num,
    take: es => { const r = CW.takeSolves(store, es, IDS, NOW); saved++; return r.added; },
  });
  calls.length = 0;
  assert.deepEqual(await sync(), { added: 2, wrote: true });
  assert.equal(saved, 1);
  assert.deepEqual(store["333"].map(s => [s.t, s.p]), [[14000, 0], [13000, 2000]]);
  const patch = calls.find(c => c.method === "PATCH");
  assert.match(patch.url, new RegExp("fw_links/" + key + "\\?updateMask\\.fieldPaths=cc&updateMask\\.fieldPaths=updated$"));
  assert.ok(!("w" in patch.body.fields), "never writes the watch's own field");
  const cc = JSON.parse(patch.body.fields.cc.stringValue);
  assert.equal(cc.v, 1);
  assert.equal(typeof cc.at, "number");
  assert.equal(cc.puz, "333");
  assert.deepEqual(cc.p["333"], { n: 2, best: 14000, ao5: null, ao12: null, last: [15000, 14000] });
  assert.deepEqual(WL.fresh(await WL.read(), "gr").map(x => x.id), ["g1"], "gr entry still there for Get Ready");

  // nothing new: reads, takes nothing, writes nothing
  calls.length = 0;
  assert.deepEqual(await sync(), { added: 0, wrote: false });
  assert.deepEqual(calls.map(c => c.method), ["GET"]);
  assert.equal(saved, 1);

  // a solve timed on the phone changes the summary: written again
  store["333"].push({ t: 12000, p: 0, d: NOW, s: "" });
  calls.length = 0;
  assert.deepEqual(await sync(), { added: 0, wrote: true });
  assert.equal(JSON.parse(docs["fw_links/" + key].fields.cc.stringValue).p["333"].best, 12000);

  // reset (a new link) sends it again even though nothing changed
  sync.reset();
  assert.deepEqual(await sync(), { added: 0, wrote: true });
});

test("a link with no document yet still gets the summary", async () => {
  reset();
  await WL.pair("wxyz7654");
  const sync = CW.makeSync(WL, { solves: () => ({}), ids: IDS, puz: () => "pyra", num });
  assert.deepEqual(await sync(), { added: 0, wrote: true });
  assert.equal(JSON.parse(docs["fw_links/" + WL.key()].fields.cc.stringValue).puz, "pyra");
});

test("offline: the sync fails quietly and changes nothing", async () => {
  reset();
  await WL.pair("wxyz7654");
  const store = {};
  const sync = CW.makeSync(WL, { solves: () => store, ids: IDS, puz: () => "333", num });
  offline = true;
  await assert.rejects(sync());
  assert.deepEqual(store, {});
  offline = false;
  assert.deepEqual(await sync(), { added: 0, wrote: true }, "works again once back online");
});

test("waits while a solve is being timed", async () => {
  reset();
  await WL.pair("wxyz7654");
  calls.length = 0;
  const sync = CW.makeSync(WL, { solves: () => ({}), ids: IDS, puz: () => "333", num, busy: () => true });
  assert.deepEqual(await sync(), { skipped: "busy" });
  assert.equal(calls.length, 0);
});

test("unlinking stops all network calls", async () => {
  reset();
  await WL.pair("wxyz7654");
  WL.unlink();
  calls.length = 0;
  const sync = CW.makeSync(WL, { solves: () => ({}), ids: IDS, puz: () => "333", num });
  assert.deepEqual(await sync(), { skipped: "unlinked" });
  assert.equal(calls.length, 0);
});
