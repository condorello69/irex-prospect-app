// Shared research logic: prompt, JSON parsing, Google Sheet creation.
// Used by both the fast sync flow (gemini-2.0-flash) and the async Deep Research flow.
import { google } from "googleapis";
import { GoogleGenerativeAI } from "@google/generative-ai";

// ── Constants ──────────────────────────────────────────────────────────────────
// Fast model for the sync flow and for Deep Research extraction.
// (gemini-2.0-flash was retired — 404 "no longer available".)
export const FLASH_MODEL = "gemini-2.5-flash";

export const HEADERS = [
  "Nome Azienda", "Città", "Indirizzo", "Telefono", "Email", "Sito Web",
  "Tipo", "Marchi Concorrenti Usati", "Servizi Offerti", "Mercato Target",
  "Priorità", "Note Commerciali", "Nome Contatto", "Stato",
];

const PRIORITY_COLORS: Record<string, { red: number; green: number; blue: number }> = {
  ALTA:  { red: 0.776, green: 0.937, blue: 0.808 },
  MEDIA: { red: 1.0,   green: 0.953, blue: 0.702 },
  BASSA: { red: 1.0,   green: 0.780, blue: 0.788 },
};

const HEADER_BG   = { red: 0.122, green: 0.286, blue: 0.490 };
const HEADER_TEXT = { red: 1.0,   green: 1.0,   blue: 1.0   };
const COL_WIDTHS  = [220, 140, 230, 140, 230, 200, 160, 280, 320, 220, 80, 400, 140, 120];

// ── Prompt ───────────────────────────────────────────────────────────────────
export function buildResearchPrompt(area: string, country: string, region: string): string {
  return `You are a B2B sales research assistant for IREX (Scarabelli Group), an Italian irrigation equipment manufacturer.

Search the web and find 15-20 REAL companies in ${area}, ${country}${region ? ` (${region})` : ""} that operate in the irrigation industry.

Types to find:
- Irrigation dealers, distributors, and installers
- Landscape contractors offering irrigation services (GaLaBau in DE, paysagistes in FR, paesaggisti in IT, jardineros in ES, hoveniers in NL)
- Specialized irrigation retailers (Fachhandel)
- Agricultural irrigation companies and cooperatives
- Online B2B irrigation platforms
- Irrigation or landscaping industry associations (useful as gateway contacts)

COMPETITOR BRANDS — if a company uses any of these, set Priorità to ALTA:
Netafim, Rivulis, Irritec, Hunter, Rain Bird, Toro, Perrot, Grundfos, DAB, Espa, Caprari, Bauer, Naan, Galcon, K-Rain, Eurodrip, Idrofoglia, Wilo, Pedrollo

Priority rules:
- ALTA  → company openly uses declared competitor brands
- MEDIA → irrigation installer/dealer without declared brands; landscape contractor with irrigation services; cooperatives; e-commerce
- BASSA → plumber/SHK with irrigation as secondary service; maintenance-only landscapers; associations

Return ONLY valid JSON — no markdown, no explanation, nothing else:
{
  "companies": [
    {
      "Nome Azienda": "full company name",
      "Città": "city",
      "Indirizzo": "street, postal code, city (empty string if unknown)",
      "Telefono": "+XX ... (empty string if unknown)",
      "Email": "email address (empty string if unknown)",
      "Sito Web": "website domain without https (empty string if unknown)",
      "Tipo": "Dealer / GaLaBau / Paesaggista / Fachhandel / SHK / E-commerce / Produttore / Associazione / Cooperativa",
      "Marchi Concorrenti Usati": "Brand1, Brand2 (empty string if unknown)",
      "Servizi Offerti": "brief description of services relevant to IREX",
      "Mercato Target": "Residenziale / Agricoltura / Sport / Verde pubblico / B2B",
      "Priorità": "ALTA or MEDIA or BASSA",
      "Note Commerciali": "useful commercial notes in Italian for the IREX sales team",
      "Nome Contatto": "contact person name (empty string if unknown)",
      "Stato": "Da contattare"
    }
  ]
}`;
}

