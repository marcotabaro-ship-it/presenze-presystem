/* =========================================================
   LAVORO PRE SYSTEM - Marco Tabaro
   File: fascicolo.js - area riservata: buste paga, CU, auto aziendale,
   documenti e report. I dati economici restano solo in memoria,
   mai salvati sul dispositivo.
   ========================================================= */

var SESSIONE_MINUTI = 10;
S.sess = null;
S.eco = null;
S.fTab = "buste";
S.fForm = null;
S.fAnno = "";
S.fVoci = [];
S.fFiltri = null;
S.fDoc = { tipo: "TUTTI", anno: "TUTTI", stato: "ATTIVO" };

var MESI_BREVI = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];

/* ---------------------------------------------------------
   SESSIONE E BLOCCO PER INATTIVITA
   --------------------------------------------------------- */
function attivitaUtente() {
  if (S.sess) S.sess.ultimo = Date.now();
}
document.addEventListener("pointerdown", attivitaUtente, true);
document.addEventListener("keydown", attivitaUtente, true);
setInterval(function () {
  if (S.sess && Date.now() - S.sess.ultimo > SESSIONE_MINUTI * 60000) bloccaFascicolo(true);
}, 30000);
document.addEventListener("visibilitychange", function () {
  if (document.visibilityState === "visible" && S.sess && Date.now() - S.sess.ultimo > SESSIONE_MINUTI * 60000) bloccaFascicolo(true);
});

function bloccaFascicolo(perInattivita) {
  var chiave = S.sess ? S.sess.chiave : "";
  S.sess = null;
  S.eco = null;
  S.fForm = null;
  if (chiave) api("bloccaArea", [chiave]).catch(function () { });
  if (S.vista === "fascicolo") renderFascicolo();
  if (perInattivita) avviso("Area riservata bloccata dopo " + SESSIONE_MINUTI + " minuti di inattività");
}

/* ---------------------------------------------------------
   UTILITA
   --------------------------------------------------------- */
function euro(v) {
  if (v === "" || v === null || v === undefined) return "-";
  var n = Number(v);
  if (isNaN(n)) return "-";
  return n.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

function numIt(v, dec) {
  if (v === "" || v === null || v === undefined) return "-";
  var n = Number(v);
  if (isNaN(n)) return "-";
  return n.toLocaleString("it-IT", { minimumFractionDigits: dec === undefined ? 2 : dec, maximumFractionDigits: dec === undefined ? 2 : dec });
}

function nv(v) { var n = Number(v); return isNaN(n) || v === "" ? 0 : n; }

function valoreInput(v) {
  if (v === "" || v === undefined || v === null) return "";
  var s = String(v);
  return /^-?\d+(\.\d+)?$/.test(s) ? s.replace(".", ",") : s;
}

function periodoBusta(b) {
  return maiusc(MESI[Number(b.mese) - 1]) + " " + b.anno + (b.tipoBusta && b.tipoBusta !== "Mensile" ? " - " + b.tipoBusta : "");
}

function docDaId(id) {
  return (S.eco.documenti || []).filter(function (d) { return d.id === id; })[0] || null;
}

function veicoloDaId(id) {
  return (S.eco.veicoli || []).filter(function (v) { return v.id === id; })[0] || null;
}

function opzioni(lista, scelto) {
  return lista.map(function (o) {
    var val = Array.isArray(o) ? o[0] : o, testo = Array.isArray(o) ? o[1] : o;
    return "<option value='" + esc(val) + "'" + (String(val) === String(scelto) ? " selected" : "") + ">" + esc(testo) + "</option>";
  }).join("");
}

function campoF(id, etichetta, valore, tipo, extra) {
  var t = tipo === "num" ? "text' inputmode='decimal" : tipo;
  return "<div class='campo'><label for='" + id + "'>" + esc(etichetta) + "</label><input type='" + t + "' id='" + id + "' value='" + esc(tipo === "num" ? valoreInput(valore) : (valore || "")) + "'" + (extra || "") + "></div>";
}

/* Scarica o condivide un file ricevuto in base64 */
function condividiFile(nomeFile, mime, base64) {
  var bin = atob(base64);
  var byte = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) byte[i] = bin.charCodeAt(i);
  var blob = new Blob([byte], { type: mime || "application/octet-stream" });
  var file = null;
  try { file = new File([blob], nomeFile, { type: blob.type }); } catch (e) { file = null; }
  if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
    navigator.share({ files: [file], title: nomeFile }).catch(function (err) { if (err && err.name !== "AbortError") scaricaBlob(blob, nomeFile); });
  } else {
    scaricaBlob(blob, nomeFile);
  }
}

function scaricaBlob(blob, nomeFile) {
  var u = URL.createObjectURL(blob);
  var a = document.createElement("a");
  a.href = u;
  a.download = nomeFile;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function () { URL.revokeObjectURL(u); }, 30000);
}

/* Il file viene preparato prima, poi un tocco lo condivide (i telefoni lo richiedono) */
function apriDocumento(id) {
  chiama("ecoScaricaDocumento", [id], function (res) {
    S.fileCorrente = res;
    var h = "<h2>File pronto</h2><div class='sottotitolo'>" + esc(res.nomeFile) + "</div>";
    h += "<button type='button' class='btn btn-primario' onclick='condividiFileCorrente()'>Apri o condividi</button>";
    h += "<button type='button' class='btn btn-testo' onclick='chiudiFoglio()'>Chiudi</button>";
    apriFoglio(h);
  });
}

function condividiFileCorrente() {
  if (S.fileCorrente) condividiFile(S.fileCorrente.nomeFile, S.fileCorrente.mime, S.fileCorrente.base64);
}

function scaricaCsv(nomeFile, righe) {
  var testo = "\ufeff" + righe.map(function (r) {
    return r.map(function (c) {
      var s = c === null || c === undefined ? "" : String(c);
      if (typeof c === "number") s = String(Math.round(c * 100) / 100).replace(".", ",");
      return /[;"\n]/.test(s) ? "\"" + s.replace(/"/g, "\"\"") + "\"" : s;
    }).join(";");
  }).join("\r\n");
  var blob = new Blob([testo], { type: "text/csv;charset=utf-8" });
  var file = null;
  try { file = new File([blob], nomeFile, { type: "text/csv" }); } catch (e) { file = null; }
  if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
    navigator.share({ files: [file], title: nomeFile }).catch(function (err) { if (err && err.name !== "AbortError") scaricaBlob(blob, nomeFile); });
  } else {
    scaricaBlob(blob, nomeFile);
  }
}

/* ---------------------------------------------------------
   VISTA PRINCIPALE
   --------------------------------------------------------- */
function renderFascicolo() {
  var v = el("v-fascicolo");
  if (!S.sess) { v.innerHTML = schermataBlocco(); setTimeout(function () { var p = el("a-pin"); if (p) p.focus(); }, 120); return; }
  if (!S.eco) {
    v.innerHTML = "<div class='vuoto'>Caricamento del fascicolo...</div>";
    caricaEco();
    return;
  }
  var h = [];
  h.push("<div class='fasc-testa'><h1 class='titolo-vista'>Fascicolo lavoro</h1><div class='azioni-riga'><a class='btn btn-piccolo' href='" + esc(S.eco.cartella) + "' target='_blank' rel='noopener'>Cartella Drive</a><button type='button' class='btn btn-piccolo' onclick='bloccaFascicolo(false)'>Blocca</button></div></div>");
  var schede = [["buste", "Buste paga"], ["cu", "CU"], ["auto", "Auto"], ["documenti", "Documenti"], ["report", "Report"]];
  h.push("<div class='segmenti fasc-schede'>");
  schede.forEach(function (s) {
    h.push("<button type='button' class='segmento" + (S.fTab === s[0] ? " attivo" : "") + "' onclick='schedaFascicolo(\"" + s[0] + "\")'>" + s[1] + "</button>");
  });
  h.push("</div>");
  if (S.fTab === "buste") h.push(S.fForm && S.fForm.tipo === "busta" ? formBusta() : (S.fForm && S.fForm.tipo === "vediBusta" ? dettaglioBusta() : vistaBuste()));
  if (S.fTab === "cu") h.push(S.fForm && S.fForm.tipo === "cu" ? formCU() : vistaCU());
  if (S.fTab === "auto") h.push(S.fForm && S.fForm.tipo === "veicolo" ? formVeicolo() : vistaAuto());
  if (S.fTab === "documenti") h.push(vistaDocumenti());
  if (S.fTab === "report") h.push(vistaReport());
  v.innerHTML = h.join("");
}

function schedaFascicolo(t) {
  S.fTab = t;
  S.fForm = null;
  renderFascicolo();
  window.scrollTo(0, 0);
}

