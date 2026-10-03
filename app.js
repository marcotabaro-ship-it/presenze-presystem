/* =========================================================
   PRESENZE PRE SYSTEM - Marco Tabaro
   File: app.js - PWA su GitHub Pages
   Motore dati: Apps Script (foglio, calendario, Drive)
   ========================================================= */

var S = {
  dati: null,
  vista: "home",
  calAnno: 0,
  calMese: 0,
  tipo: "FERIE",
  precompila: null,
  filtro: "gestire",
  rapportinoMese: "",
  esitoRapportino: null,
  mailCorrente: null,
  festCache: {}
};

var VERSIONE = "1.0.0";
var CHIAVE_CFG = "pps.cfg";
var CHIAVE_DATI = "pps.dati";
var PDF_CORRENTE = null;

var GIORNI = ["domenica", "lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato"];
var MESI = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
var NOMI_STATO = { "IN ATTESA": "In attesa", "APPROVATA": "Approvata", "RESPINTA": "Respinta", "ANNULLATA": "Annullata", "COMUNICATA": "Comunicata", "REGISTRATA": "Registrata" };
var STATI_CHIUSI = ["ANNULLATA", "RESPINTA"];

/* ---------------------------------------------------------
   UTILITA
   --------------------------------------------------------- */
function el(id) { return document.getElementById(id); }

function esc(s) {
  return String(s === undefined || s === null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function pad2(n) { return (n < 10 ? "0" : "") + String(n); }
function maiusc(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ""; }
function isoDa(a, m, g) { return a + "-" + pad2(m) + "-" + pad2(g); }
function dataDaIso(iso) { var p = String(iso).split("-"); return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]), 12, 0, 0); }
function isoDaData(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
function piuGiorni(iso, n) { var d = dataDaIso(iso); d.setDate(d.getDate() + n); return isoDaData(d); }
function dataBreve(iso) { var p = String(iso).substr(0, 10).split("-"); return p[2] + "/" + p[1] + "/" + p[0]; }
function dataEstesa(iso) { return GIORNI[dataDaIso(iso).getDay()] + " " + dataBreve(iso); }

function pasqua(anno) {
  var a = anno % 19, b = Math.floor(anno / 100), c = anno % 100, d = Math.floor(b / 4), e = b % 4;
  var f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  var i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  var mese = Math.floor((h + l - 7 * m + 114) / 31), giorno = ((h + l - 7 * m + 114) % 31) + 1;
  return isoDa(anno, mese, giorno);
}

function festivita(anno) {
  if (S.festCache[anno]) return S.festCache[anno];
  var f = {};
  var p = pasqua(anno);
  f[anno + "-01-01"] = "Capodanno";
  f[anno + "-01-06"] = "Epifania";
  f[p] = "Pasqua";
  f[piuGiorni(p, 1)] = "Lunedì dell'Angelo";
  f[anno + "-04-25"] = "Liberazione";
  f[anno + "-05-01"] = "Festa del Lavoro";
  f[anno + "-06-02"] = "Festa della Repubblica";
  f[anno + "-08-15"] = "Ferragosto";
  if (anno >= 2026) f[anno + "-10-04"] = "San Francesco";
  f[anno + "-11-01"] = "Ognissanti";
  f[anno + "-12-08"] = "Immacolata";
  f[anno + "-12-25"] = "Natale";
  f[anno + "-12-26"] = "Santo Stefano";
  S.festCache[anno] = f;
  return f;
}

function chiusureMappa() {
  var m = {};
  (S.dati.chiusure || []).forEach(function (c) { m[c.data] = c.descrizione || "Chiusura aziendale"; });
  return m;
}

function infoGiorno(iso, chius) {
  var anno = Number(iso.substr(0, 4));
  var dow = dataDaIso(iso).getDay();
  var weekend = dow === 0 || dow === 6;
  var fest = festivita(anno)[iso] || "";
  var ch = (chius || chiusureMappa())[iso] || "";
  return { iso: iso, dow: dow, weekend: weekend, festivo: fest, chiusura: ch, lavorativo: !weekend && !fest && !ch };
}

function lavorativiTra(dal, al) {
  var ch = chiusureMappa();
  var n = 0, g = dal, i = 0;
  while (g <= al && i < 400) { if (infoGiorno(g, ch).lavorativo) n++; g = piuGiorni(g, 1); i++; }
  return n;
}

function prossimoLavorativo(iso) {
  var ch = chiusureMappa();
  var g = piuGiorni(iso, 1);
  for (var i = 0; i < 40; i++) { if (infoGiorno(g, ch).lavorativo) return g; g = piuGiorni(g, 1); }
  return g;
}

function minuti(hhmm) { var p = String(hhmm).split(":"); return Number(p[0]) * 60 + Number(p[1]); }

function fasce() {
  var imp = S.dati.impostazioni;
  return [[minuti(imp.MATTINA_INIZIO), minuti(imp.MATTINA_FINE)], [minuti(imp.POMERIGGIO_INIZIO), minuti(imp.POMERIGGIO_FINE)]];
}

function oreGiornata() {
  return fasce().reduce(function (t, f) { return t + (f[1] - f[0]); }, 0) / 60;
}

function orePermesso(dalle, alle) {
  var a = minuti(dalle), b = minuti(alle), tot = 0;
  fasce().forEach(function (f) { var i = Math.max(a, f[0]), e = Math.min(b, f[1]); if (e > i) tot += e - i; });
  return Math.round((tot / 60) * 100) / 100;
}

function formatoOre(ore) {
  var tot = Math.round(Number(ore) * 60), h = Math.floor(tot / 60), m = tot % 60;
  if (!m) return h + " h";
  if (!h) return m + " min";
  return h + " h " + m + " min";
}

function eventiAttivi() {
  return (S.dati.eventi || []).filter(function (e) { return STATI_CHIUSI.indexOf(e.stato) < 0; });
}

function classeEvento(e) {
  if (STATI_CHIUSI.indexOf(e.stato) >= 0) return "chiusa";
  if (e.tipo === "MALATTIA") return "malattia";
  if (e.tipo === "PRESENZA") return "extra";
  if (e.stato === "IN ATTESA") return "attesa";
  return "ok";
}

function nomePermesso(e) {
  if (e.sottotipo === "Altro") return "Permesso " + e.descrizione;
  if (e.sottotipo === "ROL") return "Permesso ROL";
  if (e.sottotipo === "Ex festività") return "Permesso ex festività";
  return e.sottotipo;
}

function titoloEvento(e) {
  if (e.tipo === "FERIE") return "Ferie";
  if (e.tipo === "MALATTIA") return "Malattia";
  if (e.tipo === "PRESENZA") return "Lavoro in giorno non lavorativo";
  return nomePermesso(e);
}

function etichettaBreve(e) {
  if (e.tipo === "FERIE") return "Ferie";
  if (e.tipo === "MALATTIA") return "Malattia";
  if (e.tipo === "PRESENZA") return "Lavoro";
  var base = e.sottotipo === "ROL" ? "ROL" : "Perm.";
  return e.intera ? base : base + " " + formatoOre(e.ore);
}

function periodoEvento(e) {
  if (e.tipo === "PERMESSO" && !e.intera) return dataEstesa(e.dal) + ", " + e.dalle + "-" + e.alle + " (" + formatoOre(e.ore) + ")";
  if (e.dal === e.al) return dataEstesa(e.dal);
  return "Dal " + dataBreve(e.dal) + " al " + dataBreve(e.al) + " (" + e.giorni + (e.giorni === 1 ? " giorno lavorativo)" : " giorni lavorativi)");
}

function destinatariAttivi(uso) {
  var a = [], cc = [];
  (S.dati.destinatari || []).forEach(function (d) {
    if (d.uso !== uso || d.stato !== "ATTIVO") return;
    if (d.campo === "A") a.push(d.nome); else cc.push(d.nome);
  });
  return { a: a, cc: cc };
}

function frasiDestinatari(uso) {
  var d = destinatariAttivi(uso);
  if (!d.a.length) return "Nessun destinatario attivo in A: aggiungilo nelle impostazioni.";
  return "La mail andrà a " + d.a.join(", ") + (d.cc.length ? ", in copia " + d.cc.join(", ") : "") + ".";
}

/* ---------------------------------------------------------
   CHIAMATE AL SERVER, AVVISI, FOGLIO A COMPARSA
   --------------------------------------------------------- */
function leggiCfg() {
  try { var c = JSON.parse(localStorage.getItem(CHIAVE_CFG) || "null"); return (c && c.url && c.token) ? c : null; } catch (e) { return null; }
}

function salvaCache() {
  try { localStorage.setItem(CHIAVE_DATI, JSON.stringify({ salvato: new Date().toISOString(), dati: S.dati })); } catch (e) { }
  aggiornaStatoSync(new Date().toISOString(), false);
}

function leggiCache() {
  try { return JSON.parse(localStorage.getItem(CHIAVE_DATI) || "null"); } catch (e) { return null; }
}

function oggiLocale() { return isoDaData(new Date()); }

function api(azione, args, cfgProva) {
  var cfg = cfgProva || leggiCfg();
  if (!cfg) return Promise.reject(new Error("Dispositivo non collegato."));
  var corpo = JSON.stringify({ token: cfg.token, azione: azione, args: args || [] });
  var codificato = encodeURIComponent(corpo);
  var richiesta;
  if (codificato.length < 1900) {
    richiesta = fetch(cfg.url + "?payload=" + codificato, { method: "GET", redirect: "follow", cache: "no-store" });
  } else {
    richiesta = fetch(cfg.url, { method: "POST", redirect: "follow", cache: "no-store", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: corpo });
  }
  return richiesta.then(function (r) {
    if (!r.ok) throw new Error("Il motore dati ha risposto con errore " + r.status + ".");
    return r.json();
  }).then(function (res) {
    if (!res.ok) { var e = new Error(res.errore || "Errore sconosciuto."); e.codice = res.codice || ""; throw e; }
    return res.dati;
  });
}

function messaggioErrore(err) {
  if (!navigator.onLine) return "Nessuna connessione: puoi consultare i dati, ma per registrare serve la rete.";
  if (err && err.codice === "TOKEN") return "Codice di accesso non valido: collega di nuovo il dispositivo.";
  if (err && err.name === "TypeError") return "Motore dati non raggiungibile: controlla la connessione o l'indirizzo /exec.";
  return (err && err.message) ? err.message : String(err);
}

function chiama(fn, args, ok) {
  el("attesa").classList.remove("nascosto");
  api(fn, args).then(function (res) {
    el("attesa").classList.add("nascosto");
    ok(res);
  }).catch(function (err) {
    el("attesa").classList.add("nascosto");
    avviso(messaggioErrore(err), true);
    if (err && err.codice === "TOKEN") mostraCollega();
  });
}

var timerAvviso = null;
function avviso(testo, errore) {
  var a = el("avviso");
  a.textContent = testo;
  a.className = "avviso visibile" + (errore ? " errore" : "");
  clearTimeout(timerAvviso);
  timerAvviso = setTimeout(function () { a.className = "avviso" + (errore ? " errore" : ""); }, errore ? 6000 : 3200);
}

function apriFoglio(html) {
  el("foglio").innerHTML = html;
  el("foglio").classList.remove("nascosto");
  el("velo").classList.remove("nascosto");
  el("foglio").scrollTop = 0;
}

function chiudiFoglio() {
  el("foglio").classList.add("nascosto");
  el("velo").classList.add("nascosto");
  el("foglio").innerHTML = "";
}

function copia(testo) {
  var fatto = function () { avviso("Copiato"); };
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(testo).then(fatto, function () { copiaVecchio(testo); });
      return;
    }
  } catch (e) { }
  copiaVecchio(testo);
}