// Deep Research agents produce a narrative report (they ignore "return only JSON"
// instructions). So we let the agent research freely, then extract structured data
// from its report with a cheap gemini-2.0-flash pass (see extractCompaniesFromReport).
export function buildDeepResearchPrompt(area: string, country: string, region: string): string {
  return `You are a B2B sales research analyst for IREX (Scarabelli Group), an Italian irrigation equipment manufacturer.

Research the irrigation industry in ${area}, ${country}${region ? ` (${region})` : ""} and identify AT LEAST 15-20 REAL, NAMED companies that could buy or distribute irrigation products.

Include for EACH company, wherever your research can verify it: full company name, city, full address, phone, email, website, the type of business (dealer, distributor, installer, GaLaBau/landscaper, specialized retailer, agricultural cooperative, e-commerce, association), which competitor irrigation brands they sell or use (Netafim, Rivulis, Irritec, Hunter, Rain Bird, Toro, Perrot, Grundfos, DAB, Espa, Caprari, Bauer, Naan, Galcon, K-Rain, Eurodrip, Idrofoglia, Wilo, Pedrollo), the services they offer, and their target market.

Present the companies clearly (a markdown table of named companies with their details is ideal), so each company and its contact data is unambiguous. Prioritise depth and verified contact details over prose.`;
}

// Deep Research returns its report inside steps[type=model_output].content[].text,
// NOT in a top-level "output_text" field (the simplified docs are misleading).
export function extractReportText(interaction: any): string {
  const steps: any[] = interaction?.steps ?? [];
  const parts: string[] = [];
  for (const s of steps) {
    if (s?.type !== "model_output") continue;
    for (const c of s?.content ?? []) {
      if (typeof c?.text === "string") parts.push(c.text);
    }
  }
  return parts.join("\n\n");
}

// Stage 2: turn the narrative Deep Research report into structured rows with a cheap
// gemini-2.0-flash pass. A normal model reliably honours the "return only JSON" instruction.
export async function extractCompaniesFromReport(report: string): Promise<Record<string, string>[]> {
  const geminiKey = process.env.GEMINI_API_KEY?.trim();
  if (!geminiKey) throw new Error("GEMINI_API_KEY non configurata sul server.");
  const genAI = new GoogleGenerativeAI(geminiKey);
  const model = genAI.getGenerativeModel({ model: FLASH_MODEL });

  const prompt = `Extract EVERY named company from the irrigation market report below into structured data for the IREX sales team.

Priority rules:
- ALTA  → company openly uses/sells declared competitor brands (Netafim, Rivulis, Irritec, Hunter, Rain Bird, Toro, Perrot, Grundfos, DAB, Espa, Caprari, Bauer, Naan, Galcon, K-Rain, Eurodrip, Idrofoglia, Wilo, Pedrollo)
- MEDIA → irrigation installer/dealer without declared brands; landscape contractor with irrigation services; cooperatives; e-commerce
- BASSA → plumber/SHK with irrigation as secondary service; maintenance-only landscapers; associations

Return ONLY valid JSON — no markdown, no explanation:
{
  "companies": [
    {
      "Nome Azienda": "", "Città": "", "Indirizzo": "", "Telefono": "", "Email": "",
      "Sito Web": "", "Tipo": "Dealer / GaLaBau / Paesaggista / Fachhandel / SHK / E-commerce / Produttore / Associazione / Cooperativa",
      "Marchi Concorrenti Usati": "", "Servizi Offerti": "", "Mercato Target": "Residenziale / Agricoltura / Sport / Verde pubblico / B2B",
      "Priorità": "ALTA or MEDIA or BASSA", "Note Commerciali": "useful notes in Italian for the IREX sales team",
      "Nome Contatto": "", "Stato": "Da contattare"
    }
  ]
}
Use empty strings for unknown fields. Include every distinct company mentioned in the report.

REPORT:
${report}`;

  const result = await model.generateContent(prompt);
  return parseCompanies(result.response.text());
}

