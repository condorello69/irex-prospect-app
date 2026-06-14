import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { buildResearchPrompt, parseCompanies, countPriorities, createSheet } from "@/lib/research";

// Vercel: allow up to 60s (Hobby plan max)
export const maxDuration = 60;

// ── Gemini research (fast, synchronous) ──────────────────────────────────────────
async function researchCompanies(
  area: string,
  country: string,
  region: string,
): Promise<Record<string, string>[]> {
  const geminiKey = process.env.GEMINI_API_KEY?.trim();
  if (!geminiKey) throw new Error("GEMINI_API_KEY non configurata sul server.");
  const genAI = new GoogleGenerativeAI(geminiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

  const result = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: buildResearchPrompt(area, country, region) }] }],
    // Enable Google Search grounding so Gemini can look up real companies
    tools: [{ googleSearch: {} }] as any,
  });

  return parseCompanies(result.response.text());
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

    return NextResponse.json({ url, total: companies.length, counts: countPriorities(companies) });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Errore interno del server.";
    console.error("[generate]", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
