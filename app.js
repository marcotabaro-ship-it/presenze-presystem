/* =========================================================
   LAVORO PRE SYSTEM - Marco Tabaro
   File: app.js - PWA su GitHub Pages (presenze, richieste, rapportino, impostazioni)
   Motore dati: Apps Script (foglio, calendario, Drive)
   ========================================================= */

var S = {
  dati: null,
  vista: "home",
  calAnno: 0,
  calMese: 0,
  tipo: "FERIE",
  precompila: null,
  filtro: "prossime",
  rapportinoMese: "",
  esitoRapportino: null,
  mailCorrente: null,
  festCache: {}
};

var VERSIONE = "2.2.1";
var MOTORE_URL = "https://script.google.com/macros/s/AKfycbySj9SRP6ypLpuLRW7nSOkRzedhBRIiHeO3WgsZh1kEFWQgQ_zj1izi7Jv_8ZSBkdSn/exec";
var APP_URL = "https://marcotabaro-ship-it.github.io/presenze-presystem/";
var CHIAVE_TOKEN = "pps.token";
var CHIAVE_DATI = "pps.dati";
var PDF_CORRENTE = null;

var GIORNI = ["domenica", "lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato"];
var MESI = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
var NOMI_STATO = { "IN ATTESA": "Approvata", "APPROVATA": "Approvata", "RESPINTA": "Respinta", "ANNULLATA": "Annullata", "COMUNICATA": "Comunicata", "REGISTRATA": "Registrata", "REVOCATA": "Revocata", "MODIFICATA": "Modificata" };
var STATI_CHIUSI = ["ANNULLATA", "RESPINTA", "REVOCATA", "MODIFICATA"];

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
  /* la chiusura aziendale resta un giorno lavorativo ma vale come ferie collettive */
  return { iso: iso, dow: dow, weekend: weekend, festivo: fest, chiusura: ch, lavorativo: !weekend && !fest, utile: !weekend && !fest && !ch };
}

function contaGiorni(dal, al, criterio) {
  var ch = chiusureMappa();
  var n = 0, g = dal, i = 0;
  while (g <= al && i < 400) { var x = infoGiorno(g, ch); if (criterio(x)) n++; g = piuGiorni(g, 1); i++; }
  return n;
}

function lavorativiTra(dal, al) { return contaGiorni(dal, al, function (x) { return x.lavorativo; }); }
function utiliTra(dal, al) { return contaGiorni(dal, al, function (x) { return x.utile; }); }
function chiusuraTra(dal, al) { return contaGiorni(dal, al, function (x) { return x.lavorativo && !!x.chiusura; }); }

function prossimoLavorativo(iso) {
  var ch = chiusureMappa();
  var g = piuGiorni(iso, 1);
  for (var i = 0; i < 60; i++) { if (infoGiorno(g, ch).utile) return g; g = piuGiorni(g, 1); }
  return g;
}

/* Periodi di chiusura raggruppati per ID: [{id, dal, al, descrizione}] */
function periodiChiusura() {
  var m = {};
  (S.dati.chiusure || []).forEach(function (c) {
    if (!m[c.id]) m[c.id] = { id: c.id, dal: c.data, al: c.data, descrizione: c.descrizione };
    if (c.data < m[c.id].dal) m[c.id].dal = c.data;
    if (c.data > m[c.id].al) m[c.id].al = c.data;
  });
  return Object.keys(m).map(function (k) { return m[k]; }).sort(function (a, b) { return a.dal < b.dal ? -1 : 1; });
}

function periodoChiusuraDi(iso) {
  return periodiChiusura().filter(function (p) { return p.dal <= iso && p.al >= iso; })[0] || null;
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
  return "ok";
}

function nomePermesso(e) {
  if (e.sottotipo === "Altro" && e.descrizione) return "Permesso " + e.descrizione;
  if (e.sottotipo && e.sottotipo !== "ROL" && e.sottotipo !== "Altro") return e.sottotipo;
  return "Permesso";
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
  var base = "Perm.";
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
  var t = "";
  try { t = localStorage.getItem(CHIAVE_TOKEN) || ""; } catch (e) { t = ""; }
  return t ? { url: MOTORE_URL, token: t } : null;
}

