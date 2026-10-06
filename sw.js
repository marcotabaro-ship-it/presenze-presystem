/* Lavoro Pre System - service worker
   Cambia CACHE a ogni nuova versione pubblicata */
var CACHE = "pps-2.4.0";
var FILES = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./pasti.js",
  "./fascicolo.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon-32.png"
];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return c.addAll(FILES.map(function (f) { return new Request(f, { cache: "reload" }); }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (nomi) {
    return Promise.all(nomi.filter(function (n) { return n !== CACHE; }).map(function (n) { return caches.delete(n); }));
  }).then(function () { return self.clients.claim(); }));
});

/* File dell'app: sempre la versione più recente dalla rete, copia in cache per l'uso offline.
   Motore dati (Apps Script) e font: solo rete, mai in cache. */
self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(req, { cache: "no-cache" }).then(function (r) {
      if (r && r.ok) {
        var copia = r.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copia); });
      }
      return r;
    }).catch(function () {
      return caches.open(CACHE).then(function (c) {
        return c.match(req, { ignoreSearch: true }).then(function (m) { return m || c.match("./"); });
      });
    })
  );
});
