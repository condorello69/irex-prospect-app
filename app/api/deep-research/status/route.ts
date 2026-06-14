import { NextRequest, NextResponse } from "next/server";
import { extractReportText, extractCompaniesFromReport, countPriorities, createSheet } from "@/lib/research";

// Polled by the client. A single poll is fast; building the Sheet on completion
// stays well within the 60s Hobby limit.
export const maxDuration = 60;

const INTERACTIONS_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";

export async function POST(req: NextRequest) {
  try {
    const geminiKey = process.env.GEMINI_API_KEY?.trim();
    if (!geminiKey) throw new Error("GEMINI_API_KEY non configurata sul server.");

    const { interactionId, area, country } = await req.json();
    if (!interactionId) {
      return NextResponse.json({ error: "interactionId mancante." }, { status: 400 });
    }

    const res = await fetch(`${INTERACTIONS_URL}/${interactionId}`, {
      headers: { "x-goog-api-key": geminiKey, "Api-Revision": "2026-05-20" },
    });
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`Lettura stato fallita (${res.status}): ${detail.slice(0, 300)}`);
    }

    const data = await res.json();
    const status: string = data.status;

    if (status === "failed") {
      return NextResponse.json(
        { status: "failed", error: data.error ?? "Deep Research ha riportato un errore." },
        { status: 200 },
      );
    }

    if (status !== "completed") {
      // in_progress (or queued) — tell the client to keep polling
      return NextResponse.json({ status: "in_progress" });
    }

    // Completed → the report lives in steps[model_output].content[].text.
    // Stage 2: extract structured rows from the narrative report, then build the Sheet.
    const report = extractReportText(data);
    if (!report.trim()) {
      return NextResponse.json(
        { status: "failed", error: "Deep Research non ha prodotto un report leggibile. Riprova." },
        { status: 200 },
      );
    }

    const companies = await extractCompaniesFromReport(report);
    if (companies.length === 0) {
      return NextResponse.json(
        { status: "failed", error: "Nessuna azienda estratta dal report. Riprova." },
        { status: 200 },
      );
    }

    const url = await createSheet(
      (area ?? "").trim() || "Ricerca",
      (country ?? "").trim(),
      companies,
    );

    return NextResponse.json({
      status: "completed",
      url,
      total: companies.length,
      counts: countPriorities(companies),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Errore interno del server.";
    console.error("[deep-research/status]", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// Cancel a running interaction so it stops billing. The Interactions API has no
// ":cancel" method, but DELETE on the resource removes (and halts) it.
export async function DELETE(req: NextRequest) {
  try {
    const geminiKey = process.env.GEMINI_API_KEY?.trim();
    if (!geminiKey) throw new Error("GEMINI_API_KEY non configurata sul server.");

    const { searchParams } = new URL(req.url);
    const interactionId = searchParams.get("interactionId");
    if (!interactionId) {
      return NextResponse.json({ error: "interactionId mancante." }, { status: 400 });
    }

    await fetch(`${INTERACTIONS_URL}/${interactionId}`, {
      method: "DELETE",
      headers: { "x-goog-api-key": geminiKey, "Api-Revision": "2026-05-20" },
    });

    return NextResponse.json({ cancelled: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Errore interno del server.";
    console.error("[deep-research/status DELETE]", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
