/* Presenze Pre System - service worker
   Cambia CACHE a ogni nuova versione pubblicata */
var CACHE = "pps-1.0.0";
var FILES = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon-32.png"
];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(FILES); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (nomi) {
    return Promise.all(nomi.filter(function (n) { return n !== CACHE; }).map(function (n) { return caches.delete(n); }));
  }).then(function () { return self.clients.claim(); }));
});

/* File dell'app: risposta immediata dalla cache e aggiornamento in sottofondo.
   Motore dati (Apps Script) e font: sempre dalla rete. */
self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  e.respondWith(caches.open(CACHE).then(function (c) {
    return c.match(req, { ignoreSearch: true }).then(function (inCache) {
      var rete = fetch(req).then(function (r) {
        if (r && r.ok) c.put(req, r.clone());
        return r;
      }).catch(function () { return inCache; });
      return inCache || rete;
    });
  }));
});
