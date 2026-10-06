/* =========================================================
   LAVORO PRE SYSTEM - Marco Tabaro
   File: pasti.js - mensa con QR, pasti fuori con scontrino o fattura,
   dati per le fatture, nota spese mensile, preavviso di 48 ore.
   Il QR della mensa resta salvato sul dispositivo per aprirsi anche senza rete.
   ========================================================= */

var CHIAVE_QR = "pps.qr";
var NOMI_TIPO_PASTO = { MENSA: "Mensa", FUORI: "Pasto fuori", OFFERTO: "Pasto offerto", NESSUNO: "Nessun pasto" };

function pastiAttivi() {
  return (S.dati.pasti || []).filter(function (p) { return p.stato === "ATTIVO"; });
}

function pastiDelGiorno(iso) {
  return pastiAttivi().filter(function (p) { return p.data === iso; });
}

/* Presenza del giorno, con le stesse regole del rapportino */
function presenteIl(iso, info, evs) {
  var inizio = S.dati.impostazioni.DATA_INIZIO_RAPPORTO;
  if (inizio && iso < inizio) return false;
  if (iso > S.dati.oggi) return false;
  var lavorato = evs.some(function (e) { return e.tipo === "PRESENZA"; });
  if (!info.lavorativo || info.chiusura) return lavorato;
  return !evs.some(function (e) { return e.tipo === "FERIE" || e.tipo === "MALATTIA" || (e.tipo === "PERMESSO" && e.intera); });
}

function statoPasto(iso) {
  var p = pastiDelGiorno(iso);
  if (p.some(function (x) { return x.tipo === "MENSA"; })) return "MENSA";
  if (p.some(function (x) { return x.tipo === "FUORI"; })) return "FUORI";
  if (p.some(function (x) { return x.tipo === "OFFERTO"; })) return "OFFERTO";
  return "";
}

/* Etichetta piccola nella cella del calendario */
function cellaPasto(iso, info, evs) {
  if (!presenteIl(iso, info, evs)) return "";
  var s = statoPasto(iso);
  var testi = { MENSA: "Mensa", FUORI: "Pasto fuori", OFFERTO: "Offerto" };
  return "<span class='cal-pasto" + (s ? "" : " cal-pasto-no") + "'>" + (s ? testi[s] : "No pasto") + "</span>";
}

/* ---------------------------------------------------------
   HOME: pulsanti rapidi
   --------------------------------------------------------- */
function bloccoPastiHome() {
  var oggi = S.dati.oggi;
  var s = statoPasto(oggi);
  var info = infoGiorno(oggi);
  var evs = eventiAttivi().filter(function (e) { return e.dal <= oggi && e.al >= oggi; });
  var presente = presenteIl(oggi, info, evs);
  var stato = !presente ? "Oggi non risulti al lavoro" : (s ? "Oggi: " + NOMI_TIPO_PASTO[s].toLowerCase() : "Pasto di oggi non ancora indicato");
  var h = "<div class='pasti-home'>";
  h += "<button type='button' class='pasti-btn pasti-mensa' onclick='apriMensa()'><svg viewBox='0 0 24 24' aria-hidden='true'><rect x='4' y='4' width='6' height='6' rx='1'/><rect x='14' y='4' width='6' height='6' rx='1'/><rect x='4' y='14' width='6' height='6' rx='1'/><path d='M14 14h2v2h-2zM18 14h2v2M14 18h2v2M18 18h2v2'/></svg><span><b>Mensa</b><small>" + esc(stato) + "</small></span></button>";
  h += "<button type='button' class='pasti-btn' onclick='apriPastoFuori()'><svg viewBox='0 0 24 24' aria-hidden='true'><path d='M7 3v8M5 3v4a2 2 0 0 0 4 0V3M7 11v10M17 3c-2 0-3 2-3 5s1 4 3 4v9'/></svg><span><b>Pasto fuori</b><small>Scontrino o fattura</small></span></button>";
  h += "<button type='button' class='pasti-btn' onclick='apriDatiFattura()'><svg viewBox='0 0 24 24' aria-hidden='true'><path d='M6 3.5h9l3 3v14H6z'/><path d='M9 10h6M9 13.5h6M9 17h4'/></svg><span><b>Dati fattura</b><small>Pre System S.p.A.</small></span></button>";
  h += "</div>";
  return h;
}