function copiaVecchio(testo) {
  var t = document.createElement("textarea");
  t.value = testo;
  t.setAttribute("readonly", "");
  t.style.position = "fixed";
  t.style.top = "-200px";
  document.body.appendChild(t);
  t.select();
  t.setSelectionRange(0, testo.length);
  try { document.execCommand("copy"); avviso("Copiato"); } catch (e) { avviso("Copia non riuscita: seleziona il testo a mano", true); }
  document.body.removeChild(t);
}

/* ---------------------------------------------------------
   AVVIO E NAVIGAZIONE
   --------------------------------------------------------- */
function avvio() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(function () { });
  }
  window.addEventListener("online", function () { sincronizza(false); });
  window.addEventListener("offline", function () { aggiornaStatoSync(null, true); });
  if (!leggiCfg()) { mostraCollega(); return; }
  var cache = leggiCache();
  if (cache && cache.dati) {
    S.dati = cache.dati;
    S.dati.oggi = oggiLocale();
    inizializzaVista();
    aggiornaStatoSync(cache.salvato, !navigator.onLine);
    sincronizza(false, true);
  } else {
    sincronizza(true);
  }
}

function sincronizza(bloccante, silenzioso) {
  if (!leggiCfg()) return;
  if (bloccante) el("attesa").classList.remove("nascosto");
  el("statoSync").textContent = "Aggiornamento in corso";
  api("getDatiIniziali", []).then(function (d) {
    el("attesa").classList.add("nascosto");
    var primo = !S.dati;
    S.dati = d;
    S.dati.oggi = oggiLocale();
    S.festCache = {};
    salvaCache();
    if (primo) inizializzaVista();
    else if (["nuova"].indexOf(S.vista) < 0 && el("foglio").classList.contains("nascosto")) vai(S.vista, true);
    if (!silenzioso) avviso("Dati aggiornati");
  }).catch(function (err) {
    el("attesa").classList.add("nascosto");
    var cache = leggiCache();
    aggiornaStatoSync(cache ? cache.salvato : null, true);
    if (err && err.codice === "TOKEN") { mostraCollega(); avviso(messaggioErrore(err), true); return; }
    if (!silenzioso || !S.dati) avviso(messaggioErrore(err), true);
  });
}

function aggiornaStatoSync(quando, offline) {
  var t = el("statoSync");
  if (!quando) { t.textContent = offline ? "Offline" : "Pre System"; t.classList.toggle("offline", !!offline); return; }
  var d = new Date(quando);
  var ora = pad2(d.getHours()) + ":" + pad2(d.getMinutes());
  var giorno = isoDaData(d) === oggiLocale() ? "oggi" : dataBreve(isoDaData(d));
  t.textContent = (offline ? "Offline, dati di " : "Aggiornato ") + giorno + " alle " + ora;
  t.classList.toggle("offline", !!offline);
}

function inizializzaVista() {
  document.body.classList.remove("scollegato");
  var o = dataDaIso(S.dati.oggi);
  S.calAnno = o.getFullYear();
  S.calMese = o.getMonth() + 1;
  var prec = new Date(o.getFullYear(), o.getMonth() - 1, 1);
  S.rapportinoMese = prec.getFullYear() + "-" + pad2(prec.getMonth() + 1);
  var v = new URLSearchParams(location.search).get("v") || "home";
  if (location.search && history.replaceState) history.replaceState(null, "", location.pathname);
  applicaVistaIniziale(v);
}

function applicaVistaIniziale(v) {
  var tipi = { ferie: "FERIE", permesso: "PERMESSO", malattia: "MALATTIA", presenza: "PRESENZA" };
  if (tipi[v]) { S.tipo = tipi[v]; vai("nuova"); return; }
  if (["richieste", "rapportino", "impostazioni"].indexOf(v) >= 0) { vai(v); return; }
  vai("home");
}