// ── Parsing ──────────────────────────────────────────────────────────────────
export function parseCompanies(text: string): Record<string, string>[] {
  // Strip markdown code fences if present
  const cleaned = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  // Grab the LAST JSON object containing a "companies" array (Deep Research appends it at the end)
  const matches = cleaned.match(/\{[\s\S]*?"companies"[\s\S]*\}/g);
  const candidate = matches ? matches[matches.length - 1] : cleaned.match(/\{[\s\S]*\}/)?.[0];
  if (!candidate) throw new Error("Nessun JSON valido nel risultato. Riprova.");

  const parsed = JSON.parse(candidate);
  const companies: Record<string, string>[] = parsed.companies ?? [];

  // Normalize: ensure every header is present
  return companies.map((c) => {
    const row: Record<string, string> = {};
    for (const h of HEADERS) row[h] = String(c[h] ?? "");
    row["Stato"] = row["Stato"] || "Da contattare";
    return row;
  });
}

export function countPriorities(companies: Record<string, string>[]) {
  const counts = { ALTA: 0, MEDIA: 0, BASSA: 0 };
  companies.forEach((c) => {
    const p = c["Priorità"] as keyof typeof counts;
    if (p in counts) counts[p]++;
  });
  return counts;
}

// ── Google Sheets creation ─────────────────────────────────────────────────────
export async function createSheet(
  area: string,
  country: string,
  companies: Record<string, string>[],
): Promise<string> {
  const clientId     = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN?.trim();
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Credenziali Google OAuth non configurate sul server.");
  }
  const auth = new google.auth.OAuth2(clientId, clientSecret);
  auth.setCredentials({ refresh_token: refreshToken });

  const sheets = google.sheets({ version: "v4", auth });
  const drive  = google.drive({ version: "v3", auth });

  const sheetTitle = country
    ? `IREX Prospect ${country} – ${area}`
    : `IREX Prospect ${area}`;

  // Create spreadsheet
  const created = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title: sheetTitle },
      sheets: [{ properties: { title: "Prospect", sheetId: 0 } }],
    },
  });
  const spreadsheetId = created.data.spreadsheetId!;
  const sheetId = 0;
  const nCols = HEADERS.length;

  // Write data rows
  const rows = [
    HEADERS,
    ...companies.map((c) => HEADERS.map((h) => c[h] ?? "")),
  ];
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: "Prospect!A1",
    valueInputOption: "RAW",
    requestBody: { values: rows },
  });

  // Build formatting requests
  const requests: object[] = [];

  // Header row style
  requests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: nCols },
      cell: {
        userEnteredFormat: {
          backgroundColor: HEADER_BG,
          textFormat: { bold: true, foregroundColor: HEADER_TEXT, fontSize: 10 },
          horizontalAlignment: "CENTER",
          verticalAlignment: "MIDDLE",
          wrapStrategy: "WRAP",
        },
      },
      fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)",
    },
  });

  // Priority colors for data rows
  companies.forEach((company, idx) => {
    const color = PRIORITY_COLORS[company["Priorità"]];
    if (!color) return;
    requests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: idx + 1, endRowIndex: idx + 2, startColumnIndex: 0, endColumnIndex: nCols },
        cell: {
          userEnteredFormat: {
            backgroundColor: color,
            verticalAlignment: "TOP",
            wrapStrategy: "WRAP",
          },
        },
        fields: "userEnteredFormat(backgroundColor,verticalAlignment,wrapStrategy)",
      },
    });
  });

  // Freeze header row
  requests.push({
    updateSheetProperties: {
      properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
      fields: "gridProperties.frozenRowCount",
    },
  });

  // Column widths
  COL_WIDTHS.forEach((width, colIdx) => {
    requests.push({
      updateDimensionProperties: {
        range: { sheetId, dimension: "COLUMNS", startIndex: colIdx, endIndex: colIdx + 1 },
        properties: { pixelSize: width },
        fields: "pixelSize",
      },
    });
  });

  // Row heights for data
  requests.push({
    updateDimensionProperties: {
      range: { sheetId, dimension: "ROWS", startIndex: 1, endIndex: companies.length + 1 },
      properties: { pixelSize: 90 },
      fields: "pixelSize",
    },
  });

  // Auto-filter
  requests.push({
    setBasicFilter: {
      filter: {
        range: { sheetId, startRowIndex: 0, endRowIndex: companies.length + 1, startColumnIndex: 0, endColumnIndex: nCols },
      },
    },
  });

  await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });

  // Share publicly (anyone with link can view)
  await drive.permissions.create({
    fileId: spreadsheetId,
    requestBody: { type: "anyone", role: "reader" },
  });

  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;
}