/* Estrae il codice di accesso da un link di collegamento (#k=...) o dal codice nudo */
function estraiToken(testo) {
  var t = String(testo || "").trim();
  var m = t.match(/[#&?]k=([a-f0-9]{64})/i);
  if (m) return m[1].toLowerCase();
  m = t.match(/^[a-f0-9]{64}$/i);
  return m ? t.toLowerCase() : "";
}

function linkCollegamento() {
  var cfg = leggiCfg();
  return cfg ? APP_URL + "#k=" + cfg.token : "";
}

function salvaCache() {
  try { localStorage.setItem(CHIAVE_DATI, JSON.stringify({ salvato: new Date().toISOString(), dati: S.dati })); } catch (e) { }
  aggiornaStatoSync(new Date().toISOString(), false);
}

function leggiCache() {
  try { return JSON.parse(localStorage.getItem(CHIAVE_DATI) || "null"); } catch (e) { return null; }
}

function oggiLocale() { return isoDaData(new Date()); }

/* Le chiamate al motore dati partono una alla volta (coda), per non sovrapporle.
   Google a volte risponde 404 anche se lo script ha lavorato correttamente:
   le letture vengono ritentate da sole, le scritture no (si eviterebbero doppioni). */
var CODA_API = Promise.resolve();
var AZIONI_RIPETIBILI = ["getDatiIniziali", "getSaldo", "ecoDati", "getLogoAnteprima", "ecoScaricaDocumento", "scaricaRapportino", "mailEvento",
  "reportPeriodo", "accediConPin", "sbloccaArea", "bloccaArea", "generaRapportino", "salvaImpostazioni", "salvaTesti", "salvaSaldo", "creaPromemoriaProva"];

function api(azione, args, cfgProva) {
  var p = CODA_API.then(function () { return apiConTentativi(azione, args, cfgProva, 0); });
  CODA_API = p.catch(function () { });
  return p;
}

function apiConTentativi(azione, args, cfgProva, tentativo) {
  return apiDiretta(azione, args, cfgProva).catch(function (err) {
    var transitorio = err && (err.stato === 404 || err.stato >= 500 || err.name === "TypeError");
    if (transitorio && AZIONI_RIPETIBILI.indexOf(azione) >= 0 && tentativo < 2 && navigator.onLine) {
      return new Promise(function (ok) { setTimeout(ok, 700 * (tentativo + 1)); }).then(function () {
        return apiConTentativi(azione, args, cfgProva, tentativo + 1);
      });
    }
    if (transitorio && AZIONI_RIPETIBILI.indexOf(azione) < 0 && navigator.onLine) {
      var e = new Error("Google non ha confermato la risposta: l'operazione potrebbe essere stata registrata comunque. Aggiorno i dati, controlla prima di ripeterla.");
      e.codice = "INCERTO";
      setTimeout(function () {
        sincronizza(false, true);
        if (S.vista === "fascicolo" && S.sess && typeof caricaEco === "function") caricaEco();
      }, 300);
      throw e;
    }
    throw err;
  });
}

function apiDiretta(azione, args, cfgProva) {
  var cfg = cfgProva || leggiCfg();
  if (!cfg && azione === "accediConPin") cfg = { url: MOTORE_URL, token: "" };
  if (!cfg) return Promise.reject(new Error("Dispositivo non collegato."));
  var corpo = JSON.stringify({ token: cfg.token, azione: azione, args: args || [], sess: (S.sess && S.sess.chiave) ? S.sess.chiave : "" });
  var codificato = encodeURIComponent(corpo);
  var richiesta;
  if (codificato.length < 1900) {
    richiesta = fetch(cfg.url + "?payload=" + codificato, { method: "GET", redirect: "follow", cache: "no-store" });
  } else {
    richiesta = fetch(cfg.url, { method: "POST", redirect: "follow", cache: "no-store", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: corpo });
  }
  return richiesta.then(function (r) {
    if (!r.ok) { var e1 = new Error("Il motore dati ha risposto con errore " + r.status + "."); e1.stato = r.status; throw e1; }
    return r.json();
  }).then(function (res) {
    if (!res.ok) { var e = new Error(res.errore || "Errore sconosciuto."); e.codice = res.codice || ""; throw e; }
    return res.dati;
  });
}

function messaggioErrore(err) {
  if (!navigator.onLine) return "Nessuna connessione: puoi consultare i dati, ma per registrare serve la rete.";
  if (err && err.codice === "TOKEN") return "Accesso scaduto o PIN cambiato: inserisci il PIN.";
  if (err && err.codice === "PIN") return err.message;
  if (err && err.codice === "AREA") return "Area riservata bloccata: inserisci il PIN.";
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
    if (err && err.codice === "AREA") { S.sess = null; S.eco = null; if (S.vista === "fascicolo") renderFascicolo(); }
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
/* Menu laterale (schermi larghi): aperto o compatto, scelta ricordata */
/* Clic sul logo in alto a sinistra: torna al calendario del mese corrente */
function vaiHome() {
  if (!S.dati || document.body.classList.contains("scollegato")) return;
  chiudiFoglio();
  var o = dataDaIso(S.dati.oggi);
  S.calAnno = o.getFullYear();
  S.calMese = o.getMonth() + 1;
  vai("home");
}

function alternaMenu() {
  var compatto = !document.body.classList.contains("menu-compatto");
  document.body.classList.toggle("menu-compatto", compatto);
  try { localStorage.setItem("pps.menu", compatto ? "compatto" : "aperto"); } catch (e) { }
}

function avvio() {
  try { if (localStorage.getItem("pps.menu") === "compatto") document.body.classList.add("menu-compatto"); } catch (e) { }
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(function () { });
  }
  window.addEventListener("online", function () { sincronizza(false); });
  window.addEventListener("offline", function () { aggiornaStatoSync(null, true); });
  var dalLink = estraiToken(location.hash);
  if (dalLink) {
    if (history.replaceState) history.replaceState(null, "", location.pathname + location.search);
    if (!leggiCfg() || leggiCfg().token !== dalLink) { provaCollegamento(dalLink); return; }
  }
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
  var tipi = { ferie: "FERIE", permesso: "PERMESSO", malattia: "MALATTIA", presenza: "PRESENZA", chiusura: "CHIUSURA" };
  if (tipi[v]) { S.tipo = tipi[v]; vai("nuova"); return; }
  if (["richieste", "rapportino", "impostazioni", "fascicolo"].indexOf(v) >= 0) { vai(v); return; }
  vai("home");
}

function vai(vista, mantieniScroll) {
  if (!S.dati && vista !== "collega") return;
  S.vista = vista;
  var viste = ["collega", "home", "nuova", "richieste", "rapportino", "fascicolo", "impostazioni"];
  viste.forEach(function (v) { el("v-" + v).classList.toggle("attiva", v === vista); });
  Array.prototype.forEach.call(document.querySelectorAll(".scheda, .menu-voce"), function (b) {
    b.classList.toggle("attiva", b.getAttribute("data-vista") === vista);
  });
  if (vista !== "home") { document.body.classList.remove("dash-fissa"); el("v-home").style.height = ""; }
  if (vista === "home") renderHome();
  if (vista === "nuova") renderNuova();
  if (vista === "richieste") renderRichieste();
  if (vista === "rapportino") renderRapportino();
  if (vista === "impostazioni") renderImpostazioni();
  if (vista === "fascicolo") renderFascicolo();
  if (!mantieniScroll) window.scrollTo(0, 0);
}

/* ---------------------------------------------------------
   COLLEGAMENTO DEL DISPOSITIVO
   --------------------------------------------------------- */
function mostraCollega() {
  document.body.classList.add("scollegato");
  var h = "<div class='collega'><h1>Accedi</h1>";
  h += "<p class='aiuto'>Inserisci il tuo PIN di 6 cifre. Serve una volta sola su questo dispositivo: poi l'app si apre direttamente dall'icona.</p>";
  h += "<div class='blocco'>";
  h += "<div class='campo'><label for='k-pin'>PIN</label><input type='password' id='k-pin' class='campo-pin' inputmode='numeric' pattern='[0-9]*' maxlength='6' autocomplete='current-password' oninput='pinDigitato()'></div>";
  h += "<button type='button' class='btn btn-primario' onclick='accediPin()'>Accedi</button>";
  h += "</div>";
  h += "<details class='altro-accesso'><summary>Non hai ancora un PIN? Usa il link di collegamento</summary><div class='blocco' style='margin-top:8px'>";
  h += "<button type='button' class='btn' onclick='incollaDagliAppunti()'>Incolla il link copiato</button>";
  h += "<div class='campo' style='margin-top:10px'><label for='k-token'>Oppure incolla qui il link o il codice di accesso</label><input type='text' id='k-token' autocomplete='off' autocapitalize='off' spellcheck='false'></div>";
  h += "<button type='button' class='btn' onclick='collega()'>Collega</button>";
  h += "</div></details>";
  h += "<div class='versione'>Lavoro Pre System, versione " + VERSIONE + "</div></div>";
  el("v-collega").innerHTML = h;
  vai("collega");
  setTimeout(function () { var p = el("k-pin"); if (p) p.focus(); }, 150);
}

function pinDigitato() {
  var p = el("k-pin");
  p.value = p.value.replace(/[^0-9]/g, "").slice(0, 6);
  if (p.value.length === 6) accediPin();
}

function accediPin() {
  var p = el("k-pin");
  var pin = p ? p.value : "";
  if (!/^[0-9]{6}$/.test(pin)) { avviso("Il PIN è di 6 cifre.", true); return; }
  el("attesa").classList.remove("nascosto");
  api("accediConPin", [pin]).then(function (res) {
    provaCollegamento(res.token);
  }).catch(function (err) {
    el("attesa").classList.add("nascosto");
    if (p) { p.value = ""; p.focus(); }
    avviso(messaggioErrore(err), true);
  });
}

function incollaDagliAppunti() {
  if (!navigator.clipboard || !navigator.clipboard.readText) { avviso("Incolla il link nel campo qui sotto e premi Collega.", true); return; }
  navigator.clipboard.readText().then(function (testo) {
    var t = estraiToken(testo);
    if (!t) { avviso("Negli appunti non c'è un link di collegamento valido.", true); return; }
    provaCollegamento(t);
  }).catch(function () { avviso("Incolla il link nel campo qui sotto e premi Collega.", true); });
}

function collega() {
  var t = estraiToken(valore("k-token"));
  if (!t) { avviso("Link o codice non valido: il codice è di 64 caratteri.", true); return; }
  provaCollegamento(t);
}

function provaCollegamento(token) {
  var cfg = { url: MOTORE_URL, token: token };
  el("attesa").classList.remove("nascosto");
  el("statoSync").textContent = "Collegamento in corso";
  api("getDatiIniziali", [], cfg).then(function (d) {
    el("attesa").classList.add("nascosto");
    localStorage.setItem(CHIAVE_TOKEN, token);
    S.dati = d;
    S.dati.oggi = oggiLocale();
    salvaCache();
    inizializzaVista();
    avviso("Dispositivo collegato");
  }).catch(function (err) {
    el("attesa").classList.add("nascosto");
    if (!el("v-collega").innerHTML) mostraCollega();
    avviso(messaggioErrore(err), true);
  });
}

function copiaLinkCollegamento() {
  var l = linkCollegamento();
  if (l) copia(l);
}

function scollega() {
  var h = "<h2>Scollegare questo dispositivo?</h2><div class='sottotitolo'>Vengono cancellati da questo dispositivo il codice di accesso e la copia dei dati. Sul foglio Google non cambia nulla.</div>";
  h += "<button type='button' class='btn btn-pericolo' onclick='confermaScollega()'>Scollega</button>";
  h += "<button type='button' class='btn btn-testo' onclick='chiudiFoglio()'>Annulla</button>";
  apriFoglio(h);
}

function confermaScollega() {
  S.sess = null;
  S.eco = null;
  localStorage.removeItem(CHIAVE_TOKEN);
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

/* Numero della settimana secondo ISO 8601 (la settimana inizia il lunedì) */
function settimanaIso(d) {
  var t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  var g = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - g);
  var inizioAnno = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t - inizioAnno) / 86400000 + 1) / 7);
}

function apriSceltaMese(anno) {
  var y = anno || S.calAnno;
  var oggi = dataDaIso(S.dati.oggi);
  var h = "<div class='scelta-anno'><button type='button' class='btn-nav' onclick='apriSceltaMese(" + (y - 1) + ")' aria-label='Anno precedente'>&lsaquo;</button><h2>" + y + "</h2><button type='button' class='btn-nav' onclick='apriSceltaMese(" + (y + 1) + ")' aria-label='Anno successivo'>&rsaquo;</button></div>";
  h += "<div class='scelta-mesi'>";
  MESI.forEach(function (nome, i) {
    var cls = "scelta-mese";
    if (y === S.calAnno && i + 1 === S.calMese) cls += " attivo";
    if (y === oggi.getFullYear() && i === oggi.getMonth()) cls += " corrente";
    h += "<button type='button' class='" + cls + "' onclick='vaiAMese(" + y + "," + (i + 1) + ")'>" + maiusc(nome) + "</button>";
  });
  h += "</div>";
  h += "<button type='button' class='btn' onclick='vaiAMese(" + oggi.getFullYear() + "," + (oggi.getMonth() + 1) + ")'>Torna a oggi</button>";
  h += "<button type='button' class='btn btn-testo' onclick='chiudiFoglio()'>Chiudi</button>";
  apriFoglio(h);
}

function vaiAMese(anno, mese) {
  S.calAnno = anno;
  S.calMese = mese;
  chiudiFoglio();
  renderHome();
}

