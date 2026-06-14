"use client";

import { useRef, useState } from "react";

type Result = {
  url: string;
  total: number;
  counts: { ALTA: number; MEDIA: number; BASSA: number };
};

type Mode = "fast" | "deep";

const POLL_INTERVAL_MS = 10_000;

export default function Home() {
  const [country, setCountry] = useState("");
  const [area, setArea]       = useState("");
  const [region, setRegion]   = useState("");
  const [mode, setMode]       = useState<Mode>("fast");
  const [loading, setLoading] = useState(false);
  const [phase, setPhase]     = useState("");          // status text for deep mode
  const [elapsed, setElapsed] = useState(0);           // seconds, deep mode
  const [result, setResult]   = useState<Result | null>(null);
  const [error, setError]     = useState("");

  const cancelled = useRef(false);
  const timerRef  = useRef<ReturnType<typeof setInterval> | null>(null);

  function stopTimer() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  async function runFast() {
    const res  = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ area, country, region }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Errore sconosciuto");
    setResult(data);
  }

  async function runDeep() {
    // 1. Start the background interaction
    setPhase("Avvio Deep Research…");
    const startRes = await fetch("/api/deep-research/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ area, country, region }),
    });
    const start = await startRes.json();
    if (!startRes.ok) throw new Error(start.error ?? "Avvio fallito");

    const { interactionId } = start;
    setPhase("Ricerca in corso… l'agente naviga il web (può durare ~20 min)");

    // start elapsed counter
    setElapsed(0);
    timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);

    // 2. Poll until completed / failed
    while (!cancelled.current) {
      await sleep(POLL_INTERVAL_MS);
      if (cancelled.current) return;

      const res  = await fetch("/api/deep-research/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interactionId, area, country }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Errore durante il polling");

      if (data.status === "completed") {
        setResult(data);
        return;
      }
      if (data.status === "failed") {
        throw new Error(data.error ?? "Deep Research fallito");
      }
      // else in_progress → keep polling
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    cancelled.current = false;
    setLoading(true);
    setResult(null);
    setError("");
    setPhase("");

    try {
      if (mode === "deep") await runDeep();
      else await runFast();
    } catch (err: unknown) {
      if (!cancelled.current) setError(err instanceof Error ? err.message : "Errore sconosciuto");
    } finally {
      stopTimer();
      setLoading(false);
    }
  }

  function handleCancel() {
    cancelled.current = true;
    stopTimer();
    setLoading(false);
    setPhase("");
  }

  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md">

        {/* Header */}
        <div className="bg-[#1F497D] text-white rounded-t-2xl px-8 py-7 text-center">
          <p className="text-xs font-semibold tracking-widest uppercase text-blue-200 mb-1">
            Scarabelli Group
          </p>
          <h1 className="text-2xl font-bold tracking-tight">IREX Prospect Generator</h1>
          <p className="text-blue-200 text-sm mt-1">Mapping irrigazione · Europa</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-b-2xl shadow-xl px-8 py-8 space-y-6">

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                Paese <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                placeholder="Germany · France · Italy · Spain · Poland…"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                required
                disabled={loading}
                className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1F497D] disabled:bg-gray-50"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                Città / Area <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                placeholder="Hamburg · Lyon · Valencia · Warsaw…"
                value={area}
                onChange={(e) => setArea(e.target.value)}
                required
                disabled={loading}
                className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1F497D] disabled:bg-gray-50"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                Regione <span className="text-gray-300 font-normal normal-case">(opzionale)</span>
              </label>
              <input
                type="text"
                placeholder="Bavaria · Occitanie · Andalucía…"
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                disabled={loading}
                className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1F497D] disabled:bg-gray-50"
              />
            </div>

            {/* Mode selector */}
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                Modalità ricerca
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => setMode("fast")}
                  className={`rounded-lg border px-3 py-2.5 text-left transition-colors disabled:opacity-50 ${
                    mode === "fast"
                      ? "border-[#1F497D] bg-blue-50 ring-1 ring-[#1F497D]"
                      : "border-gray-200 hover:border-gray-300"
                  }`}
                >
                  <div className="text-sm font-semibold text-gray-800">Veloce</div>
                  <div className="text-[11px] text-gray-400 leading-tight mt-0.5">
                    Gemini Flash · ~30 s · pochi cent.
                  </div>
                </button>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => setMode("deep")}
                  className={`rounded-lg border px-3 py-2.5 text-left transition-colors disabled:opacity-50 ${
                    mode === "deep"
                      ? "border-[#1F497D] bg-blue-50 ring-1 ring-[#1F497D]"
                      : "border-gray-200 hover:border-gray-300"
                  }`}
                >
                  <div className="text-sm font-semibold text-gray-800">Deep Research</div>
                  <div className="text-[11px] text-gray-400 leading-tight mt-0.5">
                    Agente · ~20 min · ~$2
                  </div>
                </button>
              </div>
              {mode === "deep" && (
                <p className="text-[11px] text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-2 leading-relaxed">
                  Ricerca approfondita: naviga molte fonti e verifica i dati. Costa ~$2 e richiede
                  fino a ~20 minuti. Tieni questa scheda aperta fino al termine.
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[#1F497D] hover:bg-[#163660] active:bg-[#0f2540] disabled:bg-gray-300 text-white font-semibold py-3 rounded-lg transition-colors text-sm mt-2"
            >
              {loading
                ? "Ricerca in corso…"
                : mode === "deep"
                ? "Avvia Deep Research"
                : "Genera Google Sheet"}
            </button>
          </form>

          {/* Loading */}
          {loading && (
            <div className="flex flex-col items-center gap-3 pt-2 text-gray-400">
              <div className="w-8 h-8 border-[3px] border-[#1F497D] border-t-transparent rounded-full animate-spin" />
              {mode === "deep" ? (
                <div className="text-center space-y-2">
                  <p className="text-sm leading-relaxed">
                    {phase || "Deep Research in corso…"}
                    <br />
                    <span className="text-xs text-gray-300">Tempo trascorso: {mm}:{ss}</span>
                  </p>
                  <button
                    type="button"
                    onClick={handleCancel}
                    className="text-xs text-gray-400 underline hover:text-gray-600"
                  >
                    Annulla attesa
                  </button>
                </div>
              ) : (
                <p className="text-sm text-center leading-relaxed">
                  Gemini sta cercando le aziende…
                  <br />
                  <span className="text-xs text-gray-300">Può richiedere fino a 60 secondi</span>
                </p>
              )}
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-red-700 text-sm">
              <span className="font-semibold">Errore: </span>{error}
            </div>
          )}

          {/* Result */}
          {result && (
            <div className="bg-green-50 border border-green-200 rounded-xl px-5 py-5 space-y-4">
              <div className="flex items-center gap-2 text-green-700 font-semibold">
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                Google Sheet pronto!
              </div>

              <a
                href={result.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 w-full bg-[#1F497D] hover:bg-[#163660] text-white py-2.5 rounded-lg text-sm font-semibold transition-colors"
              >
                Apri Google Sheet
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>

              <div className="grid grid-cols-4 gap-2 text-center">
                <div className="bg-white rounded-lg py-2 shadow-sm">
                  <div className="text-xl font-bold text-gray-800">{result.total}</div>
                  <div className="text-xs text-gray-400 mt-0.5">Totali</div>
                </div>
                <div className="bg-green-100 rounded-lg py-2">
                  <div className="text-xl font-bold text-green-700">{result.counts.ALTA}</div>
                  <div className="text-xs text-green-600 mt-0.5">Alta</div>
                </div>
                <div className="bg-yellow-50 rounded-lg py-2">
                  <div className="text-xl font-bold text-yellow-600">{result.counts.MEDIA}</div>
                  <div className="text-xs text-yellow-500 mt-0.5">Media</div>
                </div>
                <div className="bg-red-50 rounded-lg py-2">
                  <div className="text-xl font-bold text-red-500">{result.counts.BASSA}</div>
                  <div className="text-xs text-red-400 mt-0.5">Bassa</div>
                </div>
              </div>
            </div>
          )}
        </div>

        <p className="text-center text-xs text-gray-300 mt-5">
          Powered by Gemini + Google Sheets · IREX Scarabelli Group
        </p>
      </div>
    </main>
  );
}
