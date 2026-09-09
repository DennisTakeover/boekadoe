export const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export type RunStatus = {
  id: string;
  created_at: string;
  seeds: string[];
  desired_results: number;
  status: "queued" | "running" | "done" | "error";
  progress_stage: string;
  progress_current: number;
  progress_total: number;
  error_message: string | null;
};

export type Candidate = {
  username: string;
  full_name: string;
  followers: number;
  following: number;
  posts: number;
  biography: string;
  external_url: string | null;
  category: string | null;
  is_verified: boolean;
  is_business: boolean;
  is_private: boolean;
  profile_pic_url: string | null;
  similarity_score: number;
  seed_overlap: number;
  found_via: string[];
  country: string | null;
  country_confidence: number;
  niche_primary: string | null;
  niche_secondary: string | null;
  is_influencer: boolean;
  commercial_potential: number;
};

export type Filters = {
  minFollowers: string;
  maxFollowers: string;
  countries: string[];
  niches: string[];
  businessOnly: boolean;
  minScore: string;
};

export const emptyFilters: Filters = {
  minFollowers: "",
  maxFollowers: "",
  countries: [],
  niches: [],
  businessOnly: false,
  minScore: "",
};

export function filtersToParams(filters: Filters): Record<string, string> {
  const params: Record<string, string> = {};
  if (filters.minFollowers) params.min_followers = filters.minFollowers;
  if (filters.maxFollowers) params.max_followers = filters.maxFollowers;
  if (filters.countries.length) params.countries = filters.countries.join(",");
  if (filters.niches.length) params.niches = filters.niches.join(",");
  if (filters.businessOnly) params.business_only = "true";
  if (filters.minScore) params.min_score = filters.minScore;
  return params;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API-fout ${res.status}: ${text}`);
  }
  return res.json();
}

export function createRun(seeds: string[], desiredResults: number) {
  return api<RunStatus>("/runs", {
    method: "POST",
    body: JSON.stringify({ seeds, desired_results: desiredResults }),
  });
}

export function getRun(id: string) {
  return api<RunStatus>(`/runs/${id}`);
}

export function getCandidates(id: string, params: Record<string, string>) {
  const qs = new URLSearchParams(params).toString();
  return api<Candidate[]>(`/runs/${id}/candidates${qs ? `?${qs}` : ""}`);
}

export function exportCsvUrl(id: string, params: Record<string, string>): string {
  const qs = new URLSearchParams(params).toString();
  return `${API_URL}/runs/${id}/export.csv${qs ? `?${qs}` : ""}`;
}