function renderHome() {
  var a = S.calAnno, m = S.calMese, oggi = S.dati.oggi;
  var ch = chiusureMappa();
  var attivi = eventiAttivi();
  var h = [];
  /* Dashboard: su tablet e PC tre zone affiancate che stanno in una sola schermata, su telefono una colonna */
  h.push("<div class='home-dash'>");
  h.push("<div class='dash-pasti'>" + bloccoPastiHome() + "</div>");
  h.push("<div class='dash-cal'>");
  h.push("<div class='cal-testa'><button type='button' class='cal-titolo-btn' onclick='apriSceltaMese()' aria-label='Scegli mese e anno'><h1 class='cal-titolo'>" + maiusc(MESI[m - 1]) + " " + a + "</h1><span class='cal-freccia'>&#9662;</span></button>");
  h.push("<div class='cal-nav'><button type='button' class='btn-nav' onclick='spostaMese(-1)' aria-label='Mese precedente'>&lsaquo;</button>");
  h.push("<button type='button' class='btn-nav' onclick='meseCorrente()' aria-label='Mese corrente'>&bull;</button>");
  h.push("<button type='button' class='btn-nav' onclick='spostaMese(1)' aria-label='Mese successivo'>&rsaquo;</button></div></div>");

  var settimane = Math.ceil((((dataDaIso(isoDa(a, m, 1)).getDay() + 6) % 7) + new Date(a, m, 0).getDate()) / 7);
  h.push("<div class='cal-griglia' style='--settimane:" + settimane + "'>");
  h.push("<div class='cal-gs cal-gs-sett' title='Numero della settimana'>Sett.</div>");
  ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"].forEach(function (g) { h.push("<div class='cal-gs'>" + g + "</div>"); });
  var primoMese = isoDa(a, m, 1);
  var n = new Date(a, m, 0).getDate();
  var ultimoMese = isoDa(a, m, n);
  var offset = (dataDaIso(primoMese).getDay() + 6) % 7;
  var inizioGriglia = piuGiorni(primoMese, -offset);
  var conta = { lav: 0, ferie: 0, perm: 0, mal: 0 };
  var oreG = oreGiornata();
  var iso = inizioGriglia;
  var colonna = 0;
  while (iso <= ultimoMese || colonna !== 0) {
    if (colonna === 0) h.push("<div class='cal-sett'>" + settimanaIso(dataDaIso(iso)) + "</div>");
    var g = Number(iso.substr(8, 2));
    if (iso < primoMese || iso > ultimoMese) {
      var dir = iso < primoMese ? -1 : 1;
      var infoA = infoGiorno(iso, ch);
      h.push("<button type='button' class='cal-g cal-altro" + (infoA.lavorativo ? "" : " cal-nl") + "' onclick='spostaMese(" + dir + ")' aria-label='" + (dir < 0 ? "Vai al mese precedente" : "Vai al mese successivo") + "'><span class='cal-n'>" + g + "</span></button>");
    } else {
      var info = infoGiorno(iso, ch);
      var giornoIso = iso;
      var evs = attivi.filter(function (e) { return e.dal <= giornoIso && e.al >= giornoIso; });
      if (info.lavorativo) {
        conta.lav++;
        var interaG = evs.some(function (e) { return e.tipo === "FERIE" || e.tipo === "MALATTIA" || (e.tipo === "PERMESSO" && e.intera) || e.tipo === "PRESENZA"; });
        if (info.chiusura && !interaG) conta.ferie++;
        evs.forEach(function (e) {
          if (e.tipo === "FERIE") conta.ferie++;
          if (e.tipo === "MALATTIA") conta.mal++;
          if (e.tipo === "PERMESSO") conta.perm += e.intera ? oreG : e.ore;
        });
      }
      var cls = "cal-g";
      if (!info.lavorativo) cls += " cal-nl";
      if (info.festivo) cls += " cal-fest-g";
      if (iso === oggi) cls += " cal-oggi";
      var et = "";
      evs.forEach(function (e) {
        if (!info.lavorativo && e.tipo !== "PRESENZA") return;
        et += "<span class='cal-ev ev-" + classeEvento(e) + "'>" + esc(etichettaBreve(e)) + "</span>";
      });
      if (!et && info.festivo) et = "<span class='cal-fest'>" + esc(info.festivo) + "</span>";
      else if (!et && info.chiusura && info.lavorativo) et = "<span class='cal-ev ev-chiusura'>Ferie coll.</span>";
      h.push("<button type='button' class='" + cls + "' onclick='apriGiorno(\"" + iso + "\")' aria-label='" + esc(dataEstesa(iso)) + "'><span class='cal-n'>" + g + "</span>" + et + cellaPasto(iso, info, evs) + "</button>");
    }
    iso = piuGiorni(iso, 1);
    colonna = (colonna + 1) % 7;
  }
  h.push("</div>");

  h.push("<div class='legenda'><span><i style='background:#2E7D52'></i>Ferie e permessi</span><span><i style='background:#B03A3A'></i>Malattia</span><span><i style='background:#2F5FB0'></i>Lavoro festivo</span><span><i style='background:#8C959D'></i>Chiusura aziendale</span><span><i class='l-nl'></i>Non lavorativo</span></div>");
  h.push("</div>");

  h.push("<div class='dash-lato'><div class='lato-a'>");
  h.push("<div class='numeri'>");
  h.push("<div class='numero'><b>" + conta.lav + "</b><span>giorni lavorativi</span></div>");
  h.push("<div class='numero'><b>" + conta.ferie + "</b><span>giorni di ferie</span></div>");
  h.push("<div class='numero'><b>" + formatoOre(conta.perm) + "</b><span>di permesso</span></div>");
  h.push("<div class='numero'><b>" + conta.mal + "</b><span>giorni di malattia</span></div>");
  h.push("</div>");

  h.push(bloccoProvaHome());
  h.push(bloccoSaldoHome());
  h.push("</div>");

  var prossimi = attivi.filter(function (e) { return e.al >= oggi; }).sort(function (x, y) { return x.dal < y.dal ? -1 : 1; }).slice(0, 6);
  h.push("<div class='dash-prossimi'><div class='sezione-titolo'><h2>Prossime assenze e presenze</h2>" + (prossimi.length ? "<button type='button' class='btn btn-testo btn-piccolo' onclick='vai(\"richieste\")'>Vedi tutte</button>" : "") + "</div>");
  if (!prossimi.length) h.push("<div class='vuoto'>Nessuna assenza in programma. Tocca un giorno del calendario per registrarne una.</div>");
  else h.push("<div class='lista'>" + prossimi.map(voceEvento).join("") + "</div>");
  h.push("</div></div></div>");
  el("v-home").innerHTML = h.join("");
  adattaDashboard();
}

/* Su tablet e PC la dashboard occupa esattamente l'altezza disponibile: niente scorrimento */
function adattaDashboard() {
  var v = el("v-home");
  if (!v) return;
  var largo = window.matchMedia("(min-width: 900px) and (min-height: 560px)").matches;
  if (!largo || !v.classList.contains("attiva")) { v.style.height = ""; document.body.classList.remove("dash-fissa"); return; }
  document.body.classList.add("dash-fissa");
  var alto = v.getBoundingClientRect().top + (window.pageYOffset || 0);
  var schede = el("schede");
  var hs = schede && window.getComputedStyle(schede).display !== "none" ? schede.getBoundingClientRect().height : 0;
  v.style.height = Math.max(440, Math.floor(window.innerHeight - alto - hs - 14)) + "px";
  /* Nell'elenco delle prossime assenze mostro solo le voci che entrano per intero */
  var box = v.querySelector(".dash-prossimi .lista");
  if (box) {
    var limite = box.getBoundingClientRect().bottom;
    Array.prototype.forEach.call(box.children, function (c) { c.style.display = ""; });
    Array.prototype.forEach.call(box.children, function (c) { if (c.getBoundingClientRect().bottom > limite + 1) c.style.display = "none"; });
  }
}

window.addEventListener("resize", function () { if (S.dati && S.vista === "home") adattaDashboard(); });

/* ---------------------------------------------------------
   SALDO STIMATO DI FERIE E PERMESSI
   --------------------------------------------------------- */
function bloccoSaldoHome() {
  var sd = S.dati.saldo;
  if (!sd) return "";
  if (!sd.configurato) {
    return "<div class='sezione-titolo'><h2>Ferie e permessi residui</h2></div><button type='button' class='voce' onclick='apriImpostazioniSaldo()'><div class='voce-corpo'><div class='voce-titolo'>Saldo non ancora configurato</div><div class='voce-sub'>" + esc(sd.motivo || "Imposta spettanze e punto di partenza") + "</div></div></button>";
  }
  var h = "<div class='sezione-titolo'><h2>Ferie e permessi residui</h2><span class='voce-sub'>stima, la busta paga fa fede</span></div><div class='saldo-griglia'>";
  [["Ferie", sd.ferie], ["Permessi", sd.permessi]].forEach(function (x) {
    var v = x[1];
    h += "<button type='button' class='saldo-carta' onclick='apriImpostazioniSaldo()'><span class='saldo-nome'>" + x[0] + "</span><b class='" + (v.residuoOggi < 0 ? "negativo" : "") + "'>" + formatoOreSegno(v.residuoOggi) + "</b><span class='saldo-sub'>residuo a oggi</span><span class='saldo-fine" + (v.residuoFineAnno < 0 ? " negativo" : "") + "'>A fine anno: " + formatoOreSegno(v.residuoFineAnno) + (v.programmato ? ", dopo " + oreDecimali(v.programmato) + " già programmate" : "") + "</span></button>";
  });
  h += "</div>";
  return h;
}

/* Ore in formato decimale come in busta paga: 5,33 h */
function oreDecimali(ore) {
  var n = Math.round(Number(ore || 0) * 100) / 100;
  return (n < 0 ? "-" : "") + Math.abs(n).toFixed(2).replace(".", ",") + " h";
}

/* Periodo di prova: riquadro in Home fino alla scadenza */
function bloccoProvaHome() {
  var pe = S.dati.provaEffettiva || {};
  var fine = pe.effettiva || S.dati.fineProva;
  if (!fine || S.dati.oggi > fine) return "";
  var giorni = Math.round((dataDaIso(fine) - dataDaIso(S.dati.oggi)) / 86400000);
  var nota = pe.assenze ? "Calendario: " + dataBreve(pe.base) + ", più " + pe.assenze + (pe.assenze === 1 ? " giorno" : " giorni") + " di assenza (5 mesi di effettiva prestazione, da confermare con l'amministrazione)" : "5 mesi di effettiva prestazione: ferie, chiusure e malattia la spostano in avanti";
  return "<div class='sezione-titolo'><h2>Periodo di prova</h2></div><div class='voce voce-attesa' style='cursor:default'><div class='voce-corpo'><div class='voce-titolo'>Termina " + esc(dataEstesa(fine)) + " (mancano " + giorni + (giorni === 1 ? " giorno" : " giorni") + ")</div><div class='voce-sub'>" + esc(nota) + "</div></div></div>";
}

function formatoOreSegno(ore) {
  return oreDecimali(ore);
}

function apriImpostazioniSaldo() {
  S.capitolo = "saldo";
  vai("impostazioni");
  setTimeout(function () { var a = document.querySelector(".capitolo.aperto"); if (a && a.scrollIntoView) a.scrollIntoView({ block: "start" }); }, 50);
}

function aggiornaSaldo() {
  api("getSaldo", []).then(function (sd) {
    S.dati.saldo = sd;
    salvaCache();
    if (S.vista === "home" && el("foglio").classList.contains("nascosto")) renderHome();
  }).catch(function () { });
}