function vai(vista, mantieniScroll) {
  if (!S.dati && vista !== "collega") return;
  S.vista = vista;
  var viste = ["collega", "home", "nuova", "richieste", "rapportino", "impostazioni"];
  viste.forEach(function (v) { el("v-" + v).classList.toggle("attiva", v === vista); });
  Array.prototype.forEach.call(document.querySelectorAll(".scheda"), function (b) {
    b.classList.toggle("attiva", b.getAttribute("data-vista") === vista);
  });
  if (vista === "home") renderHome();
  if (vista === "nuova") renderNuova();
  if (vista === "richieste") renderRichieste();
  if (vista === "rapportino") renderRapportino();
  if (vista === "impostazioni") renderImpostazioni();
  if (!mantieniScroll) window.scrollTo(0, 0);
}

/* ---------------------------------------------------------
   COLLEGAMENTO DEL DISPOSITIVO
   --------------------------------------------------------- */
function mostraCollega() {
  document.body.classList.add("scollegato");
  var cfg = leggiCfg() || {};
  var h = "<div class='collega'><h1>Collega questo dispositivo</h1>";
  h += "<p class='aiuto'>Serve una volta sola per ogni dispositivo. I due valori li trovi nel registro di esecuzione della funzione mostraCodiceAccesso in Apps Script e nella finestra di deployment.</p>";
  h += "<div class='blocco'>";
  h += "<div class='campo'><label for='k-url'>Indirizzo del motore dati (termina con /exec)</label><input type='url' id='k-url' autocomplete='off' autocapitalize='off' spellcheck='false' value='" + esc(cfg.url || "") + "'></div>";
  h += "<div class='campo'><label for='k-token'>Codice di accesso</label><input type='text' id='k-token' autocomplete='off' autocapitalize='off' spellcheck='false' value=''></div>";
  h += "<button type='button' class='btn btn-primario' onclick='collega()'>Collega</button>";
  h += "</div><div class='versione'>Presenze Pre System, versione " + VERSIONE + "</div></div>";
  el("v-collega").innerHTML = h;
  vai("collega");
}

function collega() {
  var url = valore("k-url").replace(/\s/g, "");
  var token = valore("k-token").replace(/\s/g, "");
  if (!/^https:\/\/script\.google\.com\/.+\/exec$/.test(url)) { avviso("L'indirizzo deve essere quello della web app e terminare con /exec.", true); return; }
  if (token.length < 30) { avviso("Il codice di accesso sembra incompleto.", true); return; }
  var cfg = { url: url, token: token };
  el("attesa").classList.remove("nascosto");
  api("getDatiIniziali", [], cfg).then(function (d) {
    el("attesa").classList.add("nascosto");
    localStorage.setItem(CHIAVE_CFG, JSON.stringify(cfg));
    S.dati = d;
    S.dati.oggi = oggiLocale();
    salvaCache();
    inizializzaVista();
    avviso("Dispositivo collegato");
  }).catch(function (err) {
    el("attesa").classList.add("nascosto");
    avviso(messaggioErrore(err), true);
  });
}

function scollega() {
  var h = "<h2>Scollegare questo dispositivo?</h2><div class='sottotitolo'>Vengono cancellati da questo dispositivo il codice di accesso e la copia dei dati. Sul foglio Google non cambia nulla.</div>";
  h += "<button type='button' class='btn btn-pericolo' onclick='confermaScollega()'>Scollega</button>";
  h += "<button type='button' class='btn btn-testo' onclick='chiudiFoglio()'>Annulla</button>";
  apriFoglio(h);
}

function confermaScollega() {
  localStorage.removeItem(CHIAVE_CFG);
  localStorage.removeItem(CHIAVE_DATI);
  S.dati = null;
  chiudiFoglio();
  mostraCollega();
}

/* ---------------------------------------------------------
   CALENDARIO
   --------------------------------------------------------- */
function spostaMese(delta) {
  var d = new Date(S.calAnno, S.calMese - 1 + delta, 1);
  S.calAnno = d.getFullYear();
  S.calMese = d.getMonth() + 1;
  renderHome();
}

function meseCorrente() {
  var o = dataDaIso(S.dati.oggi);
  S.calAnno = o.getFullYear();
  S.calMese = o.getMonth() + 1;
  renderHome();
}

function renderHome() {
  var a = S.calAnno, m = S.calMese, oggi = S.dati.oggi;
  var ch = chiusureMappa();
  var attivi = eventiAttivi();
  var h = [];
  h.push("<div class='cal-testa'><h1 class='cal-titolo'>" + maiusc(MESI[m - 1]) + " " + a + "</h1>");
  h.push("<div class='cal-nav'><button type='button' class='btn-nav' onclick='spostaMese(-1)' aria-label='Mese precedente'>&lsaquo;</button>");
  h.push("<button type='button' class='btn-nav' onclick='meseCorrente()' aria-label='Mese corrente'>&bull;</button>");
  h.push("<button type='button' class='btn-nav' onclick='spostaMese(1)' aria-label='Mese successivo'>&rsaquo;</button></div></div>");

  h.push("<div class='cal-griglia'>");
  ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"].forEach(function (g) { h.push("<div class='cal-gs'>" + g + "</div>"); });
  var offset = (dataDaIso(isoDa(a, m, 1)).getDay() + 6) % 7;
  for (var i = 0; i < offset; i++) h.push("<div class='cal-vuoto'></div>");
  var n = new Date(a, m, 0).getDate();
  var conta = { lav: 0, ferie: 0, perm: 0, mal: 0 };
  var oreG = oreGiornata();
  for (var g = 1; g <= n; g++) {
    var iso = isoDa(a, m, g);
    var info = infoGiorno(iso, ch);
    var evs = attivi.filter(function (e) { return e.dal <= iso && e.al >= iso; });
    if (info.lavorativo) {
      conta.lav++;
      evs.forEach(function (e) {
        if (e.tipo === "FERIE") conta.ferie++;
        if (e.tipo === "MALATTIA") conta.mal++;
        if (e.tipo === "PERMESSO") conta.perm += e.intera ? oreG : e.ore;
      });
    }
    var cls = "cal-g";
    if (!info.lavorativo) cls += " cal-nl";
    if (info.festivo || info.chiusura) cls += " cal-fest-g";
    if (iso === oggi) cls += " cal-oggi";
    var et = "";
    evs.forEach(function (e) {
      if (!info.lavorativo && e.tipo !== "PRESENZA") return;
      et += "<span class='cal-ev ev-" + classeEvento(e) + "'>" + esc(etichettaBreve(e)) + "</span>";
    });
    if (!et && (info.festivo || info.chiusura)) et = "<span class='cal-fest'>" + esc(info.festivo || info.chiusura) + "</span>";
    h.push("<button type='button' class='" + cls + "' onclick='apriGiorno(\"" + iso + "\")' aria-label='" + esc(dataEstesa(iso)) + "'><span class='cal-n'>" + g + "</span>" + et + "</button>");
  }
  h.push("</div>");

  h.push("<div class='legenda'><span><i style='background:#2E7D52'></i>Approvata</span><span><i style='background:#B07A08'></i>In attesa</span><span><i style='background:#B03A3A'></i>Malattia</span><span><i style='background:#2F5FB0'></i>Lavoro festivo</span><span><i class='l-nl'></i>Non lavorativo</span></div>");

  h.push("<div class='numeri'>");
  h.push("<div class='numero'><b>" + conta.lav + "</b><span>giorni lavorativi</span></div>");
  h.push("<div class='numero'><b>" + conta.ferie + "</b><span>giorni di ferie</span></div>");
  h.push("<div class='numero'><b>" + formatoOre(conta.perm) + "</b><span>di permesso</span></div>");
  h.push("<div class='numero'><b>" + conta.mal + "</b><span>giorni di malattia</span></div>");
  h.push("</div>");

  var prossimi = attivi.filter(function (e) { return e.al >= oggi; }).sort(function (x, y) { return x.dal < y.dal ? -1 : 1; }).slice(0, 6);
  h.push("<div class='sezione-titolo'><h2>Prossime assenze e presenze</h2></div>");
  if (!prossimi.length) h.push("<div class='vuoto'>Nessuna assenza in programma. Tocca un giorno del calendario per registrarne una.</div>");
  else h.push("<div class='lista'>" + prossimi.map(voceEvento).join("") + "</div>");
  el("v-home").innerHTML = h.join("");
}

