/* =========================================================
   LAVORO PRE SYSTEM - Marco Tabaro
   File: eventi.js - eventi di lavoro (fiere, corsi, convegni, visite, trasferte),
   biglietti e documenti senza PIN, biglietti salvati sul dispositivo fino alla
   fine dell'evento, scheda documento leggibile anche su telefono.
   ========================================================= */

var TIPI_EVLAV = [["FIERA", "Fiera"], ["CORSO", "Corso o formazione"], ["CONVEGNO", "Convegno"], ["VISITA", "Visita"], ["TRASFERTA", "Trasferta"], ["ALTRO", "Altro"]];
var NOMI_EVLAV = { FIERA: "Fiera", CORSO: "Corso o formazione", CONVEGNO: "Convegno", VISITA: "Visita", TRASFERTA: "Trasferta", ALTRO: "Evento" };
var CHIAVE_BIGLIETTI = "pps.biglietti";

function eventiLavAttivi() {
  return (S.dati.eventiLavoro || []).filter(function (e) { return e.stato === "ATTIVO"; });
}

function eventiLavDelGiorno(iso) {
  return eventiLavAttivi().filter(function (e) { return e.dal <= iso && e.al >= iso; });
}

function eventoLavDaId(id) {
  return (S.dati.eventiLavoro || []).filter(function (e) { return e.id === id; })[0] || null;
}

function docDiEvento(id, ancheObsoleti) {
  return (S.dati.docEventi || []).filter(function (d) { return d.eventoId === id && (ancheObsoleti || d.stato === "ATTIVO"); });
}

function periodoEvento(e) {
  return e.dal === e.al ? dataBreve(e.dal) : "dal " + dataBreve(e.dal) + " al " + dataBreve(e.al);
}

function aggiornaEventiLocali(pacchetto) {
  if (pacchetto.eventiLavoro) S.dati.eventiLavoro = pacchetto.eventiLavoro;
  if (pacchetto.docEventi) S.dati.docEventi = pacchetto.docEventi;
  salvaCache();
}

/* ---------------------------------------------------------
   SCHEDA DOCUMENTO (usata anche dal fascicolo)
   Telefono: titolo a tutta larghezza, pulsanti sotto. Tablet e PC: tutto su una riga.
   --------------------------------------------------------- */
function schedaDocumentoHtml(o) {
  var icona = /\.(jpe?g|png|gif|webp|heic|bmp|tiff?)$/i.test(o.nomeFile || "") ? "IMG" : "PDF";
  var corpo = "<span class='doc-icona" + (icona === "IMG" ? " img" : "") + "'>" + icona + "</span><span class='doc-testi'><span class='doc-titolo'>" + esc(o.titolo) + "</span><span class='doc-sub'>" + esc(o.sub) + "</span></span>";
  var h = "<div class='doc-scheda" + (o.obsoleto ? " obsoleto" : "") + "'>";
  if (o.href) h += "<a class='doc-corpo' href='" + esc(o.href) + "' target='_blank' rel='noopener'>" + corpo + "</a>";
  else h += "<button type='button' class='doc-corpo' onclick='" + o.alClic + "'>" + corpo + "</button>";
  h += "<div class='doc-azioni'>" + o.azioni + "</div></div>";
  return h;
}

/* Obsoleto chiede sempre conferma. ambito: "evento" (biglietti) o "fascicolo" (documenti del fascicolo) */
function confermaObsoleto(docId, ambito) {
  var lista = ambito === "evento" ? (S.dati.docEventi || []) : ((S.eco && S.eco.documenti) || []);
  var d = lista.filter(function (x) { return x.id === docId; })[0];
  if (!d) return;
  var h = "<h2>Rendere obsoleto il documento?</h2><div class='sottotitolo'>" + esc(d.titolo || d.nomeFile) + "</div>";
  h += "<p class='aiuto'>Il file non viene cancellato: resta in archivio come obsoleto e si può riattivare.</p>";
  h += "<button type='button' class='btn btn-pericolo' onclick='chiudiFoglio();" + (ambito === "evento" ? "statoDocEventoUI" : "statoDocumento") + "(\"" + docId + "\",\"OBSOLETO\")'>Sì, rendi obsoleto</button>";
  h += "<button type='button' class='btn btn-testo' onclick='" + (ambito === "evento" ? "apriEventoLavoro(\"" + d.eventoId + "\")" : "chiudiFoglio()") + "'>Annulla</button>";
  apriFoglio(h);
}