function schermataBlocco() {
  var h = "<div class='collega'><h1>Area riservata</h1>";
  h += "<p class='aiuto'>Buste paga, CU e auto aziendale sono protetti dal PIN. L'area si blocca da sola dopo " + SESSIONE_MINUTI + " minuti di inattività e i dati non restano salvati sul dispositivo.</p>";
  if (!S.dati.haPin) {
    h += "<div class='avvertenza'>Per usare l'area riservata imposta prima il PIN in Impostazioni.</div>";
    h += "<button type='button' class='btn btn-primario' onclick='vai(\"impostazioni\")'>Vai alle Impostazioni</button></div>";
    return h;
  }
  h += "<div class='blocco'><div class='campo'><label for='a-pin'>PIN</label><input type='password' id='a-pin' class='campo-pin' inputmode='numeric' pattern='[0-9]*' maxlength='6' autocomplete='current-password' oninput='pinArea()'></div>";
  h += "<button type='button' class='btn btn-primario' onclick='sbloccaArea()'>Sblocca</button></div></div>";
  return h;
}

function pinArea() {
  var p = el("a-pin");
  p.value = p.value.replace(/[^0-9]/g, "").slice(0, 6);
  if (p.value.length === 6) sbloccaArea();
}

function sbloccaArea() {
  var p = el("a-pin");
  var pin = p ? p.value : "";
  if (!/^[0-9]{6}$/.test(pin)) { avviso("Il PIN è di 6 cifre.", true); return; }
  el("attesa").classList.remove("nascosto");
  api("sbloccaArea", [pin]).then(function (res) {
    el("attesa").classList.add("nascosto");
    S.sess = { chiave: res.sess, ultimo: Date.now() };
    renderFascicolo();
  }).catch(function (err) {
    el("attesa").classList.add("nascosto");
    if (p) { p.value = ""; p.focus(); }
    avviso(messaggioErrore(err), true);
  });
}

function caricaEco(dopo) {
  chiama("ecoDati", [], function (res) {
    S.eco = res;
    if (!S.fAnno) S.fAnno = S.dati.oggi.substr(0, 4);
    if (S.vista === "fascicolo") renderFascicolo();
    if (dopo) dopo();
  });
}

/* ---------------------------------------------------------
   CARICAMENTO FILE: trascinamento o pulsante
   --------------------------------------------------------- */
function zonaCaricamento(tipo, campiHtml) {
  var h = "<div class='blocco'>" + (campiHtml || "");
  h += "<div class='zona-carica' id='zona-" + tipo + "' ondragover='trascinaSopra(event,\"" + tipo + "\")' ondragleave='trascinaFuori(\"" + tipo + "\")' ondrop='rilascia(event,\"" + tipo + "\")'>";
  h += "<div class='zona-testo'>Trascina qui il file (PDF o immagine, massimo 15 MB)</div>";
  h += "<label class='btn btn-primario btn-piccolo'>+ Carica<input type='file' accept='application/pdf,image/*' class='nascosto' onchange='fileScelto(this,\"" + tipo + "\")'></label>";
  h += "</div></div>";
  return h;
}

function trascinaSopra(e, tipo) { e.preventDefault(); el("zona-" + tipo).classList.add("sopra"); }
function trascinaFuori(tipo) { var z = el("zona-" + tipo); if (z) z.classList.remove("sopra"); }
function rilascia(e, tipo) {
  e.preventDefault();
  trascinaFuori(tipo);
  var f = e.dataTransfer && e.dataTransfer.files ? e.dataTransfer.files[0] : null;
  if (f) caricaFile(f, tipo);
}
function fileScelto(input, tipo) {
  var f = input.files[0];
  input.value = "";
  if (f) caricaFile(f, tipo);
}

function metaCaricamento(tipo) {
  if (tipo === "BUSTA") return { tipo: "BUSTA", mese: valore("c-mese"), anno: valore("c-anno"), tipoBusta: valore("c-tipobusta") };
  if (tipo === "CU") return { tipo: "CU", anno: valore("c-annocu") };
  if (tipo === "AUTO") return { tipo: "AUTO", veicoloId: valore("c-veicolo"), categoria: valore("c-catauto"), titolo: valore("c-titauto") };
  return { tipo: "DOCUMENTO", categoria: valore("c-catdoc"), titolo: valore("c-titdoc"), anno: S.dati.oggi.substr(0, 4) };
}

function caricaFile(f, tipo) {
  if (f.size > 15 * 1024 * 1024) { avviso("Il file supera 15 MB.", true); return; }
  var meta = metaCaricamento(tipo);
  if (tipo === "AUTO" && meta.categoria !== "Altro" && !meta.titolo) meta.titolo = meta.categoria;
  var r = new FileReader();
  r.onload = function () {
    var base64 = String(r.result).split(",")[1];
    chiama("ecoCaricaDocumento", [meta, base64, f.type || "application/pdf", f.name], function (res) {
      S.eco.documenti = res.documenti;
      renderFascicolo();
      avviso("File salvato nel fascicolo: " + res.documento.nomeFile);
    });
  };
  r.readAsDataURL(f);
}

/* ---------------------------------------------------------
   BUSTE PAGA
   --------------------------------------------------------- */
var GRUPPI_BUSTA = [
  ["Periodo e ore", [["dataPagamento", "Data di pagamento", "date"], ["livello", "Livello / qualifica", "text"], ["oreOrdinarie", "Ore ordinarie", "num"], ["giorniLavorati", "Giorni lavorati", "num"]]],
  ["Totali", [["lordo", "Totale competenze (lordo)", "num"], ["totTrattenute", "Totale trattenute", "num"], ["arrotondamenti", "Arrotondamenti", "num"], ["rimborsoSpese", "Rimborsi spese (nota spese)", "num"], ["netto", "Netto in busta", "num"]]],
  ["Contributi e imposte", [["impPrev", "Imponibile previdenziale", "num"], ["inps", "Contributi INPS a tuo carico", "num"], ["impFiscale", "Imponibile fiscale", "num"], ["irpefLorda", "IRPEF lorda", "num"], ["detrazioni", "Detrazioni", "num"], ["irpefNetta", "IRPEF netta trattenuta", "num"], ["addReg", "Addizionale regionale", "num"], ["addCom", "Addizionale comunale", "num"], ["accontoAddCom", "Acconto addizionale comunale", "num"], ["trattIntegrativo", "Trattamento integrativo", "num"], ["fringe", "Fringe benefit auto", "num"]]],
  ["TFR e fondo pensione", [["tfrMese", "TFR maturato nel mese", "num"], ["tfrFondo", "TFR versato al fondo", "num"], ["fondoDip", "Contributo al fondo a tuo carico", "num"], ["fondoAzienda", "Contributo al fondo a carico azienda", "num"]]]
];
var RIGHE_ORE = [["ferie", "Ferie"], ["rol", "ROL"], ["exf", "Ex festività"]];
var COLONNE_ORE = [["AP", "Residuo precedente"], ["Mat", "Maturato"], ["God", "Goduto"], ["Res", "Residuo"]];

function busteAttive() { return (S.eco.buste || []).filter(function (b) { return b.stato === "ATTIVA"; }); }