function voceEvento(e) {
  var c = classeEvento(e);
  return "<button type='button' class='voce voce-" + c + "' onclick='apriEvento(\"" + e.id + "\")'>" +
    "<div class='voce-corpo'><div class='voce-titolo'>" + esc(titoloEvento(e)) + "</div><div class='voce-sub'>" + esc(periodoEvento(e)) + "</div></div>" +
    "<span class='pill pill-" + c + "'>" + esc(NOMI_STATO[e.stato] || e.stato) + "</span></button>";
}

function apriGiorno(iso) {
  var info = infoGiorno(iso);
  var evs = (S.dati.eventi || []).filter(function (e) { return e.dal <= iso && e.al >= iso && STATI_CHIUSI.indexOf(e.stato) < 0; });
  var nota = info.festivo ? info.festivo : (info.chiusura ? "Chiusura aziendale: " + info.chiusura : (info.weekend ? "Giorno non lavorativo" : "Giorno lavorativo"));
  var h = "<h2>" + esc(maiusc(dataEstesa(iso))) + "</h2><div class='sottotitolo'>" + esc(nota) + "</div>";
  if (evs.length) h += "<div class='lista' style='margin-bottom:14px'>" + evs.map(voceEvento).join("") + "</div>";
  if (info.lavorativo) {
    h += "<button type='button' class='btn btn-primario' onclick='nuovaDa(\"FERIE\",\"" + iso + "\")'>Richiedi ferie</button>";
    h += "<button type='button' class='btn' onclick='nuovaDa(\"PERMESSO\",\"" + iso + "\")'>Richiedi un permesso</button>";
    h += "<button type='button' class='btn' onclick='nuovaDa(\"MALATTIA\",\"" + iso + "\")'>Comunica malattia</button>";
  } else if (!evs.some(function (e) { return e.tipo === "PRESENZA"; })) {
    h += "<button type='button' class='btn btn-primario' onclick='nuovaDa(\"PRESENZA\",\"" + iso + "\")'>Segna che ho lavorato</button>";
  }
  h += "<button type='button' class='btn btn-testo' onclick='chiudiFoglio()'>Chiudi</button>";
  apriFoglio(h);
}

function nuovaDa(tipo, iso) {
  chiudiFoglio();
  S.tipo = tipo;
  S.precompila = { dal: iso };
  vai("nuova");
}

/* ---------------------------------------------------------
   NUOVA REGISTRAZIONE
   --------------------------------------------------------- */
function scegliTipo(t) {
  S.tipo = t;
  renderNuova();
}

function renderNuova() {
  var imp = S.dati.impostazioni;
  var oggi = S.dati.oggi;
  var dal = (S.precompila && S.precompila.dal) ? S.precompila.dal : oggi;
  var tipi = [["FERIE", "Ferie"], ["PERMESSO", "Permesso"], ["MALATTIA", "Malattia"], ["PRESENZA", "Weekend o festivo"]];
  var h = [];
  h.push("<div class='segmenti' role='tablist'>");
  tipi.forEach(function (t) {
    h.push("<button type='button' role='tab' class='segmento" + (S.tipo === t[0] ? " attivo" : "") + "' onclick='scegliTipo(\"" + t[0] + "\")'>" + t[1] + "</button>");
  });
  h.push("</div><div class='blocco'>");

  if (S.tipo === "FERIE") {
    h.push("<h3>Richiesta di ferie</h3>");
    h.push("<div class='riga2'><div class='campo'><label for='f-dal'>Dal</label><input type='date' id='f-dal' value='" + dal + "' oninput='sincronizzaAl()'></div>");
    h.push("<div class='campo'><label for='f-al'>Al</label><input type='date' id='f-al' value='" + dal + "' oninput='aggiornaAnteprima()'></div></div>");
  }

  if (S.tipo === "PERMESSO") {
    h.push("<h3>Richiesta di permesso</h3>");
    h.push("<div class='campo'><label for='f-sottotipo'>Tipo di permesso</label><select id='f-sottotipo' onchange='aggiornaCampiPermesso()'>");
    S.dati.sottotipiPermesso.forEach(function (s) { h.push("<option value='" + esc(s) + "'>" + esc(s) + "</option>"); });
    h.push("</select></div>");
    h.push("<div class='campo nascosto' id='c-descr'><label for='f-descr'>Descrizione</label><input type='text' id='f-descr' placeholder='Es. visita, pratica, assemblea'></div>");
    h.push("<label class='spunta'><input type='checkbox' id='f-intera' onchange='aggiornaCampiPermesso()'> Giornata intera</label>");
    h.push("<div id='c-orario'><div class='campo'><label for='f-giorno'>Giorno</label><input type='date' id='f-giorno' value='" + dal + "' oninput='aggiornaAnteprima()'></div>");
    h.push("<div class='riga2'><div class='campo'><label for='f-dalle'>Dalle</label><input type='time' id='f-dalle' step='900' value='" + esc(imp.POMERIGGIO_INIZIO) + "' oninput='aggiornaAnteprima()'></div>");
    h.push("<div class='campo'><label for='f-alle'>Alle</label><input type='time' id='f-alle' step='900' value='" + esc(imp.POMERIGGIO_FINE) + "' oninput='aggiornaAnteprima()'></div></div></div>");
    h.push("<div id='c-giorni' class='nascosto'><div class='riga2'><div class='campo'><label for='f-dal'>Dal</label><input type='date' id='f-dal' value='" + dal + "' oninput='sincronizzaAl()'></div>");
    h.push("<div class='campo'><label for='f-al'>Al</label><input type='date' id='f-al' value='" + dal + "' oninput='aggiornaAnteprima()'></div></div></div>");
  }

  if (S.tipo === "MALATTIA") {
    h.push("<h3>Comunicazione di malattia</h3>");
    h.push("<div class='riga2'><div class='campo'><label for='f-dal'>Dal</label><input type='date' id='f-dal' value='" + dal + "' oninput='sincronizzaAl()'></div>");
    h.push("<div class='campo'><label for='f-al'>Al</label><input type='date' id='f-al' value='" + dal + "' oninput='aggiornaAnteprima()'></div></div>");
    h.push("<div class='campo'><label for='f-protocollo'>Numero di protocollo del certificato (facoltativo)</label><input type='text' id='f-protocollo' autocapitalize='characters' autocomplete='off'></div>");
  }

  if (S.tipo === "PRESENZA") {
    h.push("<h3>Lavoro in un giorno non lavorativo</h3>");
    h.push("<p class='aiuto'>Sabato, domenica, festività o chiusura aziendale in cui hai lavorato. Viene conteggiato come presenza nel rapportino. Non parte nessuna mail.</p>");
    h.push("<div class='campo'><label for='f-dal'>Giorno</label><input type='date' id='f-dal' value='" + dal + "' oninput='aggiornaAnteprima()'></div>");
  }

  h.push("<div class='campo'><label for='f-note'>Note (facoltative)</label><textarea id='f-note' placeholder='" + (S.tipo === "PRESENZA" ? "Es. fiera, sopralluogo in cantiere" : "Compaiono nel testo della mail") + "'></textarea></div>");
  h.push("<div class='anteprima' id='anteprima'></div>");
  if (S.tipo !== "PRESENZA") h.push("<div class='nota-dest'>" + esc(frasiDestinatari("RICHIESTE")) + "</div>");
  h.push("<button type='button' class='btn btn-primario' id='btnSalva' onclick='salvaNuova()'>" + (S.tipo === "PRESENZA" ? "Registra la presenza" : "Registra e prepara la mail") + "</button>");
  h.push("</div>");
  el("v-nuova").innerHTML = h.join("");
  if (S.tipo === "PERMESSO") aggiornaCampiPermesso();
  aggiornaAnteprima();
}

