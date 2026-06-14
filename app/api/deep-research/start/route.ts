import { NextRequest, NextResponse } from "next/server";
import { buildDeepResearchPrompt } from "@/lib/research";

// Just kicks off the background interaction and returns its id — completes in a few seconds.
export const maxDuration = 30;

const INTERACTIONS_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";
const AGENT = "deep-research-preview-04-2026"; // Standard variant (~$2/task)

export async function POST(req: NextRequest) {
  try {
    const geminiKey = process.env.GEMINI_API_KEY?.trim();
    if (!geminiKey) throw new Error("GEMINI_API_KEY non configurata sul server.");

    const { area, country, region } = await req.json();
    if (!area?.trim() || !country?.trim()) {
      return NextResponse.json(
        { error: "I campi 'area' e 'country' sono obbligatori." },
        { status: 400 },
      );
    }

    const res = await fetch(INTERACTIONS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": geminiKey,
        "Api-Revision": "2026-05-20",
      },
      body: JSON.stringify({
        input: buildDeepResearchPrompt(area.trim(), country.trim(), region?.trim() ?? ""),
        agent: AGENT,
        background: true, // mandatory for Deep Research
        store: true,      // required when background=true
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`Avvio Deep Research fallito (${res.status}): ${detail.slice(0, 300)}`);
    }

    const data = await res.json();
    const interactionId = data.id;
    if (!interactionId) throw new Error("La Interactions API non ha restituito un id.");

    return NextResponse.json({ interactionId });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Errore interno del server.";
    console.error("[deep-research/start]", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