/* ---------------------------------------------------------
   MENSA: QR a schermo intero e conferma
   --------------------------------------------------------- */
function qrSalvato() {
  try { var q = JSON.parse(localStorage.getItem(CHIAVE_QR) || "null"); return q && q.qr ? q : null; } catch (e) { return null; }
}

function apriMensa() {
  var q = qrSalvato();
  if (q && (!S.dati.qrId || q.id === S.dati.qrId)) { mostraMensa(q.qr); return; }
  if (!S.dati.haQr) {
    apriFoglio("<h2>QR della mensa</h2><div class='sottotitolo'>Carica l'immagine del QR in Impostazioni, capitolo Mensa e pasti. Poi resterà salvata su questo dispositivo e si aprirà anche senza rete.</div><button type='button' class='btn btn-primario' onclick='chiudiFoglio();S.capitolo=\"mensa\";vai(\"impostazioni\")'>Vai alle Impostazioni</button><button type='button' class='btn btn-testo' onclick='chiudiFoglio()'>Chiudi</button>");
    return;
  }
  chiama("getQrMensa", [], function (res) {
    try { localStorage.setItem(CHIAVE_QR, JSON.stringify(res)); } catch (e) { }
    mostraMensa(res.qr);
  });
}

function mostraMensa(qr) {
  var oggi = S.dati.oggi;
  var s = statoPasto(oggi);
  var h = "<div class='qr-mensa'><img src='" + esc(qr) + "' alt='QR della mensa'></div>";
  h += "<h2 style='text-align:center'>" + (s === "MENSA" ? "Pasto in mensa registrato" : "Mangi in mensa oggi?") + "</h2>";
  h += "<div class='sottotitolo' style='text-align:center'>" + esc(maiusc(dataEstesa(oggi))) + "</div>";
  if (s !== "MENSA") h += "<button type='button' class='btn btn-primario' onclick='registraPasto(\"MENSA\",\"" + oggi + "\")'>Sì, mangio in mensa</button>";
  h += "<div class='azioni-riga pasti-alt'><button type='button' class='btn btn-piccolo' onclick='chiudiFoglio();apriPastoFuori()'>Pasto fuori</button><button type='button' class='btn btn-piccolo' onclick='registraPasto(\"OFFERTO\",\"" + oggi + "\")'>Offerto da altri</button><button type='button' class='btn btn-piccolo' onclick='registraPasto(\"NESSUNO\",\"" + oggi + "\")'>Non mangio</button></div>";
  h += "<button type='button' class='btn btn-testo' onclick='chiudiFoglio()'>Chiudi</button>";
  apriFoglio(h);
}

function registraPasto(tipo, iso) {
  chiama("salvaPasto", [{ tipo: tipo, data: iso }], function (lista) {
    S.dati.pasti = lista;
    salvaCache();
    chiudiFoglio();
    vai(S.vista, true);
    avviso(tipo === "MENSA" ? "Pasto in mensa registrato" : (tipo === "OFFERTO" ? "Pasto offerto registrato" : "Registrato: nessun pasto"));
  });
}

function annullaPastoId(id) {
  chiama("annullaPasto", [id], function (lista) {
    S.dati.pasti = lista;
    salvaCache();
    chiudiFoglio();
    vai(S.vista, true);
    avviso("Pasto annullato (resta come traccia)");
  });
}