function valore(id) { var x = el(id); return x ? String(x.value || "").trim() : ""; }

function sincronizzaAl() {
  var dal = valore("f-dal");
  var al = el("f-al");
  if (al && (!al.value || al.value < dal)) al.value = dal;
  aggiornaAnteprima();
}

function aggiornaCampiPermesso() {
  var intera = el("f-intera").checked;
  el("c-orario").classList.toggle("nascosto", intera);
  el("c-giorni").classList.toggle("nascosto", !intera);
  el("c-descr").classList.toggle("nascosto", valore("f-sottotipo") !== "Altro");
  aggiornaAnteprima();
}

function aggiornaAnteprima() {
  var box = el("anteprima");
  if (!box) return;
  var testo = "", errore = false;
  var dal = valore("f-dal"), al = valore("f-al") || dal;
  if (S.tipo === "FERIE" || S.tipo === "MALATTIA" || (S.tipo === "PERMESSO" && el("f-intera").checked)) {
    if (!dal) { testo = "Scegli la data di inizio."; errore = true; }
    else if (al < dal) { testo = "La data finale è precedente a quella iniziale."; errore = true; }
    else {
      var n = lavorativiTra(dal, al);
      if (!n && S.tipo !== "MALATTIA") { testo = "Nel periodo scelto non ci sono giorni lavorativi."; errore = true; }
      else {
        testo = n + (n === 1 ? " giorno lavorativo" : " giorni lavorativi");
        if (S.tipo === "FERIE") testo += ". Rientro previsto " + dataEstesa(prossimoLavorativo(al)) + ".";
        else testo += ".";
      }
    }
  } else if (S.tipo === "PERMESSO") {
    var giorno = valore("f-giorno"), dalle = valore("f-dalle"), alle = valore("f-alle");
    if (!giorno || !dalle || !alle) { testo = "Indica giorno e orario."; errore = true; }
    else if (!infoGiorno(giorno).lavorativo) { testo = "Il giorno scelto non è lavorativo."; errore = true; }
    else if (minuti(alle) <= minuti(dalle)) { testo = "L'ora di fine deve essere successiva all'ora di inizio."; errore = true; }
    else {
      var ore = orePermesso(dalle, alle);
      if (ore <= 0) { testo = "L'orario scelto è fuori dall'orario di lavoro."; errore = true; }
      else testo = formatoOre(ore) + " di permesso, pausa pranzo esclusa.";
    }
  } else if (S.tipo === "PRESENZA") {
    if (!dal) { testo = "Scegli il giorno."; errore = true; }
    else if (infoGiorno(dal).lavorativo) { testo = "Il giorno scelto è già lavorativo: la presenza è conteggiata in automatico."; errore = true; }
    else testo = maiusc(dataEstesa(dal)) + " verrà conteggiato come giorno di presenza.";
  }
  box.textContent = testo;
  box.classList.toggle("errore", errore);
}

function salvaNuova() {
  var p = { tipo: S.tipo, note: valore("f-note") };
  if (S.tipo === "FERIE" || S.tipo === "MALATTIA") { p.dal = valore("f-dal"); p.al = valore("f-al"); }
  if (S.tipo === "MALATTIA") p.protocollo = valore("f-protocollo");
  if (S.tipo === "PRESENZA") { p.dal = valore("f-dal"); p.al = p.dal; }
  if (S.tipo === "PERMESSO") {
    p.sottotipo = valore("f-sottotipo");
    p.descrizione = valore("f-descr");
    p.intera = el("f-intera").checked;
    if (p.intera) { p.dal = valore("f-dal"); p.al = valore("f-al"); }
    else { p.dal = valore("f-giorno"); p.al = p.dal; p.dalle = valore("f-dalle"); p.alle = valore("f-alle"); }
  }
  chiama("salvaEvento", [p], function (res) {
    S.dati.eventi.push(res.evento);
    S.precompila = null;
    salvaCache();
    if (res.mail) {
      mostraMail(res.mail, S.tipo === "MALATTIA" ? "Malattia registrata" : "Richiesta registrata", "È già nel calendario. Ora apri la mail in Outlook e inviala.");
    } else {
      avviso("Presenza registrata nel calendario");
    }
    renderNuova();
  });
}

/* ---------------------------------------------------------
   MAIL PRECOMPILATA
   --------------------------------------------------------- */
function mostraMail(mail, titolo, sottotitolo) {
  S.mailCorrente = mail;
  var h = "<h2>" + esc(titolo) + "</h2><div class='sottotitolo'>" + esc(sottotitolo) + "</div>";
  h += "<div class='mail-campi'><div><b>A</b> " + esc(mail.a.join(", ")) + "</div>";
  if (mail.cc && mail.cc.length) h += "<div><b>Cc</b> " + esc(mail.cc.join(", ")) + "</div>";
  h += "<div><b>Oggetto</b> " + esc(mail.oggetto) + "</div></div>";
  h += "<pre class='mail-corpo'>" + esc(mail.corpo) + "</pre>";
  h += "<a class='btn btn-primario' href='" + esc(mail.mailto) + "' target='_top'>Apri in Outlook</a>";
  h += "<button type='button' class='btn' onclick='copiaMail()'>Copia il testo</button>";
  h += "<button type='button' class='btn btn-testo' onclick='chiudiFoglio()'>Chiudi</button>";
  apriFoglio(h);
}

function copiaMail() {
  if (S.mailCorrente) copia(S.mailCorrente.corpo);
}

/* ---------------------------------------------------------
   RICHIESTE
   --------------------------------------------------------- */
function scegliFiltro(f) {
  S.filtro = f;
  renderRichieste();
}

function renderRichieste() {
  var oggi = S.dati.oggi;
  var tutti = (S.dati.eventi || []).slice().sort(function (a, b) { return a.dal < b.dal ? 1 : (a.dal > b.dal ? -1 : (a.creato < b.creato ? 1 : -1)); });
  var daGestire = tutti.filter(function (e) { return e.stato === "IN ATTESA"; });
  var lista;
  if (S.filtro === "gestire") lista = daGestire;
  else if (S.filtro === "prossime") lista = tutti.filter(function (e) { return e.al >= oggi && STATI_CHIUSI.indexOf(e.stato) < 0; }).reverse();
  else lista = tutti;
  var filtri = [["gestire", "In attesa (" + daGestire.length + ")"], ["prossime", "In programma"], ["tutte", "Tutte"]];
  var h = ["<div class='filtri'>"];
  filtri.forEach(function (f) { h.push("<button type='button' class='filtro" + (S.filtro === f[0] ? " attivo" : "") + "' onclick='scegliFiltro(\"" + f[0] + "\")'>" + f[1] + "</button>"); });
  h.push("</div>");
  if (!lista.length) {
    var vuoti = { gestire: "Nessuna richiesta in attesa di risposta.", prossime: "Niente in programma.", tutte: "Non hai ancora registrato nulla. Parti dalla sezione Nuova." };
    h.push("<div class='vuoto'>" + vuoti[S.filtro] + "</div>");
  } else {
    h.push("<div class='lista'>" + lista.map(voceEvento).join("") + "</div>");
  }
  el("v-richieste").innerHTML = h.join("");
}