function vistaBuste() {
  var anno = S.fAnno || S.dati.oggi.substr(0, 4);
  var o = dataDaIso(S.dati.oggi);
  var h = [];
  var campi = "<h3>Carica una busta paga</h3><div class='riga3'>";
  campi += "<div class='campo'><label for='c-mese'>Mese</label><select id='c-mese'>" + opzioni(MESI.map(function (m, i) { return [String(i + 1), maiusc(m)]; }), String(o.getMonth() === 0 ? 12 : o.getMonth())) + "</select></div>";
  campi += campoF("c-anno", "Anno", String(o.getMonth() === 0 ? o.getFullYear() - 1 : o.getFullYear()), "number");
  campi += "<div class='campo'><label for='c-tipobusta'>Tipo</label><select id='c-tipobusta'>" + opzioni(S.eco.liste.tipiBusta, "Mensile") + "</select></div></div>";
  h.push(zonaCaricamento("BUSTA", campi));
  var anni = {};
  anni[anno] = true;
  anni[S.dati.oggi.substr(0, 4)] = true;
  (S.eco.buste || []).forEach(function (b) { anni[b.anno] = true; });
  (S.eco.documenti || []).forEach(function (d) { if (d.tipo === "BUSTA") anni[d.anno] = true; });
  var listaAnni = Object.keys(anni).sort().reverse();
  h.push("<div class='sezione-titolo'><h2>Buste paga</h2><div class='azioni-riga'><select class='sel-piccolo' onchange='S.fAnno=this.value;renderFascicolo()'>" + opzioni(listaAnni, anno) + "</select><button type='button' class='btn btn-piccolo' onclick='nuovaBusta()'>+ Inserisci dati</button></div></div>");
  var periodi = {};
  (S.eco.documenti || []).filter(function (d) { return d.tipo === "BUSTA" && d.stato === "ATTIVO" && d.anno === anno; }).forEach(function (d) {
    var k = d.mese + "|" + d.categoria;
    periodi[k] = periodi[k] || { mese: d.mese, tipoBusta: d.categoria };
    periodi[k].doc = d;
  });
  busteAttive().filter(function (b) { return b.anno === anno; }).forEach(function (b) {
    var k = b.mese + "|" + b.tipoBusta;
    periodi[k] = periodi[k] || { mese: b.mese, tipoBusta: b.tipoBusta };
    periodi[k].busta = b;
  });
  var chiaviP = Object.keys(periodi).sort(function (a, b) { return Number(b.split("|")[0]) - Number(a.split("|")[0]); });
  if (!chiaviP.length) {
    h.push("<div class='vuoto'>Nessuna busta paga per il " + esc(anno) + ". Quando arriva la prima, caricala qui sopra e poi inserisci i dati.</div>");
  } else {
    h.push("<div class='lista'>");
    chiaviP.forEach(function (k) {
      var p = periodi[k];
      var b = p.busta;
      var titolo = maiusc(MESI[Number(p.mese) - 1]) + " " + anno + (p.tipoBusta !== "Mensile" ? " - " + p.tipoBusta : "");
      var stato = b ? "Netto " + euro(b.netto) : "Dati da inserire";
      var segnali = "";
      if (b && b.controllo && (Math.abs(b.controllo.diffFerie) > 0.01 || Math.abs(b.controllo.diffPerm) > 0.01)) segnali = "<span class='pill pill-attesa'>Differenze</span>";
      else if (b && b.controllo) segnali = "<span class='pill pill-ok'>Controllo ok</span>";
      h.push("<div class='voce voce-" + (b ? "ok" : "attesa") + "'><div class='voce-corpo'><div class='voce-titolo'>" + esc(titolo) + "</div><div class='voce-sub'>" + esc(stato) + (p.doc ? ", PDF presente" : ", PDF non caricato") + "</div></div>" + segnali + "<div class='azioni-riga'>");
      if (p.doc) h.push("<button type='button' class='btn btn-piccolo' onclick='apriDocumento(\"" + p.doc.id + "\")'>PDF</button>");
      if (b) h.push("<button type='button' class='btn btn-piccolo btn-primario' onclick='vediBusta(\"" + b.id + "\")'>Dati</button>");
      else h.push("<button type='button' class='btn btn-piccolo btn-primario' onclick='nuovaBusta(\"" + p.mese + "\",\"" + anno + "\",\"" + esc(p.tipoBusta) + "\")'>Inserisci dati</button>");
      h.push("</div></div>");
    });
    h.push("</div>");
  }
  var obs = (S.eco.buste || []).filter(function (b) { return b.stato !== "ATTIVA" && b.anno === anno; });
  if (obs.length) {
    h.push("<details style='margin-top:12px'><summary>Versioni precedenti e correzioni (" + obs.length + ")</summary><div class='lista'>");
    obs.forEach(function (b) { h.push("<div class='voce voce-chiusa'><div class='voce-corpo'><div class='voce-titolo'>" + esc(periodoBusta(b)) + "</div><div class='voce-sub'>Registrata il " + esc(dataBreve(b.creato)) + ", sostituita il " + esc(dataBreve(b.obsoleto)) + ". Netto " + euro(b.netto) + "</div></div><button type='button' class='btn btn-piccolo' onclick='vediBusta(\"" + b.id + "\")'>Vedi</button></div>"); });
    h.push("</div></details>");
  }
  return h.join("");
}

function nuovaBusta(mese, anno, tipoBusta) {
  var o = dataDaIso(S.dati.oggi);
  S.fForm = { tipo: "busta", dati: { mese: mese || String(o.getMonth() === 0 ? 12 : o.getMonth()), anno: anno || String(o.getMonth() === 0 ? o.getFullYear() - 1 : o.getFullYear()), tipoBusta: tipoBusta || "Mensile" }, precedente: "" };
  S.fVoci = [{}, {}, {}];
  renderFascicolo();
  window.scrollTo(0, 0);
}

function correggiBusta(id) {
  var b = (S.eco.buste || []).filter(function (x) { return x.id === id; })[0];
  if (!b) return;
  S.fForm = { tipo: "busta", dati: b, precedente: b.id };
  S.fVoci = (S.eco.voci || []).filter(function (v) { return v.bustaId === id; }).map(function (v) { return Object.assign({}, v); });
  if (!S.fVoci.length) S.fVoci = [{}];
  renderFascicolo();
  window.scrollTo(0, 0);
}

function formBusta() {
  var d = S.fForm.dati || {};
  var h = [];
  h.push("<div class='blocco'><h3>" + (S.fForm.precedente ? "Correggi la busta paga" : "Dati della busta paga") + "</h3>");
  h.push("<p class='aiuto'>Compila i campi che trovi in busta; quelli vuoti restano vuoti. " + (S.fForm.precedente ? "La versione attuale resta in archivio come obsoleta." : "Se la busta riporta i residui di ferie, ROL ed ex festività, il saldo stimato si allinea da solo.") + "</p>");
  h.push("<div class='riga3'><div class='campo'><label for='b-mese'>Mese</label><select id='b-mese'>" + opzioni(MESI.map(function (m, i) { return [String(i + 1), maiusc(m)]; }), String(d.mese)) + "</select></div>");
  h.push(campoF("b-anno", "Anno", d.anno, "number"));
  h.push("<div class='campo'><label for='b-tipoBusta'>Tipo</label><select id='b-tipoBusta'>" + opzioni(S.eco.liste.tipiBusta, d.tipoBusta || "Mensile") + "</select></div></div>");
  GRUPPI_BUSTA.forEach(function (g) {
    h.push("<div class='sezione-titolo'><h3>" + g[0] + "</h3></div><div class='griglia-campi'>");
    g[1].forEach(function (c) { h.push(campoF("b-" + c[0], c[1], d[c[0]], c[2])); });
    h.push("</div>");
  });
  h.push("<div class='sezione-titolo'><h3>Ferie e permessi (ore)</h3></div><div class='scorri'><table class='tab-ore'><tr><th></th>");
  COLONNE_ORE.forEach(function (c) { h.push("<th>" + c[1] + "</th>"); });
  h.push("</tr>");
  RIGHE_ORE.forEach(function (r) {
    h.push("<tr><th>" + r[1] + "</th>");
    COLONNE_ORE.forEach(function (c) { h.push("<td><input type='text' inputmode='decimal' id='b-" + r[0] + c[0] + "' value='" + esc(valoreInput(d[r[0] + c[0]])) + "'></td>"); });
    h.push("</tr>");
  });
  h.push("</table></div>");
  h.push("<div class='sezione-titolo'><h3>Voci della busta</h3><button type='button' class='btn btn-piccolo' onclick='aggiungiVoce()'>+ Riga</button></div>");
  h.push("<div class='scorri'><table class='tab-voci'><tr><th>Codice</th><th>Descrizione</th><th>Quantità / ore</th><th>Base</th><th>Competenze</th><th>Trattenute</th><th></th></tr>");
  S.fVoci.forEach(function (v, i) {
    h.push("<tr><td><input type='text' id='v-codice-" + i + "' value='" + esc(v.codice || "") + "'></td><td><input type='text' class='largo' id='v-descrizione-" + i + "' value='" + esc(v.descrizione || "") + "'></td>");
    ["quantita", "base", "competenze", "trattenute"].forEach(function (k) { h.push("<td><input type='text' inputmode='decimal' id='v-" + k + "-" + i + "' value='" + esc(valoreInput(v[k])) + "'></td>"); });
    h.push("<td><button type='button' class='btn btn-piccolo btn-testo' onclick='togliVoce(" + i + ")' aria-label='Togli la riga'>&times;</button></td></tr>");
  });
  h.push("</table></div>");
  h.push("<div class='campo' style='margin-top:12px'><label for='b-note'>Note</label><textarea id='b-note'>" + esc(d.note || "") + "</textarea></div>");
  h.push("<button type='button' class='btn btn-primario' onclick='salvaBusta()'>Salva la busta paga</button>");
  h.push("<button type='button' class='btn btn-testo' onclick='S.fForm=null;renderFascicolo()'>Annulla</button></div>");
  return h.join("");
}

function leggiVociForm() {
  return S.fVoci.map(function (v, i) {
    var o = {};
    ["codice", "descrizione", "quantita", "base", "competenze", "trattenute"].forEach(function (k) { var x = el("v-" + k + "-" + i); o[k] = x ? x.value : ""; });
    return o;
  });
}

function aggiungiVoce() { S.fVoci = leggiVociForm(); S.fVoci.push({}); S.fForm.dati = leggiBustaForm(); renderFascicolo(); }
function togliVoce(i) { S.fVoci = leggiVociForm(); S.fVoci.splice(i, 1); if (!S.fVoci.length) S.fVoci = [{}]; S.fForm.dati = leggiBustaForm(); renderFascicolo(); }

function leggiBustaForm() {
  var d = { mese: valore("b-mese"), anno: valore("b-anno"), tipoBusta: valore("b-tipoBusta"), note: el("b-note") ? el("b-note").value : "" };
  GRUPPI_BUSTA.forEach(function (g) { g[1].forEach(function (c) { d[c[0]] = valore("b-" + c[0]); }); });
  RIGHE_ORE.forEach(function (r) { COLONNE_ORE.forEach(function (c) { d[r[0] + c[0]] = valore("b-" + r[0] + c[0]); }); });
  if (S.fForm && S.fForm.dati && S.fForm.dati.documentoId) d.documentoId = S.fForm.dati.documentoId;
  return d;
}