/* Sezione pasti nel foglio del giorno */
function sezionePastiGiorno(iso, info, evs) {
  if (!presenteIl(iso, info, evs)) return "";
  var p = pastiDelGiorno(iso);
  var h = "<div class='sezione-titolo'><h3>Pasto</h3></div>";
  if (!p.length) h += "<div class='aiuto'>Nessun pasto indicato: nel rapportino risulta pasto non usufruito.</div>";
  p.forEach(function (x) {
    h += "<div class='dest'><div class='dest-corpo'><div class='dest-nome'>" + esc(NOMI_TIPO_PASTO[x.tipo]) + (x.tipo === "FUORI" ? ", " + esc(x.luogo) + ", " + euroPasto(x.importo) : "") + "</div>" + (x.note ? "<div class='dest-mail'>" + esc(x.note) + "</div>" : "") + "</div><button type='button' class='btn btn-piccolo btn-pericolo' onclick='annullaPastoId(\"" + x.id + "\")'>Annulla</button></div>";
  });
  h += "<div class='azioni-riga pasti-alt'><button type='button' class='btn btn-piccolo' onclick='registraPasto(\"MENSA\",\"" + iso + "\")'>Mensa</button><button type='button' class='btn btn-piccolo' onclick='chiudiFoglio();apriPastoFuori(\"" + iso + "\")'>Pasto fuori</button><button type='button' class='btn btn-piccolo' onclick='registraPasto(\"OFFERTO\",\"" + iso + "\")'>Offerto</button><button type='button' class='btn btn-piccolo' onclick='registraPasto(\"NESSUNO\",\"" + iso + "\")'>Nessun pasto</button></div>";
  return h;
}