function apriEvento(id) {
  var e = (S.dati.eventi || []).filter(function (x) { return x.id === id; })[0];
  if (!e) return;
  var h = "<h2>" + esc(titoloEvento(e)) + "</h2><div class='sottotitolo'>" + esc(periodoEvento(e)) + "</div>";
  h += "<div class='dettagli'>";
  h += "<div><span>Stato</span><span>" + esc(NOMI_STATO[e.stato] || e.stato) + "</span></div>";
  if (e.tipo === "PERMESSO") h += "<div><span>Ore</span><span>" + esc(formatoOre(e.ore)) + "</span></div>";
  if (e.protocollo) h += "<div><span>Protocollo certificato</span><span>" + esc(e.protocollo) + "</span></div>";
  if (e.note) h += "<div><span>Note</span><span>" + esc(e.note) + "</span></div>";
  h += "<div><span>Registrata il</span><span>" + esc(dataBreve(e.creato) + " " + e.creato.substr(11, 5)) + "</span></div>";
  if (e.aggiornato && e.aggiornato !== e.creato) h += "<div><span>Ultima modifica</span><span>" + esc(dataBreve(e.aggiornato) + " " + e.aggiornato.substr(11, 5)) + "</span></div>";
  h += "</div>";
  var b = function (testo, azione, classe) { return "<button type='button' class='btn " + (classe || "") + "' onclick='" + azione + "'>" + testo + "</button>"; };
  if (e.stato === "IN ATTESA") {
    h += b("Segna come approvata", "cambiaStato(\"" + id + "\",\"APPROVATA\")", "btn-primario");
    h += b("Segna come respinta", "confermaStato(\"" + id + "\",\"RESPINTA\")");
    h += b("Annulla la richiesta", "confermaStato(\"" + id + "\",\"ANNULLATA\")", "btn-pericolo");
    h += b("Prepara di nuovo la mail", "riapriMail(\"" + id + "\")");
  } else if (e.stato === "APPROVATA") {
    h += b("Annulla la richiesta", "confermaStato(\"" + id + "\",\"ANNULLATA\")", "btn-pericolo");
    h += b("Prepara di nuovo la mail", "riapriMail(\"" + id + "\")");
  } else if (e.stato === "COMUNICATA") {
    h += b("Annulla la comunicazione", "confermaStato(\"" + id + "\",\"ANNULLATA\")", "btn-pericolo");
    h += b("Prepara di nuovo la mail", "riapriMail(\"" + id + "\")");
  } else if (e.stato === "REGISTRATA") {
    h += b("Elimina questa presenza", "confermaStato(\"" + id + "\",\"ANNULLATA\")", "btn-pericolo");
  }
  h += b("Chiudi", "chiudiFoglio()", "btn-testo");
  apriFoglio(h);
}

function confermaStato(id, stato) {
  var e = (S.dati.eventi || []).filter(function (x) { return x.id === id; })[0];
  var testi = {
    "RESPINTA": ["Segnare come respinta?", "La registrazione esce dal calendario e dal rapportino. Non si potrà più modificare."],
    "ANNULLATA": ["Annullare?", e && e.tipo === "PRESENZA" ? "La presenza esce dal calendario e dal rapportino." : "Esce dal calendario e dal rapportino. Dopo potrai inviare la mail di annullamento."]
  };
  var t = testi[stato];
  var h = "<h2>" + esc(t[0]) + "</h2><div class='sottotitolo'>" + esc(t[1]) + "</div>";
  h += "<button type='button' class='btn btn-pericolo' onclick='cambiaStato(\"" + id + "\",\"" + stato + "\")'>Conferma</button>";
  h += "<button type='button' class='btn btn-testo' onclick='apriEvento(\"" + id + "\")'>Torna indietro</button>";
  apriFoglio(h);
}

function cambiaStato(id, stato) {
  chiama("aggiornaStato", [id, stato], function (res) {
    S.dati.eventi = res.eventi;
    salvaCache();
    vai(S.vista, true);
    if (res.mail) {
      mostraMail(res.mail, "Annullata", "Ora apri la mail di annullamento in Outlook e inviala.");
    } else {
      chiudiFoglio();
      avviso("Stato aggiornato: " + (NOMI_STATO[stato] || stato).toLowerCase());
    }
  });
}

function riapriMail(id) {
  chiama("mailEvento", [id], function (mail) {
    mostraMail(mail, "Mail pronta", "Testo e destinatari aggiornati alle impostazioni attuali.");
  });
}

/* ---------------------------------------------------------
   RAPPORTINO
   --------------------------------------------------------- */
function renderRapportino() {
  var o = dataDaIso(S.dati.oggi);
  var opz = [];
  for (var i = 0; i < 13; i++) {
    var d = new Date(o.getFullYear(), o.getMonth() - i, 1);
    var cod = d.getFullYear() + "-" + pad2(d.getMonth() + 1);
    opz.push("<option value='" + cod + "'" + (cod === S.rapportinoMese ? " selected" : "") + ">" + maiusc(MESI[d.getMonth()]) + " " + d.getFullYear() + "</option>");
  }
  var h = [];
  h.push("<div class='blocco'><h3>Rapportino mensile</h3>");
  h.push("<p class='aiuto'>Il giorno 1 di ogni mese alle 6:00 il PDF del mese precedente viene creato da solo su Drive. Qui puoi rigenerarlo dopo eventuali modifiche e preparare la mail.</p>");
  h.push("<div class='campo'><label for='r-mese'>Mese</label><select id='r-mese' onchange='cambiaMeseRapportino()'>" + opz.join("") + "</select></div>");
  var pend = inAttesaNelMese(S.rapportinoMese);
  if (pend) h.push("<div class='avvertenza'>" + (pend === 1 ? "C'è 1 richiesta ancora in attesa" : "Ci sono " + pend + " richieste ancora in attesa") + " in questo mese: nel PDF compare un asterisco. Se nel frattempo è stata approvata, aggiornala prima dalla sezione Richieste.</div>");
  h.push("<div class='nota-dest'>" + esc(frasiDestinatari("RAPPORTINO")) + "</div>");
  h.push("<button type='button' class='btn btn-primario' onclick='generaRapportino()'>Genera il rapportino</button></div>");

  var r = S.esitoRapportino;
  if (r && r.mese === S.rapportinoMese) {
    var t = r.totali;
    h.push("<div class='blocco esito'><h3>Rapportino di " + esc(r.titolo) + " pronto</h3>");
    h.push("<p class='aiuto'>Progressivo: " + esc(r.etichettaAnno) + "</p>");
    var ta = r.totaliAnno;
    var gg = function (n) { return n + (n === 1 ? " giorno" : " giorni"); };
    var fer = function (x) { return x.ferieGiorni ? formatoOre(x.ferieOre) + " (" + gg(x.ferieGiorni) + ")" : "0 h"; };
    h.push("<div class='dettagli'>");
    h.push("<div><span><b>Voce</b></span><span><b>Mese</b> / <b>anno</b></span></div>");
    h.push("<div><span>Presenze</span><span>" + gg(t.presenze) + " / " + gg(ta.presenze) + "</span></div>");
    h.push("<div><span>Ferie</span><span>" + fer(t) + " / " + fer(ta) + "</span></div>");
    h.push("<div><span>Permessi</span><span>" + formatoOre(t.permessiOre) + " / " + formatoOre(ta.permessiOre) + "</span></div>");
    h.push("<div><span>Malattia</span><span>" + gg(t.malattia) + " / " + gg(ta.malattia) + "</span></div>");
    h.push("</div>");
    h.push("<ol class='passi'><li>Apri la mail in Outlook: destinatari, oggetto e testo sono già pronti.</li><li>Torna qui e tocca Condividi il PDF, poi scegli Salva su File.</li><li>In Outlook tocca la graffetta, allega il PDF da File e invia.</li></ol>");
    h.push("<a class='btn btn-primario' href='" + esc(r.mail.mailto) + "'>Apri la mail in Outlook</a>");
    h.push("<button type='button' class='btn' onclick='condividiPdf()'>Condividi il PDF</button>");
    h.push("<a class='btn btn-testo' href='" + esc(r.url) + "' target='_blank' rel='noopener'>Visualizza su Drive</a>");
    h.push("</div>");
  }

  var arch = S.dati.rapportini || [];
  h.push("<div class='sezione-titolo'><h2>Archivio</h2></div>");
  if (!arch.length) h.push("<div class='vuoto'>Nessun rapportino generato finora.</div>");
  else {
    h.push("<div class='lista archivio'>");
    arch.forEach(function (a) {
      var p = a.mese.split("-");
      h.push("<div class='voce'><div class='voce-corpo'><div class='voce-titolo'>" + maiusc(MESI[Number(p[1]) - 1]) + " " + p[0] + "</div><div class='voce-sub'>Generato il " + esc(dataBreve(a.generato) + " " + a.generato.substr(11, 5)) + "</div></div><button type='button' class='btn btn-piccolo' onclick='prendiDallArchivio(\"" + a.id + "\")'>PDF</button></div>");
    });
    h.push("</div>");
  }
  el("v-rapportino").innerHTML = h.join("");
}