function corpoSaldo() {
  var imp = S.dati.impostazioni;
  var sd = S.dati.saldo || {};
  var h = "<p class='aiuto'>L'app matura ogni mese 1/12 delle ore annue e toglie quelle che registri, comprese le chiusure aziendali. È una stima per pianificare: il dato ufficiale resta quello della busta paga e nel rapportino non compare.</p>";
  h += "<div class='riga2'>" + campoTesto("s-FERIE_ANNUE_ORE", "Ore di ferie all'anno", imp.FERIE_ANNUE_ORE, "text") + campoTesto("s-PERMESSI_ANNUI_ORE", "Ore di permesso all'anno", imp.PERMESSI_ANNUI_ORE, "text") + "</div>";
  h += "<p class='aiuto'>Valori indicativi del vostro CCNL: 160 ore di ferie (4 settimane) e 96 ore di permessi (64 ROL più 32 ex festività). Verificali sulla busta paga.</p>";
  h += "<div class='sezione-titolo' style='margin-top:6px'><h3>Punto di partenza</h3></div>";
  h += "<p class='aiuto'>Lascia vuoto per partire da zero dall'inizio del rapporto. Per allinearti alla busta paga indica la data a cui si riferisce il residuo (di solito l'ultimo giorno del mese) e i residui di ferie e di permessi; per i permessi somma ROL ed ex festività.</p>";
  h += campoTesto("s-SALDO_DATA", "Residuo aggiornato al", imp.SALDO_DATA, "date");
  h += "<div class='riga2'>" + campoTesto("s-SALDO_FERIE_ORE", "Residuo ferie (ore)", imp.SALDO_FERIE_ORE, "text") + campoTesto("s-SALDO_PERMESSI_ORE", "Residuo permessi (ore)", imp.SALDO_PERMESSI_ORE, "text") + "</div>";
  h += "<button type='button' class='btn btn-primario' onclick='salvaSaldo()'>Salva e ricalcola</button>";
  if (sd.configurato) {
    h += "<div class='dettagli' style='margin-top:12px'>";
    h += "<div><span><b>Ore</b></span><span><b>Ferie / Permessi</b></span></div>";
    h += "<div><span>Partenza (" + (sd.daBustaPaga ? "busta paga del " + esc(dataBreve(sd.base)) : "inizio rapporto") + ")</span><span>" + formatoOreSegno(sd.ferie.saldoIniziale) + " / " + formatoOreSegno(sd.permessi.saldoIniziale) + "</span></div>";
    h += "<div><span>Maturate da allora</span><span>" + oreDecimali(sd.ferie.maturato) + " / " + oreDecimali(sd.permessi.maturato) + "</span></div>";
    h += "<div><span>Godute fino a oggi</span><span>" + oreDecimali(sd.ferie.goduto) + " / " + oreDecimali(sd.permessi.goduto) + "</span></div>";
    h += "<div><span><b>Residuo a oggi</b></span><span><b>" + formatoOreSegno(sd.ferie.residuoOggi) + " / " + formatoOreSegno(sd.permessi.residuoOggi) + "</b></span></div>";
    h += "<div><span>Già programmate fino al 31/12</span><span>" + oreDecimali(sd.ferie.programmato) + " / " + oreDecimali(sd.permessi.programmato) + "</span></div>";
    h += "<div><span>Da maturare fino al 31/12</span><span>" + oreDecimali(sd.ferie.daMaturare) + " / " + oreDecimali(sd.permessi.daMaturare) + "</span></div>";
    h += "<div><span><b>Residuo stimato al 31/12</b></span><span><b>" + formatoOreSegno(sd.ferie.residuoFineAnno) + " / " + formatoOreSegno(sd.permessi.residuoFineAnno) + "</b></span></div>";
    h += "</div>";
  } else if (sd.motivo) {
    h += "<div class='avvertenza' style='margin-top:12px'>" + esc(sd.motivo) + "</div>";
  }
  return h;
}

function salvaSaldo() {
  var d = {};
  ["FERIE_ANNUE_ORE", "PERMESSI_ANNUI_ORE", "SALDO_DATA", "SALDO_FERIE_ORE", "SALDO_PERMESSI_ORE"].forEach(function (k) { d[k] = valore("s-" + k); });
  chiama("salvaSaldo", [d], function (res) {
    S.dati.impostazioni = res.impostazioni;
    S.dati.saldo = res.saldo;
    salvaCache();
    renderImpostazioni();
    avviso("Saldo ricalcolato");
  });
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
  var pc = info.chiusura ? periodoChiusuraDi(iso) : null;
  var nota = info.festivo ? info.festivo : (info.weekend ? "Giorno non lavorativo" : (info.chiusura ? "Chiusura aziendale: " + info.chiusura + ". Vale come ferie collettive." : "Giorno lavorativo"));
  var h = "<h2>" + esc(maiusc(dataEstesa(iso))) + "</h2><div class='sottotitolo'>" + esc(nota) + "</div>";
  if (evs.length) h += "<div class='lista' style='margin-bottom:14px'>" + evs.map(voceEvento).join("") + "</div>";
  var lavorato = evs.some(function (e) { return e.tipo === "PRESENZA"; });
  if (info.utile) {
    h += "<button type='button' class='btn btn-primario' onclick='nuovaDa(\"FERIE\",\"" + iso + "\")'>Richiedi ferie</button>";
    h += "<button type='button' class='btn' onclick='nuovaDa(\"PERMESSO\",\"" + iso + "\")'>Richiedi un permesso</button>";
    h += "<button type='button' class='btn' onclick='nuovaDa(\"MALATTIA\",\"" + iso + "\")'>Comunica malattia</button>";
    h += "<button type='button' class='btn' onclick='nuovaDa(\"CHIUSURA\",\"" + iso + "\")'>Inserisci una chiusura aziendale</button>";
  } else if (info.chiusura && info.lavorativo) {
    if (!lavorato) h += "<button type='button' class='btn btn-primario' onclick='nuovaDa(\"PRESENZA\",\"" + iso + "\")'>Segna che ho lavorato</button>";
    h += "<button type='button' class='btn' onclick='nuovaDa(\"MALATTIA\",\"" + iso + "\")'>Comunica malattia</button>";
  } else if (!lavorato) {
    h += "<button type='button' class='btn btn-primario' onclick='nuovaDa(\"PRESENZA\",\"" + iso + "\")'>Segna che ho lavorato</button>";
  }
  h += sezionePastiGiorno(iso, info, evs);
  if (pc) h += "<button type='button' class='btn btn-pericolo' onclick='confermaEliminaChiusura(\"" + pc.id + "\")'>Elimina la chiusura dal " + dataBreve(pc.dal) + " al " + dataBreve(pc.al) + "</button>";
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
  var tipi = [["FERIE", "Ferie"], ["PERMESSO", "Permesso"], ["MALATTIA", "Malattia"], ["CHIUSURA", "Chiusura aziendale"], ["PRESENZA", "Lavoro festivo"]];
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

  if (S.tipo === "CHIUSURA") {
    h.push("<h3>Chiusura aziendale</h3>");
    h.push("<p class='aiuto'>Periodo di chiusura per ferie comune a tutti i dipendenti. Non parte nessuna mail: ogni giorno lavorativo del periodo vale come giorno di ferie (ferie collettive). Sabati, domeniche e festività restano tali.</p>");
    h.push("<div class='riga2'><div class='campo'><label for='f-dal'>Dal</label><input type='date' id='f-dal' value='" + dal + "' oninput='sincronizzaAl()'></div>");
    h.push("<div class='campo'><label for='f-al'>Al</label><input type='date' id='f-al' value='" + dal + "' oninput='aggiornaAnteprima()'></div></div>");
    h.push("<div class='campo'><label for='f-descr'>Descrizione</label><input type='text' id='f-descr' placeholder='Es. Chiusura estiva, Chiusura natalizia'></div>");
  }

  if (S.tipo === "PRESENZA") {
    h.push("<h3>Lavoro in un giorno non lavorativo</h3>");
    h.push("<p class='aiuto'>Sabato, domenica, festività o giorno di chiusura aziendale in cui hai lavorato. Viene conteggiato come presenza nel rapportino. Non parte nessuna mail.</p>");
    h.push("<div class='campo'><label for='f-dal'>Giorno</label><input type='date' id='f-dal' value='" + dal + "' oninput='aggiornaAnteprima()'></div>");
  }

  if (S.tipo !== "CHIUSURA") h.push("<div class='campo'><label for='f-note'>Note (facoltative)</label><textarea id='f-note' placeholder='" + (S.tipo === "PRESENZA" ? "Es. fiera, sopralluogo in cantiere" : "Compaiono nel testo della mail") + "'></textarea></div>");
  h.push("<div class='anteprima' id='anteprima'></div>");
  if (S.tipo !== "PRESENZA" && S.tipo !== "CHIUSURA") h.push("<div class='nota-dest'>" + esc(frasiDestinatari("RICHIESTE")) + "</div>");
  var etichettaBtn = S.tipo === "PRESENZA" ? "Registra la presenza" : (S.tipo === "CHIUSURA" ? "Registra la chiusura" : "Registra e prepara la mail");
  h.push("<button type='button' class='btn btn-primario' id='btnSalva' onclick='salvaNuova()'>" + etichettaBtn + "</button>");
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
  aggiornaAnteprima();
}

function aggiornaAnteprima() {
  var box = el("anteprima");
  if (!box) return;
  var testo = "", errore = false;
  var dal = valore("f-dal"), al = valore("f-al") || dal;
  var intera = S.tipo === "PERMESSO" && el("f-intera") && el("f-intera").checked;
  if (S.tipo === "FERIE" || S.tipo === "MALATTIA" || S.tipo === "CHIUSURA" || intera) {
    if (!dal) { testo = "Scegli la data di inizio."; errore = true; }
    else if (al < dal) { testo = "La data finale è precedente a quella iniziale."; errore = true; }
    else if (S.tipo === "CHIUSURA") {
      var nl = lavorativiTra(dal, al);
      testo = nl ? nl + (nl === 1 ? " giorno lavorativo" : " giorni lavorativi") + " di ferie collettive, " + formatoOre(nl * oreGiornata()) + " di ferie." : "Nel periodo non ci sono giorni lavorativi.";
      errore = !nl;
    } else if (S.tipo === "MALATTIA") {
      var nm = lavorativiTra(dal, al);
      testo = nm + (nm === 1 ? " giorno lavorativo." : " giorni lavorativi.");
    } else {
      var n = utiliTra(dal, al), nc = chiusuraTra(dal, al);
      if (!n) { testo = nc ? "I giorni scelti sono già coperti dalla chiusura aziendale (ferie collettive)." : "Nel periodo scelto non ci sono giorni lavorativi."; errore = true; }
      else {
        testo = n + (n === 1 ? " giorno lavorativo" : " giorni lavorativi");
        if (nc) testo += " (esclusi " + nc + " di chiusura aziendale)";
        if (S.tipo === "FERIE") testo += ". Rientro previsto " + dataEstesa(prossimoLavorativo(al)) + ".";
        else testo += ".";
      }
    }
  } else if (S.tipo === "PERMESSO") {
    var giorno = valore("f-giorno"), dalle = valore("f-dalle"), alle = valore("f-alle");
    var ig = giorno ? infoGiorno(giorno) : null;
    if (!giorno || !dalle || !alle) { testo = "Indica giorno e orario."; errore = true; }
    else if (!ig.lavorativo) { testo = "Il giorno scelto non è lavorativo."; errore = true; }
    else if (ig.chiusura) { testo = "Il giorno scelto è di chiusura aziendale: vale già come ferie."; errore = true; }
    else if (minuti(alle) <= minuti(dalle)) { testo = "L'ora di fine deve essere successiva all'ora di inizio."; errore = true; }
    else {
      var ore = orePermesso(dalle, alle);
      if (ore <= 0) { testo = "L'orario scelto è fuori dall'orario di lavoro."; errore = true; }
      else testo = formatoOre(ore) + " di permesso, pausa pranzo esclusa.";
    }
  } else if (S.tipo === "PRESENZA") {
    if (!dal) { testo = "Scegli il giorno."; errore = true; }
    else if (infoGiorno(dal).utile) { testo = "Il giorno scelto è già lavorativo: la presenza è conteggiata in automatico."; errore = true; }
    else testo = maiusc(dataEstesa(dal)) + " verrà conteggiato come giorno di presenza.";
  }
  if (!errore) testo += avvisoPreavviso();
  box.textContent = testo;
  box.classList.toggle("errore", errore);
}