function euroPasto(v) {
  var n = Number(v);
  if (v === "" || isNaN(n)) return "-";
  return n.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

/* ---------------------------------------------------------
   PASTO FUORI: foto dello scontrino, lettura e conferma
   --------------------------------------------------------- */
function apriPastoFuori(iso, proposta) {
  var p = proposta || {};
  var data = p.data || iso || S.dati.oggi;
  var h = "<h2>Pasto fuori</h2><div class='sottotitolo'>Fotografa lo scontrino o la fattura: l'app prova a leggere locale, data e totale. Controlla sempre i dati prima di salvare.</div>";
  if (!proposta) {
    h += "<label class='btn btn-primario'>Fotografa o scegli il documento<input type='file' accept='image/*,application/pdf' class='nascosto' onchange='scontrinoScelto(this,\"" + data + "\")'></label>";
    h += "<button type='button' class='btn' onclick='apriPastoFuori(\"" + data + "\",{data:\"" + data + "\"})'>Inserisci a mano, senza documento</button>";
    h += "<button type='button' class='btn btn-testo' onclick='chiudiFoglio()'>Annulla</button>";
    apriFoglio(h);
    return;
  }
  S.propostaPasto = p;
  if (p.fileId) h += "<div class='anteprima'>Documento salvato nella cartella Note spese. " + (p.luogo || p.importo ? "Dati letti: verifica e correggi." : "Non sono riuscito a leggere i dati: inseriscili tu.") + "</div>";
  h += campoTesto("pf-data", "Data", data, "date");
  h += campoTesto("pf-luogo", "Locale", p.luogo || "", "text");
  h += "<div class='riga2'>" + campoTesto("pf-importo", "Importo pagato (euro)", p.importo ? String(p.importo).replace(".", ",") : "", "text") + campoTesto("pf-piva", "P.IVA del locale", p.piva || "", "text") + "</div>";
  h += "<div class='riga2'><div class='campo'><label for='pf-tipodoc'>Documento</label><select id='pf-tipodoc'><option" + (p.tipoDoc !== "Fattura" ? " selected" : "") + ">Scontrino</option><option" + (p.tipoDoc === "Fattura" ? " selected" : "") + ">Fattura</option></select></div>" + campoTesto("pf-numero", "Numero documento", p.numeroDoc || "", "text") + "</div>";
  h += campoTesto("pf-note", "Note (cliente, cantiere, colleghi)", "", "text");
  var max = Number(S.dati.impPasti && S.dati.impPasti.MAX_RIMBORSO_PASTO);
  if (max) h += "<p class='aiuto'>Rimborso massimo per pasto: " + euroPasto(max) + ".</p>";
  h += "<button type='button' class='btn btn-primario' onclick='salvaPastoFuori()'>Salva il pasto</button><button type='button' class='btn btn-testo' onclick='chiudiFoglio()'>Annulla</button>";
  apriFoglio(h);
}

function scontrinoScelto(input, data) {
  var f = input.files[0];
  input.value = "";
  if (!f) return;
  if (f.size > 15 * 1024 * 1024) { avviso("Il file supera 15 MB.", true); return; }
  var r = new FileReader();
  r.onload = function () {
    var base64 = String(r.result).split(",")[1];
    avviso("Lettura del documento in corso...");
    chiama("caricaScontrino", [base64, f.type || "image/jpeg", f.name, data], function (proposta) {
      apriPastoFuori(data, proposta);
    });
  };
  r.readAsDataURL(f);
}

function salvaPastoFuori() {
  var p = S.propostaPasto || {};
  var d = { tipo: "FUORI", data: valore("pf-data"), luogo: valore("pf-luogo"), importo: valore("pf-importo"), piva: valore("pf-piva"), tipoDoc: valore("pf-tipodoc"), numeroDoc: valore("pf-numero"), note: valore("pf-note"), fileId: p.fileId || "", url: p.url || "" };
  chiama("salvaPasto", [d], function (lista) {
    S.dati.pasti = lista;
    S.propostaPasto = null;
    salvaCache();
    chiudiFoglio();
    vai(S.vista, true);
    avviso("Pasto fuori salvato: entra nella nota spese del mese");
  });
}

/* ---------------------------------------------------------
   DATI PER LA FATTURA
   --------------------------------------------------------- */
function testoDatiFattura() {
  var f = S.dati.impPasti || {};
  var r = [f.FATT_RAGIONE, f.FATT_INDIRIZZO, f.FATT_CITTA, "P.IVA e C.F. " + f.FATT_PIVA];
  if (f.FATT_SDI) r.push("Codice destinatario SDI: " + f.FATT_SDI);
  if (f.FATT_PEC) r.push("PEC: " + f.FATT_PEC);
  return r.join("\n");
}

function apriDatiFattura() {
  var f = S.dati.impPasti || {};
  var h = "<h2>Dati per la fattura</h2><div class='sottotitolo'>Da mostrare o dettare al locale per farti intestare la fattura.</div>";
  h += "<div class='dati-fattura'>" + esc(testoDatiFattura()).replace(/\n/g, "<br>") + "</div>";
  if (!f.FATT_SDI && !f.FATT_PEC) h += "<div class='avvertenza'>Manca il codice destinatario SDI o la PEC per la fattura elettronica: chiedilo all'amministrazione e inseriscilo in Impostazioni, capitolo Dati per le fatture.</div>";
  h += "<button type='button' class='btn btn-primario' onclick='copia(testoDatiFattura())'>Copia i dati</button>";
  h += "<button type='button' class='btn' onclick='condividiDatiFattura()'>Condividi (messaggio o mail)</button>";
  h += "<button type='button' class='btn btn-testo' onclick='chiudiFoglio()'>Chiudi</button>";
  apriFoglio(h);
}

function condividiDatiFattura() {
  var t = testoDatiFattura();
  if (navigator.share) navigator.share({ title: "Dati per la fattura", text: t }).catch(function () { });
  else copia(t);
}

/* ---------------------------------------------------------
   NOTA SPESE MENSILE (scheda Rapportino)
   --------------------------------------------------------- */
function bloccoNotaSpese() {
  var cod = S.rapportinoMese;
  var p = cod.split("-");
  var lista = pastiAttivi().filter(function (x) { return x.tipo === "FUORI" && x.data.substr(0, 7) === cod; }).sort(function (a, b) { return a.data < b.data ? -1 : 1; });
  var tot = lista.reduce(function (s, x) { return s + Number(x.importo || 0); }, 0);
  var h = "<div class='blocco'><h3>Nota spese di " + esc(MESI[Number(p[1]) - 1] + " " + p[0]) + "</h3>";
  h += "<p class='aiuto'>Pasti fuori a piè di lista, con le foto dei documenti in allegato. Si manda a parte rispetto al rapportino, agli stessi destinatari.</p>";
  if (!lista.length) {
    h += "<div class='vuoto'>Nessun pasto fuori in questo mese.</div></div>";
    return h;
  }
  h += "<div class='dettagli'>";
  lista.forEach(function (x) { h += "<div><span>" + esc(dataBreve(x.data) + " " + x.luogo) + "</span><span>" + euroPasto(x.importo) + "</span></div>"; });
  h += "<div><span><b>Totale</b></span><span><b>" + euroPasto(Math.round(tot * 100) / 100) + "</b></span></div></div>";
  h += "<button type='button' class='btn btn-primario' onclick='generaNotaSpese()'>Genera la nota spese</button>";
  var r = S.esitoNotaSpese;
  if (r && r.mese === cod) {
    h += "<div class='anteprima'>Nota spese pronta: " + r.pasti + " pasti, " + euroPasto(r.totale) + (r.totaleRimborsabile !== r.totale ? ", rimborsabile " + euroPasto(r.totaleRimborsabile) : "") + ".</div>";
    if (r.allegatiPdf) h += "<div class='avvertenza'>" + r.allegatiPdf + (r.allegatiPdf === 1 ? " documento è" : " documenti sono") + " in PDF: allegali alla mail oltre alla nota spese (li trovi in Fascicolo lavoro, cartella Note spese).</div>";
    h += "<a class='btn btn-primario' href='" + esc(r.mail.mailto) + "'>Apri la mail in Outlook</a>";
    h += "<button type='button' class='btn' onclick='visualizzaNotaSpese()'>Visualizza il PDF</button>";
    h += "<button type='button' class='btn' onclick='condividiNotaSpese()'>Condividi il PDF</button>";
  }
  h += "</div>";
  return h;
}

function generaNotaSpese() {
  var p = S.rapportinoMese.split("-");
  chiama("generaNotaSpese", [Number(p[0]), Number(p[1])], function (res) {
    S.fileNotaSpese = { nomeFile: res.nomeFile, pdf: res.pdf };
    res.pdf = "";
    S.esitoNotaSpese = res;
    renderRapportino();
    avviso("Nota spese salvata su Drive");
  });
}

function visualizzaNotaSpese() {
  if (!S.fileNotaSpese) return;
  mostraAnteprima(S.fileNotaSpese.nomeFile, "application/pdf", S.fileNotaSpese.pdf, condividiNotaSpese);
}

function condividiNotaSpese() {
  if (!S.fileNotaSpese) return;
  PDF_CORRENTE = S.fileNotaSpese;
  condividiPdf();
}

/* ---------------------------------------------------------
   PREAVVISO DI 48 ORE (contratto)
   --------------------------------------------------------- */
function avvisoPreavviso() {
  if (S.tipo !== "FERIE" && S.tipo !== "PERMESSO") return "";
  var intera = S.tipo === "FERIE" || (el("f-intera") && el("f-intera").checked);
  var giorno = intera ? valore("f-dal") : valore("f-giorno");
  if (!giorno) return "";
  var ora = intera ? S.dati.impostazioni.MATTINA_INIZIO || "08:30" : (valore("f-dalle") || "08:30");
  var p = giorno.split("-"), o = ora.split(":");
  var inizio = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]), Number(o[0]), Number(o[1]));
  var ore = (inizio - new Date()) / 3600000;
  if (ore < 0 || ore >= 48) return "";
  return " Attenzione: il contratto chiede almeno 48 ore di preavviso, salvo urgenze.";
}

