"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import {
  type Candidate,
  emptyFilters,
  exportCsvUrl,
  filtersToParams,
  type Filters,
  getCandidates,
  getRun,
  type RunStatus,
  startMatchmaking,
} from "../../../lib/api";
import FiltersPanel from "../../../components/FiltersPanel";
import ResultsTable from "../../../components/ResultsTable";

const IN_PROGRESS_STATUSES: RunStatus["status"][] = ["queued", "discovering", "matchmaking"];
// Candidates exist and can be shown as soon as phase 1 (discovery) is done,
// even before phase 2 (AI matchmaking) has run.
const HAS_CANDIDATES_STATUSES: RunStatus["status"][] = ["discovered", "matchmaking", "done"];

export default function RunPage() {
  const params = useParams<{ id: string }>();
  const runId = params.id;

  const [run, setRun] = useState<RunStatus | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [startingMatchmaking, setStartingMatchmaking] = useState(false);

  // Poll run status while a phase is actively running.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      try {
        const data = await getRun(runId);
        if (cancelled) return;
        setRun(data);
        if (IN_PROGRESS_STATUSES.includes(data.status)) {
          timer = setTimeout(poll, 2000);
        }
      } catch {
        timer = setTimeout(poll, 3000);
      }
    }

    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [runId]);

  const loadCandidates = useCallback(async () => {
    if (!run || !HAS_CANDIDATES_STATUSES.includes(run.status)) return;
    setLoadingCandidates(true);
    try {
      const data = await getCandidates(runId, filtersToParams(filters));
      setCandidates(data);
    } finally {
      setLoadingCandidates(false);
    }
  }, [run, runId, filters]);

  useEffect(() => {
    loadCandidates();
  }, [loadCandidates]);

  async function handleStartMatchmaking() {
    setStartingMatchmaking(true);
    try {
      const updated = await startMatchmaking(runId);
      setRun(updated);
    } finally {
      setStartingMatchmaking(false);
    }
  }

  const backLink = (
    <Link href="/" className="button button--ghost back-link">
      ← Nieuwe zoekopdracht
    </Link>
  );

  if (!run) {
    return (
      <main className="page">
        <div className="card">
          <p className="subtitle">Laden...</p>
        </div>
      </main>
    );
  }

  if (run.status === "error") {
    return (
      <main className="page">
        <div className="card">
          {backLink}
          <span className="eyebrow">Run mislukt</span>
          <h1>Er ging iets mis</h1>
          <p className="error">{run.error_message}</p>
        </div>
      </main>
    );
  }

  if (IN_PROGRESS_STATUSES.includes(run.status) && !HAS_CANDIDATES_STATUSES.includes(run.status)) {
    // Phase 1 (discovery) still running — no candidates to show yet.
    const pct = run.progress_total ? Math.round((run.progress_current / run.progress_total) * 100) : 0;
    return (
      <main className="page">
        <div className="card">
          {backLink}
          <span className="eyebrow">Fase 1 · Data ophalen</span>
          <h1>Lookalikes zoeken en verrijken...</h1>
          <p className="subtitle">
            {run.progress_stage} ({run.progress_current}/{run.progress_total})
          </p>
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </main>
    );
  }

  const countryOptions = Array.from(new Set(candidates.map((c) => c.country).filter((c): c is string => Boolean(c))));
  const nicheOptions = Array.from(
    new Set(candidates.map((c) => c.niche_primary).filter((n): n is string => Boolean(n) && n !== "unknown"))
  );

  const matchmakingPct = run.progress_total ? Math.round((run.progress_current / run.progress_total) * 100) : 0;

  return (
    <main className="page wide">
      <div className="card">
        {backLink}
        <span className="eyebrow">Resultaten</span>
        <h1>{candidates.length} matchende accounts</h1>
        <div className="seed-chips">
          {run.seeds.map((s) => (
            <span key={s} className="seed-chip">
              @{s}
            </span>
          ))}
        </div>

        {run.status === "discovered" && (
          <div className="phase-callout">
            <p>
              Fase 1 klaar: data van {candidates.length} accounts opgehaald en verrijkt (nog geen niche/AI-classificatie).
              Start fase 2 om ze met AI te laten classificeren en matchen.
            </p>
            <button onClick={handleStartMatchmaking} disabled={startingMatchmaking}>
              {startingMatchmaking ? "Starten..." : "Fase 2 · Start AI matchmaking"}
            </button>
          </div>
        )}

        {run.status === "matchmaking" && (
          <div className="phase-callout">
            <p className="subtitle">
              Fase 2 · AI matchmaking bezig — {run.progress_stage} ({run.progress_current}/{run.progress_total})
            </p>
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${matchmakingPct}%` }} />
            </div>
          </div>
        )}

        {run.status === "done" && (
          <div className="phase-callout phase-callout--muted">
            <p className="subtitle">Fase 2 (AI matchmaking) is afgerond.</p>
            <button className="button--ghost" onClick={handleStartMatchmaking} disabled={startingMatchmaking}>
              {startingMatchmaking ? "Starten..." : "Opnieuw classificeren met AI"}
            </button>
          </div>
        )}

        <FiltersPanel filters={filters} onChange={setFilters} countryOptions={countryOptions} nicheOptions={nicheOptions} />

        <div className="export-row">
          <a className="button" href={exportCsvUrl(runId, filtersToParams(filters))}>
            Export CSV
          </a>
        </div>

        {loadingCandidates ? <p>Filteren...</p> : <ResultsTable candidates={candidates} />}
      </div>
    </main>
  );
}