function salvaNuova() {
  if (S.tipo === "CHIUSURA") {
    var c = { dal: valore("f-dal"), al: valore("f-al") || valore("f-dal"), descrizione: valore("f-descr") };
    chiama("aggiungiChiusura", [c], function (lista) {
      S.dati.chiusure = lista;
      S.precompila = null;
      salvaCache();
      aggiornaSaldo();
      avviso("Chiusura registrata come ferie collettive");
      renderNuova();
    });
    return;
  }
  var p = { tipo: S.tipo, note: valore("f-note") };
  if (S.tipo === "FERIE" || S.tipo === "MALATTIA") { p.dal = valore("f-dal"); p.al = valore("f-al"); }
  if (S.tipo === "MALATTIA") p.protocollo = valore("f-protocollo");
  if (S.tipo === "PRESENZA") { p.dal = valore("f-dal"); p.al = p.dal; }
  if (S.tipo === "PERMESSO") {
    p.sottotipo = "ROL";
    p.descrizione = "";
    p.intera = el("f-intera").checked;
    if (p.intera) { p.dal = valore("f-dal"); p.al = valore("f-al"); }
    else { p.dal = valore("f-giorno"); p.al = p.dal; p.dalle = valore("f-dalle"); p.alle = valore("f-alle"); }
  }
  chiama("salvaEvento", [p], function (res) {
    S.dati.eventi.push(res.evento);
    S.precompila = null;
    salvaCache();
    aggiornaSaldo();
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
  var variate = tutti.filter(function (e) { return STATI_CHIUSI.indexOf(e.stato) >= 0; });
  var lista;
  if (S.filtro === "prossime") lista = tutti.filter(function (e) { return e.al >= oggi && STATI_CHIUSI.indexOf(e.stato) < 0; }).reverse();
  else if (S.filtro === "variazioni") lista = variate;
  else lista = tutti;
  var filtri = [["prossime", "In programma"], ["variazioni", "Variazioni (" + variate.length + ")"], ["tutte", "Tutte"]];
  var h = ["<div class='filtri'>"];
  filtri.forEach(function (f) { h.push("<button type='button' class='filtro" + (S.filtro === f[0] ? " attivo" : "") + "' onclick='scegliFiltro(\"" + f[0] + "\")'>" + f[1] + "</button>"); });
  h.push("</div>");
  if (!lista.length) {
    var vuoti = { prossime: "Niente in programma.", variazioni: "Nessuna revoca, modifica o annullamento.", tutte: "Non hai ancora registrato nulla. Parti dalla sezione Nuova." };
    h.push("<div class='vuoto'>" + vuoti[S.filtro] + "</div>");
  } else {
    h.push("<div class='lista'>" + lista.map(voceEvento).join("") + "</div>");
  }
  el("v-richieste").innerHTML = h.join("");
}

function eventoDaId(id) {
  return (S.dati.eventi || []).filter(function (x) { return x.id === id; })[0] || null;
}

function apriEvento(id) {
  var e = eventoDaId(id);
  if (!e) return;
  var chiuso = STATI_CHIUSI.indexOf(e.stato) >= 0;
  var h = "<h2>" + esc(titoloEvento(e)) + "</h2><div class='sottotitolo'>" + esc(periodoEvento(e)) + "</div>";
  h += "<div class='dettagli'>";
  h += "<div><span>Stato</span><span>" + esc(NOMI_STATO[e.stato] || e.stato) + "</span></div>";
  if (e.tipo === "PERMESSO") h += "<div><span>Ore</span><span>" + esc(formatoOre(e.ore)) + "</span></div>";
  if (e.protocollo) h += "<div><span>Protocollo certificato</span><span>" + esc(e.protocollo) + "</span></div>";
  if (e.note) h += "<div><span>Note</span><span>" + esc(e.note) + "</span></div>";
  h += "<div><span>Registrata il</span><span>" + esc(dataBreve(e.creato) + " " + e.creato.substr(11, 5)) + "</span></div>";
  if (chiuso) {
    if (e.dataVariazione) h += "<div><span>Data variazione</span><span>" + esc(dataBreve(e.dataVariazione)) + "</span></div>";
    if (e.origine) h += "<div><span>Decisa da</span><span>" + (e.origine === "AZIENDA" ? "Azienda" : "Dipendente") + "</span></div>";
    if (e.motivo) h += "<div><span>Motivo</span><span>" + esc(e.motivo) + "</span></div>";
  }
  var prec = e.sostituisce ? eventoDaId(e.sostituisce) : null;
  if (prec) h += "<div><span>Sostituisce</span><span>" + esc(periodoEvento(prec)) + "</span></div>";
  h += "</div>";
  var b = function (testo, azione, classe) { return "<button type='button' class='btn " + (classe || "") + "' onclick='" + azione + "'>" + testo + "</button>"; };
  if (!chiuso) {
    if (e.tipo !== "PRESENZA") h += b("Modifica date o orari", "apriModifica(\"" + id + "\")", "btn-primario");
    if (e.tipo === "FERIE" || e.tipo === "PERMESSO") h += b("Revocata dall'azienda", "apriRevoca(\"" + id + "\")");
    h += b(e.tipo === "PRESENZA" ? "Elimina questa presenza" : "Annulla (decisione mia)", "apriAnnulla(\"" + id + "\")", "btn-pericolo");
    if (e.tipo !== "PRESENZA") h += b("Prepara di nuovo la mail", "riapriMail(\"" + id + "\")");
  } else {
    if (e.sostituitaDa && eventoDaId(e.sostituitaDa)) h += b("Apri la registrazione aggiornata", "apriEvento(\"" + e.sostituitaDa + "\")", "btn-primario");
    if (e.stato === "ANNULLATA" && e.tipo !== "PRESENZA") h += b("Prepara di nuovo la mail di annullamento", "riapriMail(\"" + id + "\")");
  }
  h += b("Chiudi", "chiudiFoglio()", "btn-testo");
  apriFoglio(h);
}

function apriModifica(id) {
  var e = eventoDaId(id);
  if (!e) return;
  var h = "<h2>Modifica " + esc(titoloEvento(e).toLowerCase()) + "</h2><div class='sottotitolo'>Attuale: " + esc(periodoEvento(e)) + ". La registrazione attuale resta come traccia.</div>";
  if (e.tipo === "PERMESSO" && !e.intera) {
    h += campoTesto("m-giorno", "Giorno", e.dal, "date");
    h += "<div class='riga2'>" + campoTesto("m-dalle", "Dalle", e.dalle, "time") + campoTesto("m-alle", "Alle", e.alle, "time") + "</div>";
  } else {
    h += "<div class='riga2'>" + campoTesto("m-dal", "Dal", e.dal, "date") + campoTesto("m-al", "Al", e.al, "date") + "</div>";
  }
  if (e.tipo === "MALATTIA") h += campoTesto("m-protocollo", "Numero di protocollo del certificato", e.protocollo, "text");
  h += "<div class='campo'><label for='m-origine'>Chi ha deciso la modifica</label><select id='m-origine'><option value='DIPENDENTE'>Io, preparo la mail di modifica</option><option value='AZIENDA'>L'azienda (revoca parziale o spostamento), nessuna mail</option></select></div>";
  h += "<div class='campo'><label for='m-motivo'>Motivo (obbligatorio se decide l'azienda)</label><input type='text' id='m-motivo' placeholder='Es. urgenza in cantiere'></div>";
  h += "<button type='button' class='btn btn-primario' onclick='salvaModifica(\"" + id + "\")'>Salva la modifica</button>";
  h += "<button type='button' class='btn btn-testo' onclick='apriEvento(\"" + id + "\")'>Torna indietro</button>";
  apriFoglio(h);
}

function salvaModifica(id) {
  var e = eventoDaId(id);
  var nuovi = {};
  if (e.tipo === "PERMESSO" && !e.intera) { nuovi.dal = valore("m-giorno"); nuovi.al = nuovi.dal; nuovi.dalle = valore("m-dalle"); nuovi.alle = valore("m-alle"); }
  else { nuovi.dal = valore("m-dal"); nuovi.al = valore("m-al") || nuovi.dal; }
  if (e.tipo === "MALATTIA") nuovi.protocollo = valore("m-protocollo");
  var info = { origine: valore("m-origine"), motivo: valore("m-motivo") };
  if (info.origine === "AZIENDA" && !info.motivo) { avviso("Indica il motivo della modifica decisa dall'azienda.", true); return; }
  chiama("modificaEvento", [id, nuovi, info], function (res) {
    S.dati.eventi = res.eventi;
    salvaCache();
    aggiornaSaldo();
    vai(S.vista, true);
    if (res.mail) mostraMail(res.mail, "Modifica registrata", "Calendario aggiornato. Ora apri la mail di modifica in Outlook e inviala.");
    else { chiudiFoglio(); avviso("Modifica registrata e tracciata"); }
  });
}

function apriRevoca(id) {
  var e = eventoDaId(id);
  if (!e) return;
  var h = "<h2>Revoca da parte dell'azienda</h2><div class='sottotitolo'>" + esc(titoloEvento(e) + ", " + periodoEvento(e)) + ". I giorni tornano di presenza; la revoca compare nel rapportino. Nessuna mail.</div>";
  h += campoTesto("r-data", "Data della revoca", S.dati.oggi, "date");
  h += "<div class='campo'><label for='r-motivo'>Motivo</label><input type='text' id='r-motivo' placeholder='Es. consegna urgente in cantiere'></div>";
  h += "<button type='button' class='btn btn-pericolo' onclick='salvaRevoca(\"" + id + "\")'>Registra la revoca</button>";
  h += "<button type='button' class='btn btn-testo' onclick='apriEvento(\"" + id + "\")'>Torna indietro</button>";
  apriFoglio(h);
}

function salvaRevoca(id) {
  var info = { data: valore("r-data"), motivo: valore("r-motivo") };
  if (!info.motivo) { avviso("Indica il motivo della revoca.", true); return; }
  chiama("revocaEvento", [id, info], function (res) {
    S.dati.eventi = res.eventi;
    salvaCache();
    aggiornaSaldo();
    vai(S.vista, true);
    chiudiFoglio();
    avviso("Revoca registrata e tracciata");
  });
}

function apriAnnulla(id) {
  var e = eventoDaId(id);
  if (!e) return;
  var presenza = e.tipo === "PRESENZA";
  var h = "<h2>" + (presenza ? "Eliminare la presenza?" : "Annullare?") + "</h2><div class='sottotitolo'>" + esc(titoloEvento(e) + ", " + periodoEvento(e)) + ". " + (presenza ? "Esce dal calendario e dal rapportino; resta come traccia." : "Esce dal calendario; resta come traccia e compare tra le variazioni del rapportino. Dopo prepari la mail di annullamento.") + "</div>";
  h += "<div class='campo'><label for='a-motivo'>Motivo (facoltativo)</label><input type='text' id='a-motivo'></div>";
  h += "<button type='button' class='btn btn-pericolo' onclick='salvaAnnulla(\"" + id + "\")'>Conferma</button>";
  h += "<button type='button' class='btn btn-testo' onclick='apriEvento(\"" + id + "\")'>Torna indietro</button>";
  apriFoglio(h);
}

function salvaAnnulla(id) {
  chiama("annullaEvento", [id, { motivo: valore("a-motivo") }], function (res) {
    S.dati.eventi = res.eventi;
    salvaCache();
    aggiornaSaldo();
    vai(S.vista, true);
    if (res.mail) mostraMail(res.mail, "Annullata", "Ora apri la mail di annullamento in Outlook e inviala.");
    else { chiudiFoglio(); avviso("Presenza eliminata"); }
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
    h.push("<div><span>Ore lavorate</span><span>" + formatoOre(t.oreLavorate || 0) + " / " + formatoOre(ta.oreLavorate || 0) + "</span></div>");
    h.push("<div><span>Ferie</span><span>" + fer(t) + " / " + fer(ta) + "</span></div>");
    h.push("<div><span>Permessi</span><span>" + formatoOre(t.permessiOre) + " / " + formatoOre(ta.permessiOre) + "</span></div>");
    h.push("<div><span>Malattia</span><span>" + gg(t.malattia) + " / " + gg(ta.malattia) + "</span></div>");
    h.push("<div><span>Variazioni del mese</span><span>" + ((r.variazioni && r.variazioni.length) ? r.variazioni.length : "nessuna") + "</span></div>");
    h.push("</div>");
    h.push("<ol class='passi'><li>Apri la mail in Outlook: destinatari, oggetto e testo sono già pronti.</li><li>Torna qui e tocca Condividi il PDF, poi scegli Salva su File.</li><li>In Outlook tocca la graffetta, allega il PDF da File e invia.</li></ol>");
    h.push("<a class='btn btn-primario' href='" + esc(r.mail.mailto) + "'>Apri la mail in Outlook</a>");
    h.push("<button type='button' class='btn' onclick='condividiPdf()'>Condividi il PDF</button>");
    h.push("<a class='btn btn-testo' href='" + esc(r.url) + "' target='_blank' rel='noopener'>Visualizza su Drive</a>");
    h.push("</div>");
  }

  h.push(bloccoNotaSpese());
  h.push(bloccoReportPeriodo());

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


/* ---------------------------------------------------------
   REPORT PER PERIODO
   --------------------------------------------------------- */
function bloccoReportPeriodo() {
  var oggi = S.dati.oggi;
  if (!S.periodoDal) { S.periodoDal = oggi.substr(0, 4) + "-01-01"; S.periodoAl = oggi; }
  var h = "<div class='blocco'><h3>Report per periodo</h3>";
  h += "<p class='aiuto'>Scegli le date e ottieni i totali di ore di ferie e di permesso, con il dettaglio giorno per giorno.</p>";
  h += "<div class='filtri'><button type='button' class='filtro' onclick='periodoRapido(\"mese\")'>Questo mese</button><button type='button' class='filtro' onclick='periodoRapido(\"scorso\")'>Mese scorso</button><button type='button' class='filtro' onclick='periodoRapido(\"anno\")'>Da inizio anno</button></div>";
  h += "<div class='riga2'>" + campoTesto("p-dal", "Dal", S.periodoDal, "date") + campoTesto("p-al", "Al", S.periodoAl, "date") + "</div>";
  h += "<button type='button' class='btn btn-primario' onclick='calcolaReportPeriodo()'>Calcola</button>";
  var r = S.reportPeriodo;
  if (r) {
    var t = r.totali;
    var gg = function (n) { return n + (n === 1 ? " giorno" : " giorni"); };
    h += "<div class='sottotitolo' style='margin-top:14px'>Dal " + esc(dataBreve(r.dal)) + " al " + esc(dataBreve(r.al)) + "</div>";
    h += "<div class='numeri'>";
    h += "<div class='numero'><b>" + formatoOre(t.ferieOre) + "</b><span>di ferie, " + gg(t.ferieGiorni) + (t.ferieCollettive ? " (" + t.ferieCollettive + " di chiusura)" : "") + "</span></div>";
    h += "<div class='numero'><b>" + formatoOre(t.permessiOre) + "</b><span>di permesso</span></div>";
    h += "<div class='numero'><b>" + t.malattia + "</b><span>giorni di malattia</span></div>";
    h += "<div class='numero'><b>" + t.presenze + "</b><span>giorni di presenza</span></div>";
    h += "</div>";
    if (r.dettaglio.length) {
      h += "<div class='sezione-titolo'><h3>Dettaglio</h3></div><div class='dettagli'>";
      r.dettaglio.forEach(function (d) {
        h += "<div><span>" + esc(maiusc(d.giorno.substr(0, 3)) + " " + dataBreve(d.data)) + "</span><span>" + esc(d.testo) + (d.ore ? ", " + esc(formatoOre(d.ore)) : "") + "</span></div>";
      });
      h += "</div>";
    } else {
      h += "<div class='vuoto'>Nessuna ferie, permesso o malattia nel periodo.</div>";
    }
    if (r.variazioni.length) {
      h += "<div class='sezione-titolo'><h3>Variazioni nel periodo</h3></div><div class='dettagli'>";
      r.variazioni.forEach(function (v) { h += "<div><span>" + esc(v.data ? dataBreve(v.data) : "") + "</span><span>" + esc(v.testo) + "</span></div>"; });
      h += "</div>";
    }
  }
  h += "</div>";
  return h;
}

function periodoRapido(tipo) {
  var o = dataDaIso(S.dati.oggi);
  if (tipo === "mese") { S.periodoDal = isoDa(o.getFullYear(), o.getMonth() + 1, 1); S.periodoAl = isoDa(o.getFullYear(), o.getMonth() + 1, new Date(o.getFullYear(), o.getMonth() + 1, 0).getDate()); }
  if (tipo === "scorso") { var p = new Date(o.getFullYear(), o.getMonth() - 1, 1); S.periodoDal = isoDa(p.getFullYear(), p.getMonth() + 1, 1); S.periodoAl = isoDa(p.getFullYear(), p.getMonth() + 1, new Date(p.getFullYear(), p.getMonth() + 1, 0).getDate()); }
  if (tipo === "anno") { S.periodoDal = o.getFullYear() + "-01-01"; S.periodoAl = S.dati.oggi; }
  el("p-dal").value = S.periodoDal;
  el("p-al").value = S.periodoAl;
  calcolaReportPeriodo();
}

function calcolaReportPeriodo() {
  S.periodoDal = valore("p-dal");
  S.periodoAl = valore("p-al") || S.periodoDal;
  if (!S.periodoDal) { avviso("Scegli la data di inizio.", true); return; }
  chiama("reportPeriodo", [S.periodoDal, S.periodoAl], function (res) {
    S.reportPeriodo = res;
    renderRapportino();
    avviso("Report calcolato");
  });
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
  var caps = [];

  /* Destinatari */
  var d = [];
  d.push("<p class='aiuto'>Gli indirizzi tolti restano in archivio come obsoleti, con la data, e si possono riattivare.</p>");
  var nAttivi = 0;
  [["RAPPORTINO", "Rapportino mensile"], ["RICHIESTE", "Richieste e comunicazioni"]].forEach(function (u) {
    var lista = (S.dati.destinatari || []).filter(function (x) { return x.uso === u[0]; });
    var attivi = lista.filter(function (x) { return x.stato === "ATTIVO"; }).sort(function (x, y) { return x.campo === y.campo ? 0 : (x.campo === "A" ? -1 : 1); });
    var obs = lista.filter(function (x) { return x.stato !== "ATTIVO"; });
    nAttivi += attivi.length;
    d.push("<div style='margin-top:12px'><b>" + u[1] + "</b></div>");
    if (!attivi.length) d.push("<div class='vuoto'>Nessun indirizzo attivo.</div>");
    attivi.forEach(function (x) { d.push(rigaDestinatario(x)); });
    if (obs.length) {
      d.push("<details><summary>Indirizzi obsoleti (" + obs.length + ")</summary>");
      obs.forEach(function (x) { d.push(rigaDestinatario(x)); });
      d.push("</details>");
    }
  });
  d.push("<button type='button' class='btn' style='margin-top:12px' onclick='apriNuovoDestinatario()'>Aggiungi un indirizzo</button>");
  caps.push(["destinatari", "Destinatari", nAttivi + (nAttivi === 1 ? " indirizzo attivo" : " indirizzi attivi"), d.join("")]);

  /* Testi */
  caps.push(["testi", "Testi delle richieste", "Mail di ferie e permessi", bloccoTesti()]);

  /* Chiusure */
  var c = [];
  c.push("<p class='aiuto'>Le inserisci dalla sezione Nuova, scegliendo Chiusura aziendale. Ogni giorno lavorativo del periodo vale come ferie collettive. Le festività nazionali, Pasquetta e San Francesco sono già incluse.</p>");
  var annoFa = piuGiorni(S.dati.oggi, -365);
  var periodi = periodiChiusura().filter(function (p) { return p.al >= annoFa; });
  if (!periodi.length) c.push("<div class='vuoto'>Nessuna chiusura registrata.</div>");
  periodi.forEach(function (p) {
    var nl = lavorativiTra(p.dal, p.al);
    c.push("<div class='dest'><div class='dest-corpo'><div class='dest-nome'>" + esc(p.descrizione) + "</div><div class='dest-mail'>Dal " + esc(dataBreve(p.dal)) + " al " + esc(dataBreve(p.al)) + ", " + nl + (nl === 1 ? " giorno" : " giorni") + " di ferie collettive</div></div><button type='button' class='btn btn-piccolo btn-pericolo' onclick='confermaEliminaChiusura(\"" + p.id + "\")'>Elimina</button></div>");
  });
  c.push("<button type='button' class='btn' style='margin-top:10px' onclick='nuovaDa(\"CHIUSURA\",\"" + S.dati.oggi + "\")'>Inserisci una chiusura</button>");
  caps.push(["chiusure", "Chiusure aziendali", periodi.length ? periodi.length + (periodi.length === 1 ? " periodo registrato" : " periodi registrati") : "Nessuna chiusura registrata", c.join("")]);

  /* Saldo ferie e permessi */
  var sdc = S.dati.saldo || {};
  caps.push(["saldo", "Ferie e permessi maturati", sdc.configurato ? "Ferie " + formatoOreSegno(sdc.ferie.residuoOggi) + ", permessi " + formatoOreSegno(sdc.permessi.residuoOggi) + " a oggi" : "Da configurare", corpoSaldo(), !sdc.configurato]);

  caps.push(capitoloMensa());
  caps.push(capitoloFatture());

  /* Dati e orario */
  var o = [];
  o.push(campoTesto("i-NOME_DIPENDENTE", "Nome nelle mail", imp.NOME_DIPENDENTE, "text"));
  o.push(campoTesto("i-NOME_REPORT", "Nome nel rapportino", imp.NOME_REPORT, "text"));
  o.push(campoTesto("i-AZIENDA", "Azienda", imp.AZIENDA, "text"));
  o.push(campoTesto("i-DATA_INIZIO_RAPPORTO", "Data di inizio del rapporto (i giorni prima non vengono conteggiati)", imp.DATA_INIZIO_RAPPORTO, "date"));
  o.push(campoTesto("i-MESI_PROVA", "Durata del periodo di prova (mesi)", imp.MESI_PROVA || "5", "number"));
  if (S.dati.fineProva) o.push("<p class='aiuto'>Fine del periodo di prova: " + esc(dataEstesa(S.dati.fineProva)) + ". <button type='button' class='btn btn-piccolo' onclick='creaPromemoriaProva()'>" + (S.dati.haProva ? "Ricrea" : "Crea") + " il promemoria nel calendario</button></p>");
  o.push("<div class='riga2'>" + campoTesto("i-MATTINA_INIZIO", "Mattina dalle", imp.MATTINA_INIZIO, "time") + campoTesto("i-MATTINA_FINE", "Mattina alle", imp.MATTINA_FINE, "time") + "</div>");
  o.push("<div class='riga2'>" + campoTesto("i-POMERIGGIO_INIZIO", "Pomeriggio dalle", imp.POMERIGGIO_INIZIO, "time") + campoTesto("i-POMERIGGIO_FINE", "Pomeriggio alle", imp.POMERIGGIO_FINE, "time") + "</div>");
  o.push("<div class='campo'><label for='i-FIRMA_MAIL'>Firma delle mail</label><textarea id='i-FIRMA_MAIL'>" + esc(imp.FIRMA_MAIL) + "</textarea></div>");
  o.push("<button type='button' class='btn btn-primario' onclick='salvaImpostazioni()'>Salva i dati</button>");
  caps.push(["dati", "Dati e orario di lavoro", imp.MATTINA_INIZIO + "-" + imp.MATTINA_FINE + " / " + imp.POMERIGGIO_INIZIO + "-" + imp.POMERIGGIO_FINE + (imp.DATA_INIZIO_RAPPORTO ? "" : ", manca la data di inizio"), o.join(""), !imp.DATA_INIZIO_RAPPORTO]);

  /* PIN */
  var p = [];
  p.push("<p class='aiuto'>" + (S.dati.haPin ? "Il PIN è impostato. Cambiandolo, gli altri dispositivi vengono scollegati e dovranno inserire il nuovo PIN: utile se perdi il telefono." : "Imposta un PIN di 6 cifre: ti servirà per collegare un nuovo telefono, l'iPad o un altro computer, senza link.") + "</p>");
  p.push("<div class='riga2'><div class='campo'><label for='n-pin'>" + (S.dati.haPin ? "Nuovo PIN" : "PIN") + "</label><input type='password' id='n-pin' class='campo-pin' inputmode='numeric' pattern='[0-9]*' maxlength='6' autocomplete='new-password'></div>");
  p.push("<div class='campo'><label for='n-pin2'>Ripeti il PIN</label><input type='password' id='n-pin2' class='campo-pin' inputmode='numeric' pattern='[0-9]*' maxlength='6' autocomplete='new-password'></div></div>");
  p.push("<button type='button' class='btn btn-primario' onclick='salvaPin()'>" + (S.dati.haPin ? "Cambia il PIN" : "Imposta il PIN") + "</button>");
  caps.push(["pin", "PIN di accesso", S.dati.haPin ? "Impostato" : "Da impostare", p.join(""), !S.dati.haPin]);

  /* Logo */
  var l = [];
  l.push("<img class='logo-anteprima nascosto' id='logoAnteprima' alt='Logo attuale'>");
  l.push("<p class='aiuto' id='logoStato'>" + (S.dati.haLogo ? "Logo caricato." : "Nessun logo: nell'intestazione compare il nome dell'azienda.") + "</p>");
  l.push("<div class='campo'><label for='logoFile'>Carica un PNG o JPG (massimo 2 MB, meglio con sfondo bianco o trasparente)</label><input type='file' id='logoFile' accept='image/png,image/jpeg' onchange='caricaLogo()'></div>");
  caps.push(["logo", "Logo del rapportino", S.dati.haLogo ? "Caricato" : "Non caricato", l.join("")]);

  /* Promemoria */
  var m = [];
  m.push("<p class='aiuto'>Crea nel calendario Lavoro Pre System un evento alle 8:00 del giorno 1 di ogni mese, con notifica su tutti i dispositivi e il collegamento al rapportino.</p>");
  m.push("<button type='button' class='btn' onclick='creaPromemoria()'>" + (S.dati.haPromemoria ? "Ricrea il promemoria" : "Crea il promemoria") + "</button>");
  caps.push(["promemoria", "Promemoria mensile", S.dati.haPromemoria ? "Attivo" : "Da creare", m.join("")]);

  /* Questo dispositivo */
  var cache = leggiCache();
  var q = [];
  q.push("<div class='dettagli'>");
  q.push("<div><span>Ultimo aggiornamento</span><span>" + (cache && cache.salvato ? esc(dataBreve(isoDaData(new Date(cache.salvato))) + " " + pad2(new Date(cache.salvato).getHours()) + ":" + pad2(new Date(cache.salvato).getMinutes())) : "mai") + "</span></div>");
  q.push("<div><span>Motore dati</span><span>" + esc("..." + MOTORE_URL.slice(-24)) + "</span></div>");
  q.push("<div><span>Versione app</span><span>" + VERSIONE + "</span></div>");
  q.push("</div>");
  q.push("<p class='aiuto'>Per collegare un altro dispositivo basta il PIN. In alternativa puoi usare il link di collegamento: mandalo a te stesso solo in una nota protetta o con AirDrop, non per mail.</p>");
  q.push("<button type='button' class='btn' onclick='copiaLinkCollegamento()'>Copia il link di collegamento</button>");
  q.push("<button type='button' class='btn btn-pericolo' onclick='scollega()'>Scollega questo dispositivo</button>");
  caps.push(["dispositivo", "Questo dispositivo", "Versione " + VERSIONE, q.join("")]);

  var h = ["<h1 class='titolo-vista'>Impostazioni</h1><div class='capitoli'>"];
  caps.forEach(function (cp) {
    var aperto = S.capitolo === cp[0];
    h.push("<section class='capitolo" + (aperto ? " aperto" : "") + "'>");
    h.push("<button type='button' class='capitolo-titolo' aria-expanded='" + (aperto ? "true" : "false") + "' onclick='apriCapitolo(\"" + cp[0] + "\")'><span class='capitolo-testo'><span class='capitolo-nome'>" + esc(cp[1]) + "</span><span class='capitolo-stato" + (cp[4] ? " da-fare" : "") + "'>" + esc(cp[2]) + "</span></span><span class='capitolo-freccia' aria-hidden='true'>&#8250;</span></button>");
    if (aperto) h.push("<div class='capitolo-corpo'>" + cp[3] + "</div>");
    h.push("</section>");
  });
  h.push("</div>");
  el("v-impostazioni").innerHTML = h.join("");
  if (S.capitolo === "mensa") mostraQrImpostazioni();
  if (S.capitolo === "logo" && S.dati.haLogo) {
    chiama("getLogoAnteprima", [], function (uri) { mostraLogo(uri); });
  }
}

/* Apre un solo capitolo alla volta; toccando quello aperto si richiude */
function apriCapitolo(id) {
  S.capitolo = S.capitolo === id ? "" : id;
  renderImpostazioni();
  if (S.capitolo) {
    var aperto = document.querySelector(".capitolo.aperto");
    if (aperto && aperto.scrollIntoView) aperto.scrollIntoView({ block: "start", behavior: "smooth" });
  }
}

/* ---------------------------------------------------------
   TESTI DELLE RICHIESTE
   --------------------------------------------------------- */
var DESCR_SEGNAPOSTO = {
  saluto: "Buongiorno e nome dei destinatari in A",
  nome: "il tuo nome",
  firma: "la firma delle mail",
  periodo: "periodo esteso, per esempio da lunedì 12/10/2026 a venerdì 16/10/2026",
  periodo_breve: "periodo breve, per esempio dal 12/10/2026 al 16/10/2026",
  dal: "primo giorno",
  al: "ultimo giorno",
  giorni: "giorni lavorativi, per esempio 5 giorni lavorativi",
  rientro: "giorno di rientro",
  note: "riga Note, se l'hai compilata",
  data: "giorno del permesso",
  dalle: "ora di inizio",
  alle: "ora di fine",
  durata: "ore o giorni del permesso"
};

function bloccoTesti() {
  var imp = S.dati.impostazioni;
  var h = "<p class='aiuto'>Scrivi le mail come preferisci. Le parole tra parentesi graffe vengono sostituite con i dati della richiesta: tocca un segnaposto per inserirlo nel punto in cui stai scrivendo. Se svuoti un campo torna il testo predefinito.</p>";
  [["FERIE", "Ferie"], ["PERMESSO", "Permessi"]].forEach(function (t) {
    h += "<div style='margin-top:14px'><b>" + t[1] + "</b></div>";
    h += campoTesto("t-OGGETTO_" + t[0], "Oggetto", imp["OGGETTO_" + t[0]], "text");
    h += "<div class='campo'><label for='t-TESTO_" + t[0] + "'>Testo</label><textarea class='testo-mail' id='t-TESTO_" + t[0] + "' onfocus='S.ultimoTesto=this.id' onclick='S.ultimoTesto=this.id' onkeyup='S.ultimoTesto=this.id'>" + esc(imp["TESTO_" + t[0]]) + "</textarea></div>";
    h += "<div class='segnaposto'>";
    (S.dati.segnaposto[t[0]] || []).forEach(function (sp) {
      h += "<button type='button' class='sp' title='" + esc(DESCR_SEGNAPOSTO[sp] || "") + "' onclick='inserisciSegnaposto(\"t-TESTO_" + t[0] + "\",\"" + sp + "\")'>{" + sp + "}</button>";
    });
    h += "</div>";
    h += "<div class='azioni-riga' style='margin-bottom:6px'><button type='button' class='btn btn-piccolo' onclick='anteprimaTesto(\"" + t[0] + "\")'>Anteprima</button><button type='button' class='btn btn-piccolo btn-testo' onclick='ripristinaTesto(\"" + t[0] + "\")'>Ripristina il testo predefinito</button></div>";
  });
  h += "<button type='button' class='btn btn-primario' style='margin-top:10px' onclick='salvaTesti()'>Salva i testi</button>";
  return h;
}

function inserisciSegnaposto(id, sp) {
  var t = el(id);
  if (!t) return;
  var testo = "{" + sp + "}";
  var ini = typeof t.selectionStart === "number" ? t.selectionStart : t.value.length;
  var fin = typeof t.selectionEnd === "number" ? t.selectionEnd : t.value.length;
  t.value = t.value.slice(0, ini) + testo + t.value.slice(fin);
  t.focus();
  try { t.setSelectionRange(ini + testo.length, ini + testo.length); } catch (e) { }
}

function ripristinaTesto(tipo) {
  el("t-OGGETTO_" + tipo).value = S.dati.testiPredefiniti["OGGETTO_" + tipo];
  el("t-TESTO_" + tipo).value = S.dati.testiPredefiniti["TESTO_" + tipo];
  avviso("Testo predefinito ripristinato: premi Salva i testi per confermare");
}

function compilaModello(modello, valori) {
  var t = String(modello).replace(/\{([a-z_]+)\}/g, function (m, k) { return valori[k] !== undefined ? String(valori[k]) : m; });
  t = t.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
  return t.replace(/^\s+|\s+$/g, "");
}

function anteprimaTesto(tipo) {
  var dA = destinatariAttivi("RICHIESTE");
  var nomiA = dA.a.map(function (n) { return String(n).split(" ")[0]; });
  var valori = {
    saluto: "Buongiorno" + (nomiA.length ? " " + nomiA.join(" e ") : "") + ",",
    nome: S.dati.impostazioni.NOME_DIPENDENTE,
    firma: S.dati.impostazioni.FIRMA_MAIL || S.dati.impostazioni.NOME_DIPENDENTE,
    note: "Note: esempio di nota"
  };
  if (tipo === "FERIE") {
    valori.periodo = "da lunedì 12/10/2026 a venerdì 16/10/2026";
    valori.periodo_breve = "dal 12/10/2026 al 16/10/2026";
    valori.dal = "lunedì 12/10/2026";
    valori.al = "venerdì 16/10/2026";
    valori.giorni = "5 giorni lavorativi";
    valori.rientro = "lunedì 19/10/2026";
  } else {
    valori.periodo = "il giorno giovedì 22/10/2026 dalle 14:00 alle 18:00";
    valori.periodo_breve = "22/10/2026";
    valori.data = "giovedì 22/10/2026";
    valori.dalle = "14:00";
    valori.alle = "18:00";
    valori.durata = "4 h";
  }
  var ogg = compilaModello(valore("t-OGGETTO_" + tipo) || S.dati.testiPredefiniti["OGGETTO_" + tipo], valori).replace(/\s*\n\s*/g, " ");
  var corpo = compilaModello(valore("t-TESTO_" + tipo) || S.dati.testiPredefiniti["TESTO_" + tipo], valori);
  var h = "<h2>Anteprima " + (tipo === "FERIE" ? "richiesta ferie" : "richiesta permesso") + "</h2><div class='sottotitolo'>Con dati di esempio. Le modifiche non ancora salvate sono incluse.</div>";
  h += "<div class='mail-campi'><div><b>Oggetto</b> " + esc(ogg) + "</div></div>";
  h += "<pre class='mail-corpo'>" + esc(corpo) + "</pre>";
  h += "<button type='button' class='btn btn-testo' onclick='chiudiFoglio()'>Chiudi</button>";
  apriFoglio(h);
}

function salvaTesti() {
  var d = {};
  ["OGGETTO_FERIE", "TESTO_FERIE", "OGGETTO_PERMESSO", "TESTO_PERMESSO"].forEach(function (k) {
    var x = el("t-" + k);
    d[k] = x ? x.value : "";
  });
  chiama("salvaTesti", [d], function (imp) {
    S.dati.impostazioni = imp;
    salvaCache();
    avviso("Testi salvati: le prossime mail useranno questi testi");
  });
}

function salvaPin() {
  var a = valore("n-pin"), b = valore("n-pin2");
  if (!/^[0-9]{6}$/.test(a)) { avviso("Il PIN deve essere di 6 cifre.", true); return; }
  if (a !== b) { avviso("I due PIN non coincidono.", true); return; }
  var cambio = S.dati.haPin;
  chiama("salvaPin", [a], function (res) {
    localStorage.setItem(CHIAVE_TOKEN, res.token);
    S.dati.haPin = true;
    salvaCache();
    renderImpostazioni();
    avviso(cambio ? "PIN cambiato: gli altri dispositivi dovranno inserire il nuovo PIN" : "PIN impostato");
  });
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
  var chiavi = ["NOME_DIPENDENTE", "NOME_REPORT", "AZIENDA", "DATA_INIZIO_RAPPORTO", "MESI_PROVA", "MATTINA_INIZIO", "MATTINA_FINE", "POMERIGGIO_INIZIO", "POMERIGGIO_FINE", "FIRMA_MAIL"];
  var d = {};
  chiavi.forEach(function (k) { d[k] = valore("i-" + k); });
  chiama("salvaImpostazioni", [d], function (imp) {
    S.dati.impostazioni = imp;
    salvaCache();
    sincronizza(false, true);
    avviso("Dati salvati");
  });
}

function confermaEliminaChiusura(id) {
  var p = periodiChiusura().filter(function (x) { return x.id === id; })[0];
  if (!p) return;
  var h = "<h2>Eliminare la chiusura?</h2><div class='sottotitolo'>" + esc(p.descrizione) + " dal " + esc(dataBreve(p.dal)) + " al " + esc(dataBreve(p.al)) + ". I giorni tornano lavorativi con presenza automatica ed esce dal calendario.</div>";
  h += "<button type='button' class='btn btn-pericolo' onclick='eliminaChiusura(\"" + id + "\")'>Elimina</button>";
  h += "<button type='button' class='btn btn-testo' onclick='chiudiFoglio()'>Annulla</button>";
  apriFoglio(h);
}

function eliminaChiusura(id) {
  chiama("eliminaChiusura", [id], function (lista) {
    S.dati.chiusure = lista;
    salvaCache();
    aggiornaSaldo();
    chiudiFoglio();
    vai(S.vista, true);
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

function creaPromemoriaProva() {
  chiama("creaPromemoriaProva", [], function (fine) {
    S.dati.haProva = true;
    S.dati.fineProva = fine;
    salvaCache();
    renderImpostazioni();
    avviso("Promemoria creato per il " + dataBreve(fine));
  });
}

function creaPromemoria() {
  chiama("creaPromemoriaMensile", [], function (primo) {
    S.dati.haPromemoria = true;
    salvaCache();
    renderImpostazioni();
    avviso("Promemoria creato, il primo è il " + dataBreve(primo));
  });
}

/* Avvio quando tutti i file dell'app (app.js, pasti.js, fascicolo.js) sono caricati */
document.addEventListener("DOMContentLoaded", avvio);