/* ---------------------------------------------------------
   CALENDARIO E HOME
   --------------------------------------------------------- */
function chipEventoLavoro(iso) {
  return eventiLavDelGiorno(iso).slice(0, 1).map(function (e) {
    return "<span class='cal-ev ev-lavoro'>" + esc(e.nome) + "</span>";
  }).join("");
}

function bloccoEventiHome() {
  var oggi = S.dati.oggi;
  var lista = eventiLavAttivi().filter(function (e) { return e.al >= oggi; }).slice(0, 2);
  if (!lista.length) return "";
  var h = "<div class='sezione-titolo'><h2>Prossimi eventi di lavoro</h2></div><div class='lista'>";
  lista.forEach(function (e) {
    var docs = docDiEvento(e.id);
    var inCorso = e.dal <= oggi;
    h += "<div class='voce voce-evento'><div class='voce-corpo' onclick='apriEventoLavoro(\"" + e.id + "\")' style='cursor:pointer'><div class='voce-titolo'>" + esc(e.nome) + (inCorso ? " <span class='pill pill-ok'>In corso</span>" : "") + "</div><div class='voce-sub'>" + esc(NOMI_EVLAV[e.tipo] + ", " + periodoEvento(e) + (e.luogo ? ", " + e.luogo : "")) + "</div></div>";
    h += docs.length ? "<button type='button' class='btn btn-piccolo btn-primario' onclick='apriBiglietto(\"" + e.id + "\")'>" + (docs.length === 1 ? "Biglietto" : "Documenti") + "</button>" : "<button type='button' class='btn btn-piccolo' onclick='apriEventoLavoro(\"" + e.id + "\")'>Apri</button>";
    h += "</div>";
  });
  return h + "</div>";
}

function sezioneEventiGiorno(iso) {
  var lista = eventiLavDelGiorno(iso);
  var h = "<div class='sezione-titolo'><h3>Eventi di lavoro</h3></div>";
  lista.forEach(function (e) {
    var docs = docDiEvento(e.id);
    h += "<div class='voce voce-evento'><div class='voce-corpo' onclick='apriEventoLavoro(\"" + e.id + "\")' style='cursor:pointer'><div class='voce-titolo'>" + esc(e.nome) + "</div><div class='voce-sub'>" + esc(NOMI_EVLAV[e.tipo] + ", " + periodoEvento(e) + (e.luogo ? ", " + e.luogo : "")) + "</div></div>";
    if (docs.length) h += "<button type='button' class='btn btn-piccolo btn-primario' onclick='apriBiglietto(\"" + e.id + "\")'>" + (docs.length === 1 ? "Biglietto" : "Documenti") + "</button>";
    h += "</div>";
  });
  if (lista.length) h += "<p class='aiuto'>Giorno di evento: se hai mangiato fuori, registra il pasto fuori per la nota spese.</p>";
  h += "<button type='button' class='btn' onclick='apriFormEventoLavoro(\"" + iso + "\")'>Aggiungi un evento di lavoro</button>";
  return h;
}

/* ---------------------------------------------------------
   MODULO: NUOVO EVENTO O MODIFICA
   --------------------------------------------------------- */