function inAttesaNelMese(cod) {
  var p = cod.split("-");
  var primo = cod + "-01";
  var ultimo = cod + "-" + pad2(new Date(Number(p[0]), Number(p[1]), 0).getDate());
  return (S.dati.eventi || []).filter(function (e) { return e.stato === "IN ATTESA" && e.dal <= ultimo && e.al >= primo; }).length;
}

function blobPdf(base64) {
  var bin = atob(base64);
  var byte = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) byte[i] = bin.charCodeAt(i);
  return new Blob([byte], { type: "application/pdf" });
}

function condividiPdf() {
  if (!PDF_CORRENTE) { avviso("Genera di nuovo il rapportino per avere il PDF su questo dispositivo.", true); return; }
  var blob = blobPdf(PDF_CORRENTE.pdf);
  var file = null;
  try { file = new File([blob], PDF_CORRENTE.nomeFile, { type: "application/pdf" }); } catch (e) { file = null; }
  if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
    navigator.share({ files: [file], title: PDF_CORRENTE.nomeFile }).catch(function (err) {
      if (err && err.name !== "AbortError") scaricaPdf(blob);
    });
  } else {
    scaricaPdf(blob);
  }
}

function scaricaPdf(blob) {
  var u = URL.createObjectURL(blob);
  var a = document.createElement("a");
  a.href = u;
  a.download = PDF_CORRENTE.nomeFile;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function () { URL.revokeObjectURL(u); }, 30000);
}

function prendiDallArchivio(idFile) {
  chiama("scaricaRapportino", [idFile], function (res) {
    PDF_CORRENTE = res;
    var h = "<h2>PDF pronto</h2><div class='sottotitolo'>" + esc(res.nomeFile) + "</div>";
    h += "<button type='button' class='btn btn-primario' onclick='condividiPdf()'>Condividi il PDF</button>";
    h += "<button type='button' class='btn btn-testo' onclick='chiudiFoglio()'>Chiudi</button>";
    apriFoglio(h);
  });
}

function cambiaMeseRapportino() {
  S.rapportinoMese = valore("r-mese");
  renderRapportino();
}

function generaRapportino() {
  var p = S.rapportinoMese.split("-");
  chiama("generaRapportino", [Number(p[0]), Number(p[1])], function (res) {
    PDF_CORRENTE = { nomeFile: res.nomeFile, pdf: res.pdf };
    res.pdf = "";
    S.esitoRapportino = res;
    S.dati.rapportini = res.rapportini;
    salvaCache();
    renderRapportino();
    avviso("Rapportino salvato su Drive");
  });
}

/* ---------------------------------------------------------
   IMPOSTAZIONI
   --------------------------------------------------------- */
function renderImpostazioni() {
  var imp = S.dati.impostazioni;
  var h = [];

  h.push("<div class='blocco'><h3>Destinatari</h3>");
  h.push("<p class='aiuto'>Gli indirizzi tolti restano in archivio come obsoleti, con la data, e si possono riattivare.</p>");
  [["RAPPORTINO", "Rapportino mensile"], ["RICHIESTE", "Richieste e comunicazioni"]].forEach(function (u) {
    var lista = (S.dati.destinatari || []).filter(function (d) { return d.uso === u[0]; });
    var attivi = lista.filter(function (d) { return d.stato === "ATTIVO"; }).sort(function (a, b) { return a.campo === b.campo ? 0 : (a.campo === "A" ? -1 : 1); });
    var obs = lista.filter(function (d) { return d.stato !== "ATTIVO"; });
    h.push("<div style='margin-top:12px'><b>" + u[1] + "</b></div>");
    if (!attivi.length) h.push("<div class='vuoto'>Nessun indirizzo attivo.</div>");
    attivi.forEach(function (d) { h.push(rigaDestinatario(d)); });
    if (obs.length) {
      h.push("<details><summary>Indirizzi obsoleti (" + obs.length + ")</summary>");
      obs.forEach(function (d) { h.push(rigaDestinatario(d)); });
      h.push("</details>");
    }
  });
  h.push("<button type='button' class='btn' style='margin-top:12px' onclick='apriNuovoDestinatario()'>Aggiungi un indirizzo</button></div>");

  h.push("<div class='blocco'><h3>Dati e orario di lavoro</h3>");
  h.push(campoTesto("i-NOME_DIPENDENTE", "Nome nelle mail", imp.NOME_DIPENDENTE, "text"));
  h.push(campoTesto("i-NOME_REPORT", "Nome nel rapportino", imp.NOME_REPORT, "text"));
  h.push(campoTesto("i-AZIENDA", "Azienda", imp.AZIENDA, "text"));
  h.push(campoTesto("i-DATA_INIZIO_RAPPORTO", "Data di inizio del rapporto (i giorni prima non vengono conteggiati)", imp.DATA_INIZIO_RAPPORTO, "date"));
  h.push("<div class='riga2'>" + campoTesto("i-MATTINA_INIZIO", "Mattina dalle", imp.MATTINA_INIZIO, "time") + campoTesto("i-MATTINA_FINE", "Mattina alle", imp.MATTINA_FINE, "time") + "</div>");
  h.push("<div class='riga2'>" + campoTesto("i-POMERIGGIO_INIZIO", "Pomeriggio dalle", imp.POMERIGGIO_INIZIO, "time") + campoTesto("i-POMERIGGIO_FINE", "Pomeriggio alle", imp.POMERIGGIO_FINE, "time") + "</div>");
  h.push("<div class='campo'><label for='i-FIRMA_MAIL'>Firma delle mail</label><textarea id='i-FIRMA_MAIL'>" + esc(imp.FIRMA_MAIL) + "</textarea></div>");
  h.push("<button type='button' class='btn btn-primario' onclick='salvaImpostazioni()'>Salva i dati</button></div>");

  h.push("<div class='blocco'><h3>Chiusure aziendali</h3>");
  h.push("<p class='aiuto'>Festività nazionali, Pasquetta e San Francesco sono già incluse. Aggiungi qui ponti, chiusure estive o natalizie e il santo patrono, se l'azienda chiude.</p>");
  h.push("<div class='riga2'>" + campoTesto("c-dal", "Dal", "", "date") + campoTesto("c-al", "Al", "", "date") + "</div>");
  h.push(campoTesto("c-descr", "Descrizione", "", "text"));
  h.push("<button type='button' class='btn' onclick='aggiungiChiusura()'>Aggiungi la chiusura</button>");
  var oggi = S.dati.oggi;
  var annoFa = piuGiorni(oggi, -365);
  var chius = (S.dati.chiusure || []).filter(function (c) { return c.data >= annoFa; });
  if (chius.length) {
    h.push("<div style='margin-top:8px'>");
    chius.forEach(function (c) {
      h.push("<div class='dest'><div class='dest-corpo'><div class='dest-nome'>" + esc(maiusc(dataEstesa(c.data))) + "</div><div class='dest-mail'>" + esc(c.descrizione) + "</div></div><button type='button' class='btn btn-piccolo btn-pericolo' onclick='eliminaChiusura(\"" + c.id + "\")'>Elimina</button></div>");
    });
    h.push("</div>");
  }
  h.push("</div>");

  h.push("<div class='blocco'><h3>Logo del rapportino</h3>");
  h.push("<img class='logo-anteprima nascosto' id='logoAnteprima' alt='Logo attuale'>");
  h.push("<p class='aiuto' id='logoStato'>" + (S.dati.haLogo ? "Logo caricato." : "Nessun logo: nell'intestazione compare il nome dell'azienda.") + "</p>");
  h.push("<div class='campo'><label for='logoFile'>Carica un PNG o JPG (massimo 2 MB, meglio con sfondo bianco o trasparente)</label><input type='file' id='logoFile' accept='image/png,image/jpeg' onchange='caricaLogo()'></div></div>");

  h.push("<div class='blocco'><h3>Promemoria mensile</h3>");
  h.push("<p class='aiuto'>Crea nel calendario Lavoro Pre System un evento alle 8:00 del giorno 1 di ogni mese, con notifica su tutti i dispositivi e il collegamento al rapportino.</p>");
  h.push("<button type='button' class='btn' onclick='creaPromemoria()'>" + (S.dati.haPromemoria ? "Ricrea il promemoria" : "Crea il promemoria") + "</button></div>");

  var cache = leggiCache();
  var cfg = leggiCfg() || {};
  h.push("<div class='blocco'><h3>Questo dispositivo</h3>");
  h.push("<div class='dettagli'>");
  h.push("<div><span>Ultimo aggiornamento</span><span>" + (cache && cache.salvato ? esc(dataBreve(isoDaData(new Date(cache.salvato))) + " " + pad2(new Date(cache.salvato).getHours()) + ":" + pad2(new Date(cache.salvato).getMinutes())) : "mai") + "</span></div>");
  h.push("<div><span>Motore dati</span><span>" + esc(cfg.url ? "..." + cfg.url.slice(-24) : "") + "</span></div>");
  h.push("<div><span>Versione app</span><span>" + VERSIONE + "</span></div>");
  h.push("</div>");
  h.push("<button type='button' class='btn btn-pericolo' onclick='scollega()'>Scollega questo dispositivo</button></div>");

  el("v-impostazioni").innerHTML = h.join("");
  if (S.dati.haLogo) {
    chiama("getLogoAnteprima", [], function (uri) { mostraLogo(uri); });
  }
}

