export const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const API_KEY = process.env.NEXT_PUBLIC_API_KEY || "";

export type RunStatus = {
  id: string;
  created_at: string;
  seeds: string[];
  desired_results: number;
  status: "queued" | "discovering" | "discovered" | "matchmaking" | "done" | "error";
  progress_stage: string;
  progress_current: number;
  progress_total: number;
  error_message: string | null;
};

export type BioLink = {
  title: string;
  url: string;
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
  profile_pic_url_hd: string | null;
  bio_links: BioLink[];
  account_type: number | null;
  account_type_name: string | null;
  category_name: string | null;
  business_category_name: string | null;
  business_contact_method: string | null;
  public_email: string | null;
  public_phone_country_code: string | null;
  public_phone_number: string | null;
  contact_phone_number: string | null;
  address_street: string | null;
  city_name: string | null;
  city_id: string | null;
  zip_code: string | null;
  latitude: number | null;
  longitude: number | null;
  instagram_location_id: string | null;
  has_threads_badge: boolean;
  threads_badge_label: string | null;
  has_broadcast_channel: boolean;
  interop_messaging_user_fbid: string | null;
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
    headers: {
      "Content-Type": "application/json",
      ...(API_KEY ? { "X-API-Key": API_KEY } : {}),
      ...(init?.headers || {}),
    },
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

export function listRuns() {
  return api<RunStatus[]>("/runs");
}

// Phase 2: AI matchmaking/niche-classification over an already-discovered
// run's candidates. Separate from createRun (phase 1) so it can be
// triggered manually, and re-run on its own without hitting Instagram again.
export function startMatchmaking(id: string) {
  return api<RunStatus>(`/runs/${id}/matchmaking`, { method: "POST" });
}

export function getCandidates(id: string, params: Record<string, string>) {
  const qs = new URLSearchParams(params).toString();
  return api<Candidate[]>(`/runs/${id}/candidates${qs ? `?${qs}` : ""}`);
}

export function exportCsvUrl(id: string, params: Record<string, string>): string {
  // Plain <a href> download link — can't attach the X-API-Key header, so the
  // key (if set) goes in the query string instead (backend accepts both).
  const qs = new URLSearchParams({ ...params, ...(API_KEY ? { api_key: API_KEY } : {}) }).toString();
  return `${API_URL}/runs/${id}/export.csv${qs ? `?${qs}` : ""}`;
}