function salvaBusta() {
  var d = leggiBustaForm();
  var voci = leggiVociForm();
  chiama("ecoSalvaBusta", [d, voci, S.fForm.precedente || ""], function (res) {
    var id = res.busta.id;
    caricaEco(function () {
      S.fForm = { tipo: "vediBusta", id: id };
      renderFascicolo();
      window.scrollTo(0, 0);
    });
    if (res.allineato) { aggiornaSaldo(); avviso("Busta salvata. Saldo di ferie e permessi allineato ai residui della busta"); }
    else avviso("Busta paga salvata");
  });
}

function vediBusta(id) {
  S.fForm = { tipo: "vediBusta", id: id };
  renderFascicolo();
  window.scrollTo(0, 0);
}

function dettaglioBusta() {
  var b = (S.eco.buste || []).filter(function (x) { return x.id === S.fForm.id; })[0];
  if (!b) return "<div class='vuoto'>Busta non trovata.</div>";
  var h = [];
  h.push("<button type='button' class='btn btn-testo btn-piccolo' onclick='S.fForm=null;renderFascicolo()'>&lsaquo; Torna alle buste</button>");
  h.push("<div class='blocco'><h3>Busta paga " + esc(periodoBusta(b)) + "</h3>");
  if (b.stato !== "ATTIVA") h.push("<div class='avvertenza'>Versione obsoleta: sostituita il " + esc(dataBreve(b.obsoleto)) + ". Resta in archivio come traccia.</div>");
  h.push("<div class='numeri'><div class='numero'><b>" + euro(b.netto) + "</b><span>netto</span></div><div class='numero'><b>" + euro(b.lordo) + "</b><span>lordo</span></div><div class='numero'><b>" + euro(b.irpefNetta) + "</b><span>IRPEF</span></div><div class='numero'><b>" + euro(b.inps) + "</b><span>INPS</span></div></div>");
  if (b.controllo) {
    var c = b.controllo;
    var ok = Math.abs(c.diffFerie) < 0.01 && Math.abs(c.diffPerm) < 0.01;
    h.push("<div class='" + (ok ? "anteprima" : "avvertenza") + "' style='margin-top:12px'>" + (ok ? "Le ore godute in busta coincidono con il rapportino." : "Differenze con il rapportino del mese: ferie " + numIt(c.ferieBusta) + " h in busta contro " + numIt(c.ferieApp) + " h registrate; permessi " + numIt(c.permBusta) + " h contro " + numIt(c.permApp) + " h. Verifica con l'amministrazione.") + "</div>");
  }
  GRUPPI_BUSTA.forEach(function (g) {
    var righe = g[1].filter(function (x) { return b[x[0]] !== ""; });
    if (!righe.length) return;
    h.push("<div class='sezione-titolo'><h3>" + g[0] + "</h3></div><div class='dettagli'>");
    righe.forEach(function (x) { h.push("<div><span>" + esc(x[1]) + "</span><span>" + (x[2] === "num" ? (x[0] === "oreOrdinarie" || x[0] === "giorniLavorati" ? numIt(b[x[0]]) : euro(b[x[0]])) : esc(x[2] === "date" ? dataBreve(b[x[0]]) : b[x[0]])) + "</span></div>"); });
    h.push("</div>");
  });
  var haOre = RIGHE_ORE.some(function (r) { return COLONNE_ORE.some(function (c) { return b[r[0] + c[0]] !== ""; }); });
  if (haOre) {
    h.push("<div class='sezione-titolo'><h3>Ferie e permessi (ore)</h3></div><div class='scorri'><table class='tab-ore sola'><tr><th></th>");
    COLONNE_ORE.forEach(function (c) { h.push("<th>" + c[1] + "</th>"); });
    h.push("</tr>");
    RIGHE_ORE.forEach(function (r) { h.push("<tr><th>" + r[1] + "</th>"); COLONNE_ORE.forEach(function (c) { h.push("<td>" + numIt(b[r[0] + c[0]]) + "</td>"); }); h.push("</tr>"); });
    h.push("</table></div>");
  }
  var voci = (S.eco.voci || []).filter(function (v) { return v.bustaId === b.id; });
  if (voci.length) {
    h.push("<div class='sezione-titolo'><h3>Voci</h3></div><div class='scorri'><table class='tab-voci sola'><tr><th>Codice</th><th>Descrizione</th><th>Quantità</th><th>Base</th><th>Competenze</th><th>Trattenute</th></tr>");
    voci.forEach(function (v) { h.push("<tr><td>" + esc(v.codice) + "</td><td>" + esc(v.descrizione) + "</td><td>" + numIt(v.quantita) + "</td><td>" + numIt(v.base, 4) + "</td><td>" + (v.competenze !== "" ? euro(v.competenze) : "") + "</td><td>" + (v.trattenute !== "" ? euro(v.trattenute) : "") + "</td></tr>"); });
    h.push("</table></div>");
  }
  if (b.note) h.push("<p class='aiuto' style='margin-top:10px'>Note: " + esc(b.note) + "</p>");
  h.push("<div class='azioni-riga' style='margin-top:12px'>");
  if (b.documentoId && docDaId(b.documentoId)) h.push("<button type='button' class='btn btn-piccolo' onclick='apriDocumento(\"" + b.documentoId + "\")'>Apri il PDF</button>");
  if (b.stato === "ATTIVA") h.push("<button type='button' class='btn btn-piccolo btn-primario' onclick='correggiBusta(\"" + b.id + "\")'>Correggi i dati</button>");
  h.push("</div></div>");
  return h.join("");
}

/* ---------------------------------------------------------
   CU
   --------------------------------------------------------- */
var CAMPI_CU = [["datore", "Datore di lavoro", "text"], ["giorni", "Giorni di lavoro dipendente", "num"], ["reddito", "Reddito di lavoro dipendente", "num"], ["ritenute", "Ritenute IRPEF", "num"],
  ["addReg", "Addizionale regionale trattenuta", "num"], ["addComSaldo", "Addizionale comunale, saldo", "num"], ["addComAcconto", "Addizionale comunale, acconto", "num"],
  ["trattIntegrativo", "Trattamento integrativo erogato", "num"], ["fondoPensione", "Contributi di previdenza complementare", "num"], ["fringe", "Fringe benefit", "num"]];

function vistaCU() {
  var h = [];
  var annoDef = String(Number(S.dati.oggi.substr(0, 4)) - 1);
  h.push(zonaCaricamento("CU", "<h3>Carica una CU</h3>" + campoF("c-annocu", "Anno dei redditi", annoDef, "number")));
  h.push("<div class='sezione-titolo'><h2>Certificazioni Uniche</h2><button type='button' class='btn btn-piccolo' onclick='nuovaCU()'>+ Inserisci dati</button></div>");
  var anni = {};
  (S.eco.documenti || []).filter(function (d) { return d.tipo === "CU" && d.stato === "ATTIVO"; }).forEach(function (d) { anni[d.anno] = anni[d.anno] || {}; anni[d.anno].doc = d; });
  (S.eco.cu || []).filter(function (c) { return c.stato === "ATTIVA"; }).forEach(function (c) { anni[c.anno] = anni[c.anno] || {}; anni[c.anno].cu = c; });
  var k = Object.keys(anni).sort().reverse();
  if (!k.length) h.push("<div class='vuoto'>Nessuna CU. La prima con i redditi Pre System sarà quella del 2026, che arriva entro marzo 2027.</div>");
  k.forEach(function (a) {
    var x = anni[a];
    h.push("<div class='blocco'><div class='sezione-titolo' style='margin-top:0'><h3>CU " + esc(a) + "</h3><div class='azioni-riga'>");
    if (x.doc) h.push("<button type='button' class='btn btn-piccolo' onclick='apriDocumento(\"" + x.doc.id + "\")'>PDF</button>");
    h.push("<button type='button' class='btn btn-piccolo btn-primario' onclick='nuovaCU(\"" + a + "\")'>" + (x.cu ? "Correggi i dati" : "Inserisci dati") + "</button></div></div>");
    if (x.cu) {
      h.push("<div class='dettagli'>");
      CAMPI_CU.forEach(function (c) { if (x.cu[c[0]] !== "") h.push("<div><span>" + esc(c[1]) + "</span><span>" + (c[2] === "num" ? (c[0] === "giorni" ? numIt(x.cu[c[0]], 0) : euro(x.cu[c[0]])) : esc(x.cu[c[0]])) + "</span></div>"); });
      h.push("</div>");
      var co = x.cu.coerenza;
      if (co && co.righe) {
        h.push("<div class='sezione-titolo'><h3>Confronto con le " + co.buste + " buste paga dell'anno</h3></div><div class='scorri'><table class='tab-voci sola'><tr><th>Voce</th><th>CU</th><th>Somma buste</th><th>Differenza</th></tr>");
        co.righe.forEach(function (r) { h.push("<tr><td>" + esc(r.voce) + "</td><td>" + euro(r.cu) + "</td><td>" + euro(r.buste) + "</td><td class='" + (Math.abs(r.diff) > 1 ? "negativo" : "") + "'>" + euro(r.diff) + "</td></tr>"); });
        h.push("</table></div><p class='aiuto'>Piccole differenze sono normali (conguagli di dicembre, arrotondamenti). Differenze grandi vanno chiarite con l'amministrazione prima del 730.</p>");
      } else if (co) {
        h.push("<p class='aiuto'>Nessuna busta paga registrata per il " + esc(a) + ": il confronto non è disponibile.</p>");
      }
    } else {
      h.push("<p class='aiuto'>Dati non ancora inseriti.</p>");
    }
    h.push("</div>");
  });
  return h.join("");
}