function campoTesto(id, etichetta, val, tipo) {
  return "<div class='campo'><label for='" + id + "'>" + esc(etichetta) + "</label><input type='" + tipo + "' id='" + id + "' value='" + esc(val || "") + "'></div>";
}

function rigaDestinatario(d) {
  var attivo = d.stato === "ATTIVO";
  return "<div class='dest" + (attivo ? "" : " dest-obs") + "'><span class='dest-campo" + (d.campo === "CC" ? " cc" : "") + "'>" + (d.campo === "CC" ? "Cc" : "A") + "</span>" +
    "<div class='dest-corpo'><div class='dest-nome'>" + esc(d.nome) + "</div><div class='dest-mail'>" + esc(d.email) + (attivo ? "" : " (obsoleto dal " + esc(dataBreve(d.obsoleto)) + ")") + "</div></div>" +
    "<button type='button' class='btn btn-piccolo" + (attivo ? " btn-pericolo" : "") + "' onclick='statoDestinatario(\"" + d.id + "\",\"" + (attivo ? "OBSOLETO" : "ATTIVO") + "\")'>" + (attivo ? "Rendi obsoleto" : "Riattiva") + "</button></div>";
}

function apriNuovoDestinatario() {
  var h = "<h2>Nuovo indirizzo</h2><div class='sottotitolo'>Verrà usato da subito nelle mail preparate dall'app.</div>";
  h += campoTesto("d-nome", "Nome e cognome", "", "text");
  h += campoTesto("d-email", "Email", "", "email");
  h += "<div class='campo'><label for='d-uso'>Usato per</label><select id='d-uso'><option value='RICHIESTE'>Richieste e comunicazioni</option><option value='RAPPORTINO'>Rapportino mensile</option></select></div>";
  h += "<div class='campo'><label for='d-campo'>Campo</label><select id='d-campo'><option value='A'>A (destinatario principale)</option><option value='CC'>Cc (in copia)</option></select></div>";
  h += "<button type='button' class='btn btn-primario' onclick='salvaDestinatario()'>Aggiungi l'indirizzo</button>";
  h += "<button type='button' class='btn btn-testo' onclick='chiudiFoglio()'>Annulla</button>";
  apriFoglio(h);
}

function salvaDestinatario() {
  var d = { nome: valore("d-nome"), email: valore("d-email"), uso: valore("d-uso"), campo: valore("d-campo") };
  chiama("aggiungiDestinatario", [d], function (lista) {
    S.dati.destinatari = lista;
    salvaCache();
    chiudiFoglio();
    renderImpostazioni();
    avviso("Indirizzo aggiunto");
  });
}

function statoDestinatario(id, stato) {
  chiama("cambiaStatoDestinatario", [id, stato], function (lista) {
    S.dati.destinatari = lista;
    salvaCache();
    renderImpostazioni();
    avviso(stato === "OBSOLETO" ? "Indirizzo reso obsoleto" : "Indirizzo riattivato");
  });
}

function salvaImpostazioni() {
  var chiavi = ["NOME_DIPENDENTE", "NOME_REPORT", "AZIENDA", "DATA_INIZIO_RAPPORTO", "MATTINA_INIZIO", "MATTINA_FINE", "POMERIGGIO_INIZIO", "POMERIGGIO_FINE", "FIRMA_MAIL"];
  var d = {};
  chiavi.forEach(function (k) { d[k] = valore("i-" + k); });
  chiama("salvaImpostazioni", [d], function (imp) {
    S.dati.impostazioni = imp;
    salvaCache();
    avviso("Dati salvati");
  });
}

function aggiungiChiusura() {
  var d = { dal: valore("c-dal"), al: valore("c-al") || valore("c-dal"), descrizione: valore("c-descr") };
  chiama("aggiungiChiusura", [d], function (lista) {
    S.dati.chiusure = lista;
    S.festCache = {};
    salvaCache();
    renderImpostazioni();
    avviso("Chiusura aggiunta");
  });
}

function eliminaChiusura(id) {
  chiama("eliminaChiusura", [id], function (lista) {
    S.dati.chiusure = lista;
    salvaCache();
    renderImpostazioni();
    avviso("Chiusura eliminata");
  });
}

function caricaLogo() {
  var f = el("logoFile").files[0];
  if (!f) return;
  if (f.size > 2 * 1024 * 1024) { avviso("Il file supera 2 MB.", true); return; }
  var r = new FileReader();
  r.onload = function () {
    var base64 = String(r.result).split(",")[1];
    chiama("caricaLogo", [base64, f.type, f.name], function (uri) {
      S.dati.haLogo = true;
      salvaCache();
      mostraLogo(uri);
      el("logoStato").textContent = "Logo caricato. Comparirà nei prossimi rapportini.";
      avviso("Logo salvato");
    });
  };
  r.readAsDataURL(f);
}

function mostraLogo(uri) {
  var img = el("logoAnteprima");
  if (!img || !uri) return;
  img.src = uri;
  img.classList.remove("nascosto");
}

function creaPromemoria() {
  chiama("creaPromemoriaMensile", [], function (primo) {
    S.dati.haPromemoria = true;
    salvaCache();
    renderImpostazioni();
    avviso("Promemoria creato, il primo è il " + dataBreve(primo));
  });
}

avvio();
