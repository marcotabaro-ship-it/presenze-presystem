# Lavoro Pre System

App personale (PWA) per registrare ferie, permessi, malattia e lavoro in giorni non lavorativi,
preparare le mail in Outlook e generare il rapportino mensile delle presenze.

- App: https://marcotabaro-ship-it.github.io/presenze-presystem/
- Motore dati: Google Apps Script collegato al foglio "Presenze Pre System"
  (calendario "Lavoro Pre System", rapportini nella cartella Drive "Rapportini Presenze Pre System")

## File del repository
- index.html, style.css, app.js, fascicolo.js: interfaccia
- manifest.webmanifest, sw.js, icons/: installazione come app e funzionamento offline

Il codice Apps Script NON va in questo repository pubblico: contiene indirizzi email dei colleghi.

## Nuova versione
1. Modifica i file e aumenta VERSIONE in app.js, CACHE in sw.js e ?v= in index.html con lo stesso numero.
2. Commit su main: GitHub Pages pubblica in circa un minuto.
3. Sui dispositivi la nuova versione arriva alla prima apertura con rete.