function nuovaCU(anno) {
  var esistente = (S.eco.cu || []).filter(function (c) { return c.stato === "ATTIVA" && c.anno === anno; })[0];
  S.fForm = { tipo: "cu", dati: esistente || { anno: anno || String(Number(S.dati.oggi.substr(0, 4)) - 1), datore: S.dati.impostazioni.AZIENDA }, precedente: esistente ? esistente.id : "" };
  renderFascicolo();
  window.scrollTo(0, 0);
}

function formCU() {
  var d = S.fForm.dati;
  var h = ["<div class='blocco'><h3>Dati della CU</h3><p class='aiuto'>Riporta gli importi dalla Certificazione Unica. Se correggi una CU già inserita, la versione precedente resta in archivio come obsoleta.</p>"];
  h.push(campoF("u-anno", "Anno dei redditi", d.anno, "number"));
  h.push("<div class='griglia-campi'>");
  CAMPI_CU.forEach(function (c) { h.push(campoF("u-" + c[0], c[1], d[c[0]], c[2])); });
  h.push("</div><div class='campo'><label for='u-note'>Note</label><textarea id='u-note'>" + esc(d.note || "") + "</textarea></div>");
  h.push("<button type='button' class='btn btn-primario' onclick='salvaCU()'>Salva la CU</button><button type='button' class='btn btn-testo' onclick='S.fForm=null;renderFascicolo()'>Annulla</button></div>");
  return h.join("");
}

function salvaCU() {
  var d = { anno: valore("u-anno"), note: el("u-note").value };
  CAMPI_CU.forEach(function (c) { d[c[0]] = valore("u-" + c[0]); });
  chiama("ecoSalvaCU", [d, S.fForm.precedente || ""], function () {
    S.fForm = null;
    caricaEco();
    avviso("CU salvata");
  });
}

/* ---------------------------------------------------------
   AUTO AZIENDALE
   --------------------------------------------------------- */
var NOMI_ALIM = { ELETTRICA: "Elettrica", PLUGIN: "Ibrida plug-in", ALTRO: "Benzina, diesel, GPL, metano o ibrida non ricaricabile" };

function vistaAuto() {
  var h = [];
  var attivo = (S.eco.veicoli || []).filter(function (v) { return v.stato === "ATTIVO"; })[0];
  var obsoleti = (S.eco.veicoli || []).filter(function (v) { return v.stato !== "ATTIVO"; }).sort(function (a, b) { return a.concessione < b.concessione ? 1 : -1; });
  if (!attivo) {
    h.push("<div class='blocco'><h3>Nessuna auto aziendale in uso</h3><p class='aiuto'>Inserisci i dati del libretto per calcolare il fringe benefit e gestire scadenze e documenti.</p><button type='button' class='btn btn-primario' onclick='formAuto()'>+ Aggiungi l'auto aziendale</button></div>");
  } else {
    h.push(schedaVeicolo(attivo, true));
  }
  if (obsoleti.length) {
    h.push("<div class='sezione-titolo'><h2>Auto precedenti</h2></div>");
    obsoleti.forEach(function (v) {
      h.push("<details class='blocco'><summary><b>" + esc(v.marca + " " + v.modello) + "</b> " + esc(v.targa) + ", dal " + esc(dataBreve(v.concessione)) + " al " + esc(v.restituzione ? dataBreve(v.restituzione) : "-") + "</summary>" + schedaVeicolo(v, false) + "</details>");
    });
  }
  return h.join("");
}

function schedaVeicolo(v, attivo) {
  var h = [];
  var annoCorr = Number(S.dati.oggi.substr(0, 4));
  h.push(attivo ? "<div class='blocco'>" : "<div>");
  h.push("<div class='sezione-titolo' style='margin-top:0'><h3>" + esc(v.marca + " " + v.modello + (v.versione ? " " + v.versione : "")) + "</h3><span class='pill " + (attivo ? "pill-ok" : "pill-chiusa") + "'>" + (attivo ? "In uso" : "Restituita") + "</span></div>");
  h.push("<div class='dettagli'>");
  h.push("<div><span>Targa</span><span>" + esc(v.targa || "-") + "</span></div>");
  h.push("<div><span>Alimentazione</span><span>" + esc(NOMI_ALIM[v.alimentazione] || v.alimentazione) + "</span></div>");
  if (v.co2) h.push("<div><span>CO2</span><span>" + esc(v.co2) + " g/km</span></div>");
  h.push("<div><span>Prima immatricolazione</span><span>" + esc(dataBreve(v.immatricolazione)) + "</span></div>");
  h.push("<div><span>Assegnata dal</span><span>" + esc(dataBreve(v.concessione)) + (v.restituzione ? " al " + esc(dataBreve(v.restituzione)) : "") + "</span></div>");
  if (v.contributoAnnuo) h.push("<div><span>Tuo contributo annuo</span><span>" + euro(v.contributoAnnuo) + "</span></div>");
  h.push("</div>");
  if (attivo) {
    h.push("<div class='azioni-riga' style='margin:10px 0 4px 0'><button type='button' class='btn btn-piccolo' onclick='formAuto(\"" + v.id + "\")'>Modifica i dati</button><button type='button' class='btn btn-piccolo' onclick='formAuto()'>Cambia auto</button><button type='button' class='btn btn-piccolo btn-pericolo' onclick='apriRestituzione(\"" + v.id + "\")'>Restituisci</button></div>");
  }

  /* Fringe benefit */
  var fr = (S.eco.fringe || []).filter(function (f) { return f.veicoloId === v.id; }).sort(function (a, b) { return b.anno - a.anno; });
  h.push("<div class='sezione-titolo'><h3>Fringe benefit</h3></div>");
  fr.forEach(function (f) {
    var annoInCorso = f.anno === annoCorr;
    h.push("<details class='fringe'" + (annoInCorso ? " open" : "") + "><summary><b>" + f.anno + "</b>: " + (f.mancaCosto ? "manca il costo ACI" : "atteso " + euro(f.atteso) + " per " + f.giorni + " giorni") + "</summary>");
    h.push("<div class='dettagli'>");
    h.push("<div><span>Regime</span><span>" + esc(f.regime) + ", " + Math.round(f.perc * 100) + "%</span></div>");
    h.push("<div><span>Costo km ACI " + f.anno + "</span><span>" + (f.costoKm ? numIt(f.costoKm, 4) + " €/km" : "-") + "</span></div>");
    if (!f.mancaCosto) {
      h.push("<div><span>Valore base (15.000 km)</span><span>" + euro(f.base) + "</span></div>");
      if (f.maggAnzianita) h.push("<div><span>Maggiorazione anzianità +50%</span><span>sì</span></div>");
      if (f.maggOptional) h.push("<div><span>Maggiorazione optional +5%</span><span>sì</span></div>");
      h.push("<div><span>Annuo intero</span><span>" + euro(f.annuoPieno) + "</span></div>");
    }
    h.push("</div>");
    {
      h.push("<div class='riga2'>" + campoF("aci-" + v.id + "-" + f.anno, "Costo km ACI " + f.anno + " (euro/km)", f.costoKm ? String(f.costoKm) : "", "num") + "<div class='campo'><label>&nbsp;</label><button type='button' class='btn' onclick='salvaACI(\"" + v.id + "\"," + f.anno + ")'>Salva costo</button></div></div>");
    }
    if (!f.mancaCosto) {
      h.push("<div class='scorri'><table class='tab-voci sola'><tr><th>Mese</th><th>Giorni</th><th>Atteso</th><th>In busta</th><th>Differenza</th></tr>");
      f.mesi.forEach(function (m) {
        if (!m.giorni) return;
        var diff = Math.round((m.busta - m.atteso) * 100) / 100;
        var conBusta = busteAttive().some(function (b) { return b.anno === String(f.anno) && b.mese === String(m.mese); });
        h.push("<tr><td>" + maiusc(MESI_BREVI[m.mese - 1]) + "</td><td>" + m.giorni + "</td><td>" + euro(m.atteso) + "</td><td>" + (conBusta ? euro(m.busta) : "-") + "</td><td class='" + (conBusta && Math.abs(diff) > 1 ? "negativo" : "") + "'>" + (conBusta ? euro(diff) : "-") + "</td></tr>");
      });
      h.push("</table></div>");
    }
    h.push("</details>");
  });
  h.push("<p class='aiuto'>Il costo chilometrico si trova nelle tabelle ACI dell'anno (sito ACI, sezione fringe benefit, per marca, modello e versione). Le tabelle escono a dicembre per l'anno successivo. Calcolo secondo l'art. 51 del TUIR aggiornato al D.Lgs. 148/2026; il dato ufficiale è quello in busta paga.</p>");

  /* Scadenze */
  var sc = (S.eco.scadenze || []).filter(function (s) { return s.veicoloId === v.id; }).sort(function (a, b) { return a.data < b.data ? -1 : 1; });
  var aperte = sc.filter(function (s) { return s.stato === "APERTA"; });
  var fatte = sc.filter(function (s) { return s.stato !== "APERTA"; });
  h.push("<div class='sezione-titolo'><h3>Scadenze</h3>" + (attivo ? "<button type='button' class='btn btn-piccolo' onclick='apriScadenza(\"" + v.id + "\")'>+ Scadenza</button>" : "") + "</div>");
  if (!aperte.length) h.push("<div class='vuoto'>Nessuna scadenza aperta.</div>");
  aperte.forEach(function (s) {
    var scaduta = s.data < S.dati.oggi;
    h.push("<div class='dest'><div class='dest-corpo'><div class='dest-nome" + (scaduta ? " negativo" : "") + "'>" + esc(s.tipo) + ", " + esc(dataBreve(s.data)) + (scaduta ? " (scaduta)" : "") + "</div><div class='dest-mail'>" + esc(s.descrizione || "") + "</div></div>" + (attivo ? "<button type='button' class='btn btn-piccolo' onclick='scadenzaFatta(\"" + s.id + "\")'>Fatta</button>" : "") + "</div>");
  });
  if (fatte.length) {
    h.push("<details><summary>Scadenze completate (" + fatte.length + ")</summary>");
    fatte.forEach(function (s) { h.push("<div class='dest dest-obs'><div class='dest-corpo'><div class='dest-nome'>" + esc(s.tipo) + ", " + esc(dataBreve(s.data)) + "</div><div class='dest-mail'>Fatta il " + esc(dataBreve(s.fattaIl)) + (s.descrizione ? ". " + esc(s.descrizione) : "") + "</div></div></div>"); });
    h.push("</details>");
  }

  /* Multe e sinistri */
  var ev = (S.eco.eventiAuto || []).filter(function (e) { return e.veicoloId === v.id; }).sort(function (a, b) { return a.data < b.data ? 1 : -1; });
  h.push("<div class='sezione-titolo'><h3>Multe e sinistri</h3>" + (attivo ? "<button type='button' class='btn btn-piccolo' onclick='apriEventoAuto(\"" + v.id + "\")'>+ Registra</button>" : "") + "</div>");
  if (!ev.length) h.push("<div class='vuoto'>Nessuna registrazione.</div>");
  ev.forEach(function (e) { h.push("<div class='dest'><div class='dest-corpo'><div class='dest-nome'>" + esc(e.tipo) + ", " + esc(dataBreve(e.data)) + (e.importo ? ", " + euro(e.importo) : "") + "</div><div class='dest-mail'>" + esc(e.descrizione) + (e.stato ? " (" + esc(e.stato) + ")" : "") + "</div></div></div>"); });

  /* Documenti dell'auto */
  var docs = (S.eco.documenti || []).filter(function (d) { return d.tipo === "AUTO" && d.veicoloId === v.id; });
  h.push("<div class='sezione-titolo'><h3>Documenti dell'auto</h3></div>");
  if (attivo) {
    var campi = "<div class='riga2'><div class='campo'><label for='c-catauto'>Tipo di documento</label><select id='c-catauto'>" + opzioni(S.eco.liste.categorieAuto, "Libretto") + "</select></div>" + campoF("c-titauto", "Titolo (facoltativo)", "", "text") + "</div><input type='hidden' id='c-veicolo' value='" + esc(v.id) + "'>";
    h.push(zonaCaricamento("AUTO", campi));
  }
  if (!docs.length) h.push("<div class='vuoto'>Nessun documento.</div>");
  docs.forEach(function (d) { h.push(rigaDocumento(d)); });
  h.push("</div>");
  return h.join("");
}