function apriFormEventoLavoro(dal, id) {
  var e = id ? eventoLavDaId(id) : { tipo: "FIERA", dal: dal || S.dati.oggi, al: dal || S.dati.oggi };
  var h = "<h2>" + (id ? "Modifica evento di lavoro" : "Nuovo evento di lavoro") + "</h2>";
  h += "<div class='sottotitolo'>Fiere, corsi, convegni, visite e trasferte. In un giorno feriale il giorno resta lavorato e viene contato anche a parte nel rapportino.</div>";
  h += "<div class='campo'><label for='el-tipo'>Tipo</label><select id='el-tipo'>" + TIPI_EVLAV.map(function (t) { return "<option value='" + t[0] + "'" + (t[0] === e.tipo ? " selected" : "") + ">" + t[1] + "</option>"; }).join("") + "</select></div>";
  h += campoTesto("el-nome", "Nome (es. SAIE)", e.nome || "", "text");
  h += campoTesto("el-luogo", "Luogo (es. Bologna, Fiera)", e.luogo || "", "text");
  h += "<div class='riga2'>" + campoTesto("el-dal", "Dal", e.dal, "date") + campoTesto("el-al", "Al", e.al, "date") + "</div>";
  h += "<p class='aiuto'>Indica solo i giorni in cui partecipi davvero, non tutta la durata dell'evento.</p>";
  h += campoTesto("el-note", "Note (es. con chi, motivo)", e.note || "", "text");
  h += "<button type='button' class='btn btn-primario' onclick='salvaEventoLavoroUI(\"" + (id || "") + "\")'>Salva</button><button type='button' class='btn btn-testo' onclick='chiudiFoglio()'>Annulla</button>";
  apriFoglio(h);
}

function salvaEventoLavoroUI(id) {
  var d = { id: id || "", tipo: valore("el-tipo"), nome: valore("el-nome"), luogo: valore("el-luogo"), dal: valore("el-dal"), al: valore("el-al") || valore("el-dal"), note: valore("el-note") };
  if (d.nome.length < 3) { avviso("Scrivi il nome dell'evento (almeno 3 caratteri).", true); return; }
  if (!d.dal) { avviso("Indica la data di inizio.", true); return; }
  if (d.al < d.dal) { avviso("La data di fine è precedente all'inizio.", true); return; }
  chiama("salvaEventoLavoro", [d], function (res) {
    aggiornaEventiLocali(res);
    vai(S.vista, true);
    apriEventoLavoro(res.evento.id);
    avviso(id ? "Evento aggiornato" : "Evento salvato nel calendario: ora puoi caricare biglietto e documenti");
  });
}

/* ---------------------------------------------------------
   DETTAGLIO EVENTO: documenti e caricamento (titolo obbligatorio, poi conferma)
   --------------------------------------------------------- */
function apriEventoLavoro(id) {
  var e = eventoLavDaId(id);
  if (!e) return;
  var h = "<h2>" + esc(e.nome) + "</h2><div class='sottotitolo'>" + esc(NOMI_EVLAV[e.tipo] + ", " + periodoEvento(e) + (e.luogo ? ", " + e.luogo : "")) + (e.stato !== "ATTIVO" ? " (annullato)" : "") + "</div>";
  if (e.note) h += "<p class='aiuto'>" + esc(e.note) + "</p>";
  var docs = docDiEvento(id, true);
  h += "<div class='sezione-titolo'><h3>Biglietti e documenti</h3></div>";
  if (!docs.length) h += "<div class='vuoto'>Nessun documento caricato.</div>";
  docs.forEach(function (d) { h += schedaDocEvento(d); });
  if (e.stato === "ATTIVO") {
    h += "<div class='blocco' style='margin-top:12px'><h3>Carica un documento</h3>";
    h += campoTesto("el-tit", "Titolo (obbligatorio)", "", "text").replace("<input ", "<input oninput='zonaEventoAggiorna()' placeholder='Es. Biglietto SAIE Bologna' ");
    h += "<div class='zona-carica bloccata' id='zona-EVENTO'><div class='zona-testo' id='zona-testo-EVENTO'>Scrivi prima il titolo: poi potrai scegliere il file</div>";
    h += "<label class='btn btn-primario btn-piccolo' id='zona-btn-EVENTO' onclick='if(!titoloEventoValido()){event.preventDefault();avviso(\"Scrivi prima il titolo del documento (almeno 3 caratteri).\",true);el(\"el-tit\").focus();}'>+ Carica<input type='file' id='zona-file-EVENTO' accept='application/pdf,image/*' class='nascosto' disabled onchange='fileEventoScelto(this,\"" + id + "\")'></label></div></div>";
    h += "<div class='azioni-riga' style='margin-top:12px'><button type='button' class='btn btn-piccolo' onclick='apriFormEventoLavoro(\"\",\"" + id + "\")'>Modifica</button><button type='button' class='btn btn-piccolo btn-pericolo' onclick='confermaAnnullaEvento(\"" + id + "\")'>Annulla evento</button></div>";
  }
  h += "<button type='button' class='btn btn-testo' onclick='chiudiFoglio()'>Chiudi</button>";
  apriFoglio(h);
}