/* ---------------------------------------------------------
   IMPOSTAZIONI: mensa e dati per le fatture
   --------------------------------------------------------- */
function capitoloMensa() {
  var f = S.dati.impPasti || {};
  var h = "<img class='logo-anteprima' id='qrAnteprima' alt='' style='display:none'>";
  h += "<p class='aiuto' id='qrStato'>" + (S.dati.haQr ? "QR caricato. Su ogni dispositivo viene salvato al primo uso e si apre anche senza rete." : "Carica la foto o lo screenshot del tuo QR personale della mensa.") + "</p>";
  h += "<div class='campo'><label for='qrFile'>" + (S.dati.haQr ? "Sostituisci il QR" : "Carica il QR") + " (PNG o JPG)</label><input type='file' id='qrFile' accept='image/png,image/jpeg' onchange='caricaQr()'></div>";
  h += "<div class='campo'><label for='mp-rapportino'>Pasti nel rapportino mensile</label><select id='mp-rapportino'>" + opzioniSemplici([["SI", "Sì, mostra colonna e totali dei pasti"], ["NO", "No, non mostrarli"]], f.PASTI_NEL_RAPPORTINO || "SI") + "</select></div>";
  h += campoTesto("mp-max", "Rimborso massimo per pasto fuori (euro, vuoto se non c'è tetto)", f.MAX_RIMBORSO_PASTO ? String(f.MAX_RIMBORSO_PASTO).replace(".", ",") : "", "text");
  h += "<button type='button' class='btn btn-primario' onclick='salvaImpPasti()'>Salva</button>";
  return ["mensa", "Mensa e pasti", S.dati.haQr ? "QR caricato" : "QR da caricare", h, !S.dati.haQr];
}