function formAuto(id) {
  S.fForm = { tipo: "veicolo", id: id || "" };
  renderFascicolo();
  window.scrollTo(0, 0);
}

function formVeicolo() {
  var v = S.fForm.id ? veicoloDaId(S.fForm.id) : {};
  var attivo = (S.eco.veicoli || []).filter(function (x) { return x.stato === "ATTIVO"; })[0];
  var h = ["<div class='blocco'><h3>" + (S.fForm.id ? "Modifica i dati dell'auto" : (attivo ? "Nuova auto aziendale" : "Auto aziendale")) + "</h3>"];
  if (!S.fForm.id && attivo) h.push("<div class='avvertenza'>L'auto attuale (" + esc(attivo.marca + " " + attivo.modello + " " + attivo.targa) + ") diventerà obsoleta con restituzione il giorno prima della nuova assegnazione. Tutti i suoi dati restano in archivio.</div>");
  h.push("<p class='aiuto'>Tra parentesi il campo del libretto di circolazione in cui trovi il dato.</p><div class='griglia-campi'>");
  h.push(campoF("ve-marca", "Marca (D.1)", v.marca, "text"));
  h.push(campoF("ve-modello", "Modello, denominazione commerciale (D.3)", v.modello, "text"));
  h.push(campoF("ve-versione", "Versione (D.2), utile per le tabelle ACI", v.versione, "text"));
  h.push(campoF("ve-targa", "Targa (A)", v.targa, "text"));
  h.push("<div class='campo'><label for='ve-alimentazione'>Alimentazione (P.3)</label><select id='ve-alimentazione'>" + opzioni([["ALTRO", NOMI_ALIM.ALTRO], ["PLUGIN", NOMI_ALIM.PLUGIN], ["ELETTRICA", NOMI_ALIM.ELETTRICA]], v.alimentazione || "ALTRO") + "</select></div>");
  h.push(campoF("ve-co2", "Emissioni CO2 g/km (V.7)", v.co2, "num"));
  h.push(campoF("ve-immatricolazione", "Prima immatricolazione (B)", v.immatricolazione, "date"));
  h.push(campoF("ve-concessione", "Data di assegnazione a te", v.concessione, "date"));
  h.push(campoF("ve-contributoAnnuo", "Contributo annuo trattenuto in busta (se c'è)", v.contributoAnnuo, "num"));
  h.push("</div>");
  h.push("<label class='spunta'><input type='checkbox' id='ve-ordinata2024'" + (v.ordinata2024 === "SI" ? " checked" : "") + "> Ordinata dall'azienda entro il 31/12/2024 (chiedilo all'amministrazione se l'assegnazione è del 2025)</label>");
  h.push("<label class='spunta'><input type='checkbox' id='ve-optional'" + (v.optional === "SI" ? " checked" : "") + "> Ha optional o allestimenti non compresi nelle tabelle ACI</label>");
  h.push("<div class='campo'><label for='ve-note'>Note</label><textarea id='ve-note'>" + esc(v.note || "") + "</textarea></div>");
  h.push("<button type='button' class='btn btn-primario' onclick='salvaVeicolo()'>Salva</button><button type='button' class='btn btn-testo' onclick='S.fForm=null;renderFascicolo()'>Annulla</button></div>");
  return h.join("");
}

function salvaVeicolo() {
  var d = { id: S.fForm.id || "" };
  ["marca", "modello", "versione", "targa", "alimentazione", "co2", "immatricolazione", "concessione", "contributoAnnuo"].forEach(function (k) { d[k] = valore("ve-" + k); });
  d.ordinata2024 = el("ve-ordinata2024").checked;
  d.optional = el("ve-optional").checked;
  d.note = el("ve-note").value;
  chiama("ecoSalvaVeicolo", [d], function () {
    S.fForm = null;
    caricaEco();
    avviso("Dati dell'auto salvati");
  });
}

function apriRestituzione(id) {
  var h = "<h2>Restituzione dell'auto</h2><div class='sottotitolo'>L'auto diventa obsoleta: dati, fringe, scadenze e documenti restano in archivio.</div>";
  h += campoTesto("rs-data", "Data di restituzione", S.dati.oggi, "date");
  h += "<button type='button' class='btn btn-pericolo' onclick='confermaRestituzione(\"" + id + "\")'>Conferma</button><button type='button' class='btn btn-testo' onclick='chiudiFoglio()'>Annulla</button>";
  apriFoglio(h);
}

function confermaRestituzione(id) {
  chiama("ecoRestituisciVeicolo", [id, valore("rs-data")], function () { chiudiFoglio(); caricaEco(); avviso("Auto restituita e archiviata"); });
}

