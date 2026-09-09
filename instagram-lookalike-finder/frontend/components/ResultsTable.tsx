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
            <th>Land / stad</th>
            <th>Niche</th>
            <th>Type</th>
            <th>Contact</th>
            <th>Links</th>
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
              <td>
                {c.country ? `${c.country} (${c.country_confidence}%)` : "-"}
                {c.city_name ? ` · ${c.city_name}` : ""}
              </td>
              <td>
                {c.niche_primary ? <span className="badge badge--niche">{c.niche_primary}</span> : "-"}
              </td>
              <td>
                {c.account_type_name ? <span className="badge badge--muted">{c.account_type_name}</span> : "-"}
              </td>
              <td>
                {c.public_email && <div>{c.public_email}</div>}
                {c.public_phone_number && (
                  <div>
                    +{c.public_phone_country_code} {c.public_phone_number}
                  </div>
                )}
                {!c.public_email && !c.public_phone_number && "-"}
              </td>
              <td>
                {c.bio_links.length > 0
                  ? c.bio_links.map((l) => (
                      <a key={l.url} href={l.url} target="_blank" rel="noreferrer" title={l.title} style={{ marginRight: 4 }}>
                        🔗
                      </a>
                    ))
                  : "-"}
              </td>
              <td>
                <span className="badge badge--score">{c.similarity_score}</span>
              </td>
              <td>{c.seed_overlap}</td>
              <td>{c.found_via.map((s) => `@${s}`).join(", ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
