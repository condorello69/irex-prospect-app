import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { google } from "googleapis";

// Vercel: allow up to 60s (Hobby plan max)
export const maxDuration = 60;

// ── Constants ──────────────────────────────────────────────────────────────────
const HEADERS = [
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


// ── Gemini research ────────────────────────────────────────────────────────────
async function researchCompanies(
  area: string,
  country: string,
  region: string,
): Promise<Record<string, string>[]> {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

  const prompt = `You are a B2B sales research assistant for IREX (Scarabelli Group), an Italian irrigation equipment manufacturer.

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

  const result = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    // Enable Google Search grounding so Gemini can look up real companies
    tools: [{ googleSearch: {} }] as any,
  });

  const text = result.response.text();

  // Extract JSON — strip markdown code fences if present
  const cleaned = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Gemini non ha restituito JSON valido. Riprova.");

  const parsed = JSON.parse(jsonMatch[0]);
  const companies: Record<string, string>[] = parsed.companies ?? [];

  // Normalize: ensure every header is present
  return companies.map((c) => {
    const row: Record<string, string> = {};
    for (const h of HEADERS) row[h] = String(c[h] ?? "");
    row["Stato"] = row["Stato"] || "Da contattare";
    return row;
  });
}


// ── Google Sheets creation ─────────────────────────────────────────────────────
async function createSheet(
  area: string,
  country: string,
  companies: Record<string, string>[],
): Promise<string> {
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
  );
  auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });

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


// ── Route handler ──────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const { area, country, region } = await req.json();

    if (!area?.trim() || !country?.trim()) {
      return NextResponse.json(
        { error: "I campi 'area' e 'country' sono obbligatori." },
        { status: 400 },
      );
    }

    const companies = await researchCompanies(area.trim(), country.trim(), region?.trim() ?? "");

    if (companies.length === 0) {
      return NextResponse.json(
        { error: "Nessuna azienda trovata. Prova con un'area diversa." },
        { status: 422 },
      );
    }

    const url = await createSheet(area.trim(), country.trim(), companies);

    const counts = { ALTA: 0, MEDIA: 0, BASSA: 0 };
    companies.forEach((c) => {
      const p = c["Priorità"] as keyof typeof counts;
      if (p in counts) counts[p]++;
    });

    return NextResponse.json({ url, total: companies.length, counts });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Errore interno del server.";
    console.error("[generate]", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