function salvaACI(veicoloId, anno) {
  var v = valore("aci-" + veicoloId + "-" + anno);
  chiama("ecoSalvaCostoACI", [veicoloId, anno, v, ""], function () { caricaEco(); avviso("Costo ACI " + anno + " salvato"); });
}

function apriScadenza(veicoloId) {
  var h = "<h2>Nuova scadenza</h2><div class='sottotitolo'>Compare anche nel calendario Lavoro Pre System, con avviso una settimana prima e il giorno prima.</div>";
  h += "<div class='campo'><label for='sc-tipo'>Tipo</label><select id='sc-tipo'>" + opzioni(S.eco.liste.tipiScadenza, "Tagliando") + "</select></div>";
  h += campoTesto("sc-data", "Data", "", "date") + campoTesto("sc-descr", "Descrizione (facoltativa)", "", "text");
  h += "<button type='button' class='btn btn-primario' onclick='salvaScadenza(\"" + veicoloId + "\")'>Salva</button><button type='button' class='btn btn-testo' onclick='chiudiFoglio()'>Annulla</button>";
  apriFoglio(h);
}

function salvaScadenza(veicoloId) {
  chiama("ecoSalvaScadenza", [{ veicoloId: veicoloId, tipo: valore("sc-tipo"), data: valore("sc-data"), descrizione: valore("sc-descr") }], function () { chiudiFoglio(); caricaEco(); avviso("Scadenza salvata"); });
}

function scadenzaFatta(id) {
  chiama("ecoScadenzaFatta", [id, S.dati.oggi], function () { caricaEco(); avviso("Scadenza segnata come fatta"); });
}

function apriEventoAuto(veicoloId) {
  var h = "<h2>Multa, sinistro o danno</h2><div class='sottotitolo'>Registrazione per l'auto in uso.</div>";
  h += "<div class='campo'><label for='ea-tipo'>Tipo</label><select id='ea-tipo'>" + opzioni(["Multa", "Sinistro", "Danno", "Altro"], "Multa") + "</select></div>";
  h += campoTesto("ea-data", "Data", S.dati.oggi, "date") + campoTesto("ea-descr", "Descrizione", "", "text");
  h += "<div class='riga2'>" + campoF("ea-importo", "Importo (facoltativo)", "", "num") + "<div class='campo'><label for='ea-stato'>Stato</label><select id='ea-stato'>" + opzioni(["Aperto", "Pagato", "Chiuso"], "Aperto") + "</select></div></div>";
  h += "<button type='button' class='btn btn-primario' onclick='salvaEventoAuto(\"" + veicoloId + "\")'>Salva</button><button type='button' class='btn btn-testo' onclick='chiudiFoglio()'>Annulla</button>";
  apriFoglio(h);
}

function salvaEventoAuto(veicoloId) {
  chiama("ecoSalvaEventoAuto", [{ veicoloId: veicoloId, tipo: valore("ea-tipo"), data: valore("ea-data"), descrizione: valore("ea-descr"), importo: valore("ea-importo"), stato: valore("ea-stato") }], function () { chiudiFoglio(); caricaEco(); avviso("Registrazione salvata"); });
}

/* ---------------------------------------------------------
   DOCUMENTI
   --------------------------------------------------------- */
var NOMI_TIPO_DOC = { BUSTA: "Busta paga", CU: "CU", DOCUMENTO: "Documento", AUTO: "Auto" };

function rigaDocumento(d) {
  var att = d.stato === "ATTIVO";
  var sub = NOMI_TIPO_DOC[d.tipo] + (d.categoria && d.tipo !== "CU" ? ", " + d.categoria : "") + ", caricato il " + dataBreve(d.caricato) + (att ? "" : ", obsoleto dal " + dataBreve(d.obsoleto));
  return "<div class='dest" + (att ? "" : " dest-obs") + "'><div class='dest-corpo'><div class='dest-nome'>" + esc(d.titolo || d.nomeFile) + "</div><div class='dest-mail'>" + esc(sub) + "</div></div><div class='azioni-riga'><button type='button' class='btn btn-piccolo' onclick='apriDocumento(\"" + d.id + "\")'>Apri</button><button type='button' class='btn btn-piccolo" + (att ? " btn-pericolo" : "") + "' onclick='statoDocumento(\"" + d.id + "\",\"" + (att ? "OBSOLETO" : "ATTIVO") + "\")'>" + (att ? "Obsoleto" : "Riattiva") + "</button></div></div>";
}

function vistaDocumenti() {
  var h = [];
  var campi = "<h3>Carica un documento</h3><div class='riga2'><div class='campo'><label for='c-catdoc'>Categoria</label><select id='c-catdoc'>" + opzioni(S.eco.liste.categorieDoc, "Contratto e assunzione") + "</select></div>" + campoF("c-titdoc", "Titolo", "", "text") + "</div>";
  h.push(zonaCaricamento("DOCUMENTO", campi));
  h.push("<p class='aiuto'>Buste paga, CU e documenti dell'auto si caricano dalle rispettive schede; qui li trovi tutti insieme.</p>");
  var anni = {};
  (S.eco.documenti || []).forEach(function (d) { if (d.anno) anni[d.anno] = true; });
  h.push("<div class='riga3'><div class='campo'><label for='fd-tipo'>Tipo</label><select id='fd-tipo' onchange='S.fDoc.tipo=this.value;renderFascicolo()'>" + opzioni([["TUTTI", "Tutti"], ["BUSTA", "Buste paga"], ["CU", "CU"], ["DOCUMENTO", "Documenti"], ["AUTO", "Auto"]], S.fDoc.tipo) + "</select></div>");
  h.push("<div class='campo'><label for='fd-anno'>Anno</label><select id='fd-anno' onchange='S.fDoc.anno=this.value;renderFascicolo()'>" + opzioni([["TUTTI", "Tutti"]].concat(Object.keys(anni).sort().reverse()), S.fDoc.anno) + "</select></div>");
  h.push("<div class='campo'><label for='fd-stato'>Stato</label><select id='fd-stato' onchange='S.fDoc.stato=this.value;renderFascicolo()'>" + opzioni([["ATTIVO", "Attivi"], ["OBSOLETO", "Obsoleti"], ["TUTTI", "Tutti"]], S.fDoc.stato) + "</select></div></div>");
  var lista = (S.eco.documenti || []).filter(function (d) {
    return (S.fDoc.tipo === "TUTTI" || d.tipo === S.fDoc.tipo) && (S.fDoc.anno === "TUTTI" || d.anno === S.fDoc.anno) && (S.fDoc.stato === "TUTTI" || d.stato === S.fDoc.stato);
  }).sort(function (a, b) { return a.caricato < b.caricato ? 1 : -1; });
  if (!lista.length) h.push("<div class='vuoto'>Nessun documento con questi filtri.</div>");
  else h.push("<div class='blocco'>" + lista.map(rigaDocumento).join("") + "</div>");
  return h.join("");
}

function statoDocumento(id, stato) {
  chiama("ecoStatoDocumento", [id, stato, ""], function (lista) {
    S.eco.documenti = lista;
    renderFascicolo();
    avviso(stato === "OBSOLETO" ? "Documento reso obsoleto (resta in archivio)" : "Documento riattivato");
  });
}

/* ---------------------------------------------------------
   REPORT E ESPORTAZIONE
   --------------------------------------------------------- */
var COLONNE_REPORT = [["lordo", "Lordo"], ["inps", "INPS"], ["impFiscale", "Imp. fiscale"], ["irpefNetta", "IRPEF"], ["addReg", "Add. reg."], ["addCom", "Add. com."], ["fringe", "Fringe"], ["tfrMese", "TFR"], ["netto", "Netto"]];