function capitoloFatture() {
  var f = S.dati.impPasti || {};
  var h = "<p class='aiuto'>Dati da comunicare a ristoranti, bar e trattorie per la fattura intestata all'azienda.</p>";
  h += campoTesto("ft-ragione", "Ragione sociale", f.FATT_RAGIONE, "text");
  h += campoTesto("ft-indirizzo", "Indirizzo", f.FATT_INDIRIZZO, "text");
  h += campoTesto("ft-citta", "CAP e città", f.FATT_CITTA, "text");
  h += campoTesto("ft-piva", "P.IVA e codice fiscale", f.FATT_PIVA, "text");
  h += "<div class='riga2'>" + campoTesto("ft-sdi", "Codice destinatario SDI", f.FATT_SDI, "text") + campoTesto("ft-pec", "PEC", f.FATT_PEC, "email") + "</div>";
  h += "<button type='button' class='btn btn-primario' onclick='salvaImpPasti()'>Salva</button>";
  return ["fatture", "Dati per le fatture", (f.FATT_SDI || f.FATT_PEC) ? "Completi" : "Manca SDI o PEC", h, !(f.FATT_SDI || f.FATT_PEC)];
}

function opzioniSemplici(lista, scelto) {
  return lista.map(function (o) { return "<option value='" + esc(o[0]) + "'" + (o[0] === scelto ? " selected" : "") + ">" + esc(o[1]) + "</option>"; }).join("");
}

function salvaImpPasti() {
  var f = S.dati.impPasti || {};
  var d = {
    FATT_RAGIONE: el("ft-ragione") ? valore("ft-ragione") : f.FATT_RAGIONE,
    FATT_INDIRIZZO: el("ft-indirizzo") ? valore("ft-indirizzo") : f.FATT_INDIRIZZO,
    FATT_CITTA: el("ft-citta") ? valore("ft-citta") : f.FATT_CITTA,
    FATT_PIVA: el("ft-piva") ? valore("ft-piva") : f.FATT_PIVA,
    FATT_SDI: el("ft-sdi") ? valore("ft-sdi") : f.FATT_SDI,
    FATT_PEC: el("ft-pec") ? valore("ft-pec") : f.FATT_PEC,
    MAX_RIMBORSO_PASTO: el("mp-max") ? valore("mp-max") : f.MAX_RIMBORSO_PASTO,
    PASTI_NEL_RAPPORTINO: el("mp-rapportino") ? valore("mp-rapportino") : f.PASTI_NEL_RAPPORTINO
  };
  chiama("salvaImpPasti", [d], function (imp) {
    S.dati.impPasti = imp;
    salvaCache();
    renderImpostazioni();
    avviso("Salvato");
  });
}

function caricaQr() {
  var f = el("qrFile").files[0];
  if (!f) return;
  if (f.size > 5 * 1024 * 1024) { avviso("L'immagine supera 5 MB.", true); return; }
  var r = new FileReader();
  r.onload = function () {
    chiama("caricaQrMensa", [String(r.result).split(",")[1], f.type], function (res) {
      try { localStorage.setItem(CHIAVE_QR, JSON.stringify(res)); } catch (e) { }
      S.dati.haQr = true;
      S.dati.qrId = res.id;
      salvaCache();
      renderImpostazioni();
      avviso("QR della mensa salvato");
    });
  };
  r.readAsDataURL(f);
}

function mostraQrImpostazioni() {
  var q = qrSalvato();
  var img = el("qrAnteprima");
  if (img && q && q.qr) { img.src = q.qr; img.style.display = "block"; }
}
