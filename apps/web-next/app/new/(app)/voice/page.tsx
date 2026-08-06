"use client";

import { useRef, useState } from "react";

import { useApiClient } from "@/app/api-client";

export default function VoicePage() {
  const client = useApiClient();
  const [text, setText] = useState("");
  const [synthesizing, setSynthesizing] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  async function handleSynthesize() {
    if (text.trim() === "") return;
    setSynthesizing(true);
    setError(null);
    try {
      const blob = await client.voice.synthesize({ text: text.trim() });
      const url = URL.createObjectURL(blob);
      setAudioUrl(url);
      setTimeout(() => audioRef.current?.play(), 100);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Synthesis failed");
    } finally {
      setSynthesizing(false);
    }
  }

  return (
    <section className="mx-auto max-w-2xl">
      <h1 className="mb-6 text-xl font-semibold tracking-tight">Voice Synthesis</h1>

      <div className="rounded-lg border p-4" style={{ background: "var(--panel)", borderColor: "var(--panel-border)" }}>
        <textarea
          placeholder="Enter text to synthesize..."
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          className="mb-3 w-full rounded-md border p-2 text-sm"
          style={{ borderColor: "var(--panel-border)", background: "var(--background)" }}
        />
        <button
          type="button"
          onClick={handleSynthesize}
          disabled={synthesizing || text.trim() === ""}
          className="rounded-md px-3 py-2 text-sm font-medium transition-opacity disabled:opacity-60"
          style={{ background: "var(--accent)", color: "var(--accent-foreground)" }}
        >
          {synthesizing ? "Synthesizing..." : "Synthesize"}
        </button>
        {error !== null && (
          <p className="mt-2 text-sm" style={{ color: "var(--danger)" }} role="alert">
            {error}
          </p>
        )}
        {audioUrl !== null && (
          <div className="mt-4">
            <audio ref={audioRef} controls className="w-full">
              <source src={audioUrl} type="audio/mpeg" />
            </audio>
          </div>
        )}
      </div>
    </section>
  );
}
