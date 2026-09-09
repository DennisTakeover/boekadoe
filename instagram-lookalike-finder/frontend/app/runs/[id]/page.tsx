"use client";

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
} from "../../../lib/api";
import FiltersPanel from "../../../components/FiltersPanel";
import ResultsTable from "../../../components/ResultsTable";

export default function RunPage() {
  const params = useParams<{ id: string }>();
  const runId = params.id;

  const [run, setRun] = useState<RunStatus | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [loadingCandidates, setLoadingCandidates] = useState(false);

  // Poll run status until it leaves queued/running.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      try {
        const data = await getRun(runId);
        if (cancelled) return;
        setRun(data);
        if (data.status === "queued" || data.status === "running") {
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
    if (!run || run.status !== "done") return;
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

  if (!run) {
    return (
      <main className="page">
        <div className="card">
          <p>Laden...</p>
        </div>
      </main>
    );
  }

  if (run.status === "error") {
    return (
      <main className="page">
        <div className="card">
          <h1>Er ging iets mis</h1>
          <p className="error">{run.error_message}</p>
        </div>
      </main>
    );
  }

  if (run.status !== "done") {
    const pct = run.progress_total ? Math.round((run.progress_current / run.progress_total) * 100) : 0;
    return (
      <main className="page">
        <div className="card">
          <h1>Bezig met zoeken...</h1>
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

  return (
    <main className="page wide">
      <div className="card">
        <h1>{candidates.length} matchende accounts</h1>
        <p className="subtitle">Seeds: {run.seeds.map((s) => `@${s}`).join(", ")}</p>

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
