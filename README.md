# IREX Prospect Generator

Web app che genera automaticamente una lista di prospect irrigazione per qualsiasi area europea, salvandola direttamente su Google Sheets.

**Come funziona:**
1. L'utente inserisce paese, città e regione (opzionale)
2. Sceglie la **modalità ricerca**:
   - **Veloce** — Gemini 2.0 Flash (con Google Search). ~30 s, pochi centesimi.
   - **Deep Research** — agente `deep-research-preview-04-2026` che naviga molte fonti e verifica i dati. ~20 min, ~$2 a ricerca. Più aziende e dati più completi.
3. Le aziende trovate vengono scritte su un Google Sheet formattato nel tuo Google Drive

---

## Modalità Deep Research

Usa la **Interactions API** di Gemini (`/v1beta/interactions`), asincrona:

1. `POST /api/deep-research/start` avvia l'agente in background (`background:true, store:true`) e ritorna un `interactionId`
2. Il frontend fa polling su `POST /api/deep-research/status` ogni 10 s
3. A `completed`, l'endpoint legge il report (in `steps[model_output].content[].text`, **non** in `output_text`) e fa un **secondo passaggio con `gemini-2.5-flash`** che estrae le aziende nel JSON strutturato → genera lo Sheet

> **Perché due stadi:** l'agente Deep Research produce un report narrativo e ignora le istruzioni "rispondi solo in JSON". Quindi si lascia ricercare liberamente e poi un modello Flash (che segue le istruzioni JSON in modo affidabile) estrae i dati strutturati dal report. Stadio 2 costa pochi centesimi.
> Per annullare e fermare la fatturazione: `DELETE /api/deep-research/status?interactionId=...` (la Interactions API non ha un metodo `:cancel`).

Nessuna funzione serverless resta aperta per minuti → compatibile con Vercel Hobby (60 s).
La logica condivisa (prompt, parsing, creazione Sheet) vive in [`lib/research.ts`](lib/research.ts).

> ⚠️ La Interactions API è in **preview**. Le richieste fissano l'header `Api-Revision: 2026-05-20`. Il default è la variante **Standard** (~$2); per la massima esaustività si può passare a `deep-research-max-preview-04-2026` (~$5) in [`app/api/deep-research/start/route.ts`](app/api/deep-research/start/route.ts).

---

## Variabili d'ambiente necessarie

| Variabile | Dove trovarla |
|-----------|--------------|
| `GEMINI_API_KEY` | [Google AI Studio](https://aistudio.google.com/app/apikey) → Create API key |
| `GOOGLE_CLIENT_ID` | campo `client_id` in `credentials.json` del progetto Mapping Germany |
| `GOOGLE_CLIENT_SECRET` | campo `client_secret` in `credentials.json` |
| `GOOGLE_REFRESH_TOKEN` | campo `refresh_token` in `token.json` del progetto Mapping Germany |

---

## Setup locale

```bash
# 1. Installa dipendenze
npm install

# 2. Il file .env.local è già compilato (se clonato dal repo originale)
#    Altrimenti copia il template:
cp .env.local.example .env.local
# e compila i 4 valori

# 3. Avvia in locale
npm run dev
# → http://localhost:3000
```

---

## Deploy su Vercel

### Prima volta

```bash
npm install -g vercel
vercel login
vercel
```

Quando Vercel chiede le impostazioni, accetta i default (Next.js rilevato automaticamente).

### Aggiungi le variabili d'ambiente su Vercel

Nel dashboard Vercel → progetto → **Settings → Environment Variables**, aggiungi:

| Key | Value |
|-----|-------|
| `GEMINI_API_KEY` | `AIzaSy...` |
| `GOOGLE_CLIENT_ID` | `802642...` |
| `GOOGLE_CLIENT_SECRET` | `GOCSPX-...` |
| `GOOGLE_REFRESH_TOKEN` | `1//03...` |

Oppure via CLI:
```bash
vercel env add GEMINI_API_KEY
vercel env add GOOGLE_CLIENT_ID
vercel env add GOOGLE_CLIENT_SECRET
vercel env add GOOGLE_REFRESH_TOKEN
```

### Rideploya con le variabili

```bash
vercel --prod
```

Vercel assegna un URL tipo `https://irex-prospect-app.vercel.app` — condividibile con chiunque.

---

## Aggiornamenti futuri

Per modificare il codice e ridistribuire:
```bash
# (dopo aver modificato i file)
vercel --prod
```

Se hai collegato un repo GitHub, ogni push su `main` fa il deploy automaticamente.

---

## Note tecniche

- **Auth Google**: usa OAuth2 con refresh token (stesso account del progetto Mapping Germany). I Google Sheet vengono creati nel tuo Drive e condivisi pubblicamente in sola lettura.
- **Timeout**: 60s (max Vercel Hobby). La modalità Veloce impiega tipicamente 15-40s; la Deep Research gira in background (~20 min) e il frontend fa polling.
- **Modelli AI** (centralizzati in [`lib/research.ts`](lib/research.ts)): `gemini-2.5-flash-lite` con Google Search Grounding per la modalità **Veloce** (`FAST_MODEL`, scelto per stare sotto i 60s di Vercel Hobby) · `gemini-2.5-flash` per l'estrazione stadio 2 di Deep Research (`FLASH_MODEL`) · `deep-research-preview-04-2026` via Interactions API. Nota: `gemini-2.0-flash` è stato ritirato dall'API (404).
- **Refresh token**: non scade mai (a meno che non revochi l'accesso manualmente da Google Account → Sicurezza → App con accesso).
