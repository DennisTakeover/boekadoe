"use client";

import type { Filters } from "../lib/api";

type Props = {
  filters: Filters;
  onChange: (filters: Filters) => void;
  countryOptions: string[];
  nicheOptions: string[];
};

function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export default function FiltersPanel({ filters, onChange, countryOptions, nicheOptions }: Props) {
  return (
    <div className="filters">
      <div className="filter-group">
        <label>Followers</label>
        <div className="range-inputs">
          <input
            type="number"
            placeholder="min"
            value={filters.minFollowers}
            onChange={(e) => onChange({ ...filters, minFollowers: e.target.value })}
          />
          <span>—</span>
          <input
            type="number"
            placeholder="max"
            value={filters.maxFollowers}
            onChange={(e) => onChange({ ...filters, maxFollowers: e.target.value })}
          />
        </div>
      </div>

      <div className="filter-group">
        <label htmlFor="min-score">Min. similarity score</label>
        <input
          id="min-score"
          type="number"
          min={0}
          max={100}
          value={filters.minScore}
          onChange={(e) => onChange({ ...filters, minScore: e.target.value })}
        />
      </div>

      {countryOptions.length > 0 && (
        <div className="filter-group">
          <label>Land</label>
          <div className="chip-list">
            {countryOptions.map((country) => (
              <label key={country} className="checkbox">
                <input
                  type="checkbox"
                  checked={filters.countries.includes(country)}
                  onChange={() => onChange({ ...filters, countries: toggle(filters.countries, country) })}
                />
                {country}
              </label>
            ))}
          </div>
        </div>
      )}

      {nicheOptions.length > 0 && (
        <div className="filter-group">
          <label>Niche</label>
          <div className="chip-list">
            {nicheOptions.map((niche) => (
              <label key={niche} className="checkbox">
                <input
                  type="checkbox"
                  checked={filters.niches.includes(niche)}
                  onChange={() => onChange({ ...filters, niches: toggle(filters.niches, niche) })}
                />
                {niche}
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="filter-group">
        <label className="checkbox">
          <input
            type="checkbox"
            checked={filters.businessOnly}
            onChange={(e) => onChange({ ...filters, businessOnly: e.target.checked })}
          />
          Alleen zakelijke accounts
        </label>
      </div>
    </div>
  );
}