function vistaReport() {
  var annoC = S.dati.oggi.substr(0, 4);
  if (!S.fFiltri) S.fFiltri = { da: annoC + "-01", a: annoC + "-12", tipo: "TUTTE", voce: "" };
  var f = S.fFiltri;
  var h = [];
  h.push("<div class='blocco'><h3>Filtri</h3><div class='riga3'>");
  h.push("<div class='campo'><label for='rf-da'>Dal mese</label><input type='month' id='rf-da' value='" + esc(f.da) + "' onchange='S.fFiltri.da=this.value;renderFascicolo()'></div>");
  h.push("<div class='campo'><label for='rf-a'>Al mese</label><input type='month' id='rf-a' value='" + esc(f.a) + "' onchange='S.fFiltri.a=this.value;renderFascicolo()'></div>");
  h.push("<div class='campo'><label for='rf-tipo'>Buste</label><select id='rf-tipo' onchange='S.fFiltri.tipo=this.value;renderFascicolo()'>" + opzioni([["TUTTE", "Tutte"], ["Mensile", "Solo mensili"], ["Tredicesima", "Solo tredicesime"]], f.tipo) + "</select></div></div></div>");
  var buste = busteFiltrate();
  h.push("<div class='sezione-titolo'><h2>Riepilogo buste paga</h2><button type='button' class='btn btn-piccolo' onclick='esportaRiepilogo()'>Esporta in Excel</button></div>");
  if (!buste.length) {
    h.push("<div class='vuoto'>Nessuna busta paga nel periodo scelto.</div>");
  } else {
    var tot = {};
    h.push("<div class='scorri'><table class='tab-voci sola'><tr><th>Periodo</th>");
    COLONNE_REPORT.forEach(function (c) { h.push("<th>" + c[1] + "</th>"); });
    h.push("</tr>");
    buste.forEach(function (b) {
      h.push("<tr><td>" + esc(maiusc(MESI_BREVI[Number(b.mese) - 1]) + " " + b.anno + (b.tipoBusta !== "Mensile" ? " (" + b.tipoBusta + ")" : "")) + "</td>");
      COLONNE_REPORT.forEach(function (c) { tot[c[0]] = (tot[c[0]] || 0) + nv(b[c[0]]); h.push("<td>" + (b[c[0]] !== "" ? numIt(b[c[0]]) : "") + "</td>"); });
      h.push("</tr>");
    });
    h.push("<tr class='totale'><td>Totale</td>");
    COLONNE_REPORT.forEach(function (c) { h.push("<td>" + numIt(tot[c[0]] || 0) + "</td>"); });
    h.push("</tr></table></div>");
    var maxN = Math.max.apply(null, buste.map(function (b) { return nv(b.netto); }).concat([1]));
    h.push("<div class='barre'>");
    buste.forEach(function (b) { h.push("<div class='barra-riga'><span>" + esc(maiusc(MESI_BREVI[Number(b.mese) - 1]) + " " + b.anno.substr(2)) + "</span><div class='barra'><i style='width:" + Math.round(nv(b.netto) / maxN * 100) + "%'></i></div><b>" + euro(b.netto) + "</b></div>"); });
    h.push("</div>");
  }
  /* Rimborsi: note spese dei pasti e rimborsi arrivati in busta */
  h.push(tabellaRimborsi());

  /* Analisi di una singola voce */
  var ids = {};
  buste.forEach(function (b) { ids[b.id] = b; });
  var voci = (S.eco.voci || []).filter(function (v) { return ids[v.bustaId]; });
  var nomi = {};
  voci.forEach(function (v) { var k = (v.codice ? v.codice + " " : "") + v.descrizione; nomi[k] = true; });
  h.push("<div class='sezione-titolo'><h2>Analisi di una voce</h2></div>");
  if (!voci.length) {
    h.push("<div class='vuoto'>Le voci compaiono quando inserisci le righe delle buste paga.</div>");
  } else {
    h.push("<div class='campo'><label for='rf-voce'>Voce</label><select id='rf-voce' onchange='S.fFiltri.voce=this.value;renderFascicolo()'>" + opzioni([["", "Scegli una voce"]].concat(Object.keys(nomi).sort()), f.voce) + "</select></div>");
    if (f.voce) {
      var sel = voci.filter(function (v) { return (v.codice ? v.codice + " " : "") + v.descrizione === f.voce; });
      var tq = 0, tc = 0, tt = 0;
      h.push("<div class='scorri'><table class='tab-voci sola'><tr><th>Periodo</th><th>Quantità</th><th>Competenze</th><th>Trattenute</th></tr>");
      sel.forEach(function (v) {
        var b = ids[v.bustaId];
        tq += nv(v.quantita); tc += nv(v.competenze); tt += nv(v.trattenute);
        h.push("<tr><td>" + esc(maiusc(MESI_BREVI[Number(b.mese) - 1]) + " " + b.anno) + "</td><td>" + numIt(v.quantita) + "</td><td>" + (v.competenze !== "" ? euro(v.competenze) : "") + "</td><td>" + (v.trattenute !== "" ? euro(v.trattenute) : "") + "</td></tr>");
      });
      h.push("<tr class='totale'><td>Totale</td><td>" + numIt(tq) + "</td><td>" + euro(tc) + "</td><td>" + euro(tt) + "</td></tr></table></div>");
      h.push("<button type='button' class='btn btn-piccolo' onclick='esportaVoce()'>Esporta la voce in Excel</button>");
    }
  }
  return h.join("");
}

function busteFiltrate() {
  var f = S.fFiltri;
  return busteAttive().filter(function (b) {
    var k = b.anno + "-" + pad2(Number(b.mese));
    return k >= f.da && k <= f.a && (f.tipo === "TUTTE" || b.tipoBusta === f.tipo);
  }).sort(function (a, b) { var ka = a.anno + pad2(Number(a.mese)) + a.tipoBusta, kb = b.anno + pad2(Number(b.mese)) + b.tipoBusta; return ka < kb ? -1 : 1; });
}

function esportaRiepilogo() {
  var buste = busteFiltrate();
  if (!buste.length) { avviso("Nessuna busta da esportare.", true); return; }
  var campi = [["anno", "Anno"], ["mese", "Mese"], ["tipoBusta", "Tipo"], ["dataPagamento", "Data pagamento"]];
  GRUPPI_BUSTA.forEach(function (g) { g[1].forEach(function (c) { if (c[0] !== "dataPagamento") campi.push(c); }); });
  RIGHE_ORE.forEach(function (r) { COLONNE_ORE.forEach(function (c) { campi.push([r[0] + c[0], r[1] + " " + c[1].toLowerCase()]); }); });
  var righe = [campi.map(function (c) { return c[1]; })];
  buste.forEach(function (b) {
    righe.push(campi.map(function (c) { var v = b[c[0]]; return v !== "" && !isNaN(Number(v)) && c[0] !== "anno" && c[0] !== "mese" ? Number(v) : v; }));
  });
  scaricaCsv("Buste paga " + S.fFiltri.da + " - " + S.fFiltri.a + ".csv", righe);
}

function esportaVoce() {
  var ids = {};
  busteFiltrate().forEach(function (b) { ids[b.id] = b; });
  var righe = [["Anno", "Mese", "Codice", "Descrizione", "Quantità", "Base", "Competenze", "Trattenute"]];
  (S.eco.voci || []).filter(function (v) { return ids[v.bustaId] && (v.codice ? v.codice + " " : "") + v.descrizione === S.fFiltri.voce; }).forEach(function (v) {
    var b = ids[v.bustaId];
    righe.push([b.anno, b.mese, v.codice, v.descrizione, nv(v.quantita), nv(v.base), nv(v.competenze), nv(v.trattenute)]);
  });
  scaricaCsv("Voce " + S.fFiltri.voce.replace(/[^A-Za-z0-9 ]/g, "") + ".csv", righe);
}

/* Note spese (pasti fuori) per mese e rimborsi registrati nelle buste paga.
   Il rimborso arriva di solito nella busta del mese successivo. */
function tabellaRimborsi() {
  var mesi = {};
  (S.dati.pasti || []).filter(function (p) { return p.stato === "ATTIVO" && p.tipo === "FUORI"; }).forEach(function (p) {
    var k = p.data.substr(0, 7);
    mesi[k] = mesi[k] || { speso: 0, rimborso: 0 };
    mesi[k].speso += nv(p.importo);
  });
  busteAttive().forEach(function (b) {
    if (b.rimborsoSpese === "" || b.rimborsoSpese === undefined) return;
    var d = new Date(Number(b.anno), Number(b.mese) - 2, 1);
    var k = d.getFullYear() + "-" + pad2(d.getMonth() + 1);
    mesi[k] = mesi[k] || { speso: 0, rimborso: 0 };
    mesi[k].rimborso += nv(b.rimborsoSpese);
  });
  var chiaviM = Object.keys(mesi).sort().reverse();
  var h = "<div class='sezione-titolo'><h2>Note spese e rimborsi</h2></div>";
  if (!chiaviM.length) return h + "<div class='vuoto'>Nessun pasto fuori registrato.</div>";
  h += "<div class='scorri'><table class='tab-voci sola'><tr><th>Mese della spesa</th><th>Speso</th><th>Rimborsato in busta (mese dopo)</th><th>Da ricevere</th></tr>";
  var totS = 0, totR = 0;
  chiaviM.forEach(function (k) {
    var m = mesi[k];
    totS += m.speso; totR += m.rimborso;
    var diff = Math.round((m.speso - m.rimborso) * 100) / 100;
    h += "<tr><td>" + esc(maiusc(MESI[Number(k.substr(5, 2)) - 1]) + " " + k.substr(0, 4)) + "</td><td>" + euro(m.speso) + "</td><td>" + euro(m.rimborso) + "</td><td class='" + (diff > 0.01 ? "negativo" : "") + "'>" + euro(diff) + "</td></tr>";
  });
  h += "<tr class='totale'><td>Totale</td><td>" + euro(totS) + "</td><td>" + euro(totR) + "</td><td>" + euro(Math.round((totS - totR) * 100) / 100) + "</td></tr></table></div>";
  h += "<p class='aiuto'>Il rimborso si inserisce nella scheda della busta paga, campo Rimborsi spese. Se il tetto per pasto è attivo, la differenza può restare a tuo carico.</p>";
  return h;
}