function schedaDocEvento(d) {
  var att = d.stato === "ATTIVO";
  var azioni = "<button type='button' class='btn btn-piccolo' onclick='condividiDocEvento(\"" + d.id + "\")'>Condividi</button>";
  azioni += att ? "<button type='button' class='btn btn-piccolo btn-pericolo-tenue' onclick='confermaObsoleto(\"" + d.id + "\",\"evento\")'>Obsoleto</button>" : "<button type='button' class='btn btn-piccolo' onclick='statoDocEventoUI(\"" + d.id + "\",\"ATTIVO\")'>Riattiva</button>";
  return schedaDocumentoHtml({ titolo: d.titolo, sub: "Caricato il " + dataBreve(d.caricato) + (att ? "" : ", obsoleto"), nomeFile: d.nomeFile, href: urlDrive(d.fileId), obsoleto: !att, azioni: azioni });
}

function titoloEventoValido() { return valore("el-tit").length >= 3; }

function zonaEventoAggiorna() {
  var ok = titoloEventoValido();
  var z = el("zona-EVENTO"), t = el("zona-testo-EVENTO"), inp = el("zona-file-EVENTO");
  if (!z) return;
  z.classList.toggle("bloccata", !ok);
  t.textContent = ok ? "Scegli il file (PDF o immagine, massimo 15 MB)" : "Scrivi prima il titolo: poi potrai scegliere il file";
  inp.disabled = !ok;
}

function fileEventoScelto(input, id) {
  var f = input.files[0];
  input.value = "";
  if (!f) return;
  if (!titoloEventoValido()) { avviso("Scrivi prima il titolo del documento.", true); return; }
  if (f.size > 15 * 1024 * 1024) { avviso("Il file supera 15 MB.", true); return; }
  var e = eventoLavDaId(id);
  S.docEventoPendente = { file: f, id: id, titolo: valore("el-tit") };
  var h = "<h2>Confermi il caricamento?</h2><div class='sottotitolo'>Controlla i dati: il file verrà salvato con questi riferimenti.</div><div class='dettagli'>";
  [["Evento", e.nome + ", " + periodoEvento(e)], ["File", f.name], ["Titolo", S.docEventoPendente.titolo]].forEach(function (r) { h += "<div><span>" + esc(r[0]) + "</span><span>" + esc(r[1]) + "</span></div>"; });
  h += "</div><button type='button' class='btn btn-primario' onclick='confermaDocEvento()'>Carica</button><button type='button' class='btn btn-testo' onclick='apriEventoLavoro(\"" + id + "\")'>Annulla e correggi</button>";
  apriFoglio(h);
}

function confermaDocEvento() {
  var p = S.docEventoPendente;
  if (!p) return;
  S.docEventoPendente = null;
  var r = new FileReader();
  r.onload = function () {
    chiama("caricaDocEvento", [p.id, p.titolo, String(r.result).split(",")[1], p.file.type || "application/pdf", p.file.name], function (res) {
      aggiornaEventiLocali(res);
      preparaBigliettiOffline();
      apriEventoLavoro(p.id);
      avviso("Documento salvato in Eventi e trasferte");
    });
  };
  r.readAsDataURL(p.file);
}

