"use client";

import { useState } from "react";

import type { Candidate } from "../lib/api";

type SortKey = "similarity_score" | "followers" | "seed_overlap";

export default function ResultsTable({ candidates }: { candidates: Candidate[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("similarity_score");
  const [sortDesc, setSortDesc] = useState(true);

  const sorted = [...candidates].sort((a, b) => (sortDesc ? b[sortKey] - a[sortKey] : a[sortKey] - b[sortKey]));

  function headerClick(key: SortKey) {
    if (key === sortKey) {
      setSortDesc((desc) => !desc);
    } else {
      setSortKey(key);
      setSortDesc(true);
    }
  }

  if (sorted.length === 0) {
    return <p>Geen accounts matchen de huidige filters.</p>;
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Username</th>
            <th className="sortable" onClick={() => headerClick("followers")}>
              Followers
            </th>
            <th>Land</th>
            <th>Niche</th>
            <th className="sortable" onClick={() => headerClick("similarity_score")}>
              Score
            </th>
            <th className="sortable" onClick={() => headerClick("seed_overlap")}>
              Seed overlap
            </th>
            <th>Found via</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((c) => (
            <tr key={c.username}>
              <td>
                <a href={`https://instagram.com/${c.username}`} target="_blank" rel="noreferrer">
                  @{c.username}
                </a>
              </td>
              <td>{c.followers.toLocaleString("nl-NL")}</td>
              <td>{c.country ? `${c.country} (${c.country_confidence}%)` : "-"}</td>
              <td>{c.niche_primary ?? "-"}</td>
              <td>{c.similarity_score}</td>
              <td>{c.seed_overlap}</td>
              <td>{c.found_via.map((s) => `@${s}`).join(", ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
