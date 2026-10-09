/* Cube Clock service worker.
 *
 * Cache-first: the app launches from local storage with no network at all, which
 * is what makes it feel instant and lets him time solves with no signal. Every
 * request is still refreshed in the background, so a deploy is picked up on the
 * next launch -- and the page asks to reload sooner when it is safe to.
 *
 * Only same-origin GETs are touched. Firebase traffic, when the leaderboard is
 * switched on, goes straight to the network.
 */
var CACHE = "cubeclock-v4";
var ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./leaderboard.js",
  "./firebase-config.js",
  "./manifest.json",
  "./fonts/archivo-latin.woff2",
  "./fonts/azeret-mono-latin.woff2",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-512-maskable.png",
  "./sounds/crowd-cheer.mp3"
];

self.addEventListener("install", function(e){
  e.waitUntil(
    caches.open(CACHE)
      .then(function(c){ return c.addAll(ASSETS); })
      .then(function(){ return self.skipWaiting(); })
      .catch(function(){ return self.skipWaiting(); })   // one bad asset must not block install
  );
});

self.addEventListener("activate", function(e){
  e.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.map(function(k){
        return k === CACHE ? null : caches.delete(k);
      }));
    }).then(function(){ return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function(e){
  var req = e.request;
  if(req.method !== "GET") return;
  var url;
  try{ url = new URL(req.url); }catch(err){ return; }
  if(url.origin !== self.location.origin) return;       // never intercept Firebase

  e.respondWith(
    caches.match(req).then(function(hit){
      var net = fetch(req).then(function(res){
        if(res && res.ok && res.type === "basic"){
          var copy = res.clone();
          caches.open(CACHE).then(function(c){ c.put(req, copy); });
        }
        return res;
      }).catch(function(){ return hit; });
      return hit || net;                                 // serve cache, refresh behind it
    })
  );
});