function statoDocEventoUI(docId, stato) {
  var d = (S.dati.docEventi || []).filter(function (x) { return x.id === docId; })[0];
  chiama("statoDocEvento", [docId, stato], function (res) {
    aggiornaEventiLocali(res);
    if (d) apriEventoLavoro(d.eventoId);
    avviso(stato === "OBSOLETO" ? "Documento reso obsoleto (resta in archivio)" : "Documento riattivato");
  });
}

function confermaAnnullaEvento(id) {
  var e = eventoLavDaId(id);
  var h = "<h2>Annullare l'evento?</h2><div class='sottotitolo'>" + esc(e.nome + ", " + periodoEvento(e)) + "</div>";
  h += "<p class='aiuto'>Sparisce dal calendario e dai conteggi del rapportino. Evento e documenti restano in archivio.</p>";
  h += "<button type='button' class='btn btn-pericolo' onclick='annullaEventoUI(\"" + id + "\")'>Sì, annulla l'evento</button><button type='button' class='btn btn-testo' onclick='apriEventoLavoro(\"" + id + "\")'>No, torna indietro</button>";
  apriFoglio(h);
}

function annullaEventoUI(id) {
  chiama("annullaEventoLavoro", [id], function (res) {
    aggiornaEventiLocali(res);
    chiudiFoglio();
    vai(S.vista, true);
    avviso("Evento annullato");
  });
}

/* ---------------------------------------------------------
   BIGLIETTO: subito, anche senza rete
   --------------------------------------------------------- */
function bigliettiSalvati() {
  try { return JSON.parse(localStorage.getItem(CHIAVE_BIGLIETTI) || "{}"); } catch (e) { return {}; }
}

function salvaBiglietti(m) {
  try { localStorage.setItem(CHIAVE_BIGLIETTI, JSON.stringify(m)); return true; } catch (e) { return false; }
}

function apriBiglietto(eventoId) {
  var docs = docDiEvento(eventoId);
  if (docs.length !== 1) { apriEventoLavoro(eventoId); return; }
  var d = docs[0];
  var b = bigliettiSalvati()[d.id];
  if (b) { mostraAnteprima(b.nomeFile, b.mime, b.base64, function () { condividiFile(b.nomeFile, b.mime, b.base64); }); return; }
  condividiDocEvento(d.id);
}

function condividiDocEvento(docId) {
  var salvato = bigliettiSalvati()[docId];
  if (salvato) { mostraAnteprima(salvato.nomeFile, salvato.mime, salvato.base64, function () { condividiFile(salvato.nomeFile, salvato.mime, salvato.base64); }); return; }
  chiama("scaricaDocEvento", [docId], function (res) {
    mostraAnteprima(res.nomeFile, res.mime, res.base64, function () { condividiFile(res.nomeFile, res.mime, res.base64); });
  });
}

/* Biglietti degli eventi in corso o entro 7 giorni: salvati sul dispositivo, tolti dopo la fine dell'evento */
function preparaBigliettiOffline() {
  if (!S.dati || !S.dati.docEventi) return;
  var oggi = S.dati.oggi;
  var limite = aggiungiGiorniIso(oggi, 7);
  var m = bigliettiSalvati();
  var attivi = {};
  eventiLavAttivi().filter(function (e) { return e.al >= oggi && e.dal <= limite; }).forEach(function (e) {
    docDiEvento(e.id).forEach(function (d) { attivi[d.id] = e.al; });
  });
  Object.keys(m).forEach(function (k) { if (!attivi[k]) delete m[k]; });
  salvaBiglietti(m);
  Object.keys(attivi).forEach(function (docId) {
    if (m[docId]) return;
    api("scaricaDocEvento", [docId]).then(function (res) {
      if (String(res.base64).length > 3000000) return;
      var mm = bigliettiSalvati();
      mm[docId] = { nomeFile: res.nomeFile, mime: res.mime, base64: res.base64, scade: attivi[docId] };
      salvaBiglietti(mm);
    }).catch(function () { });
  });
}

function aggiungiGiorniIso(iso, n) {
  var p = iso.split("-");
  var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]) + n);
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
}
