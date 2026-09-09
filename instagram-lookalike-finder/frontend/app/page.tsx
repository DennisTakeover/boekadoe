"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { createRun } from "../lib/api";

export default function HomePage() {
  const router = useRouter();
  const [seedsText, setSeedsText] = useState("");
  const [desiredResults, setDesiredResults] = useState(500);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const seeds = seedsText
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);

    if (seeds.length === 0) {
      setError("Voer minstens één Instagram-account in.");
      return;
    }

    setLoading(true);
    try {
      const run = await createRun(seeds, desiredResults);
      router.push(`/runs/${run.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Onbekende fout");
      setLoading(false);
    }
  }

  return (
    <main className="page">
      <div className="card">
        <h1>Instagram Lookalike Finder</h1>
        <p className="subtitle">
          Voer een paar goede seed-accounts in (concurrenten, influencers). Instagram&apos;s eigen
          aanbevelingen bepalen de kandidaten — wij bouwen daar een recommendation graph, similarity
          score, land-inschatting en niche-classificatie overheen.
        </p>
        <form onSubmit={handleSubmit}>
          <label htmlFor="seeds">Seed accounts (één per regel)</label>
          <textarea
            id="seeds"
            rows={8}
            placeholder={"concurrent1\nconcurrent2\ninfluencer3\ninfluencer4"}
            value={seedsText}
            onChange={(e) => setSeedsText(e.target.value)}
          />

          <label htmlFor="desired">Gewenst aantal resultaten</label>
          <input
            id="desired"
            type="number"
            min={1}
            max={5000}
            value={desiredResults}
            onChange={(e) => setDesiredResults(Number(e.target.value))}
          />

          {error && <p className="error">{error}</p>}

          <button type="submit" disabled={loading}>
            {loading ? "Bezig..." : "FIND LOOKALIKES"}
          </button>
        </form>
      </div>
    </main>
  );
}
