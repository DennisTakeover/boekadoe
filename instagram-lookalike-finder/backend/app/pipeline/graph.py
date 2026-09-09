"""Turn Instagram's own per-seed recommendation lists into one recommendation
graph, and score every candidate by how many seeds recommended it (and how
high up each list it appeared).

    SEED A -> X, Y, Z, Q
    SEED B -> X, M, Z, P
    SEED C -> X, Z, R, S

    X, Z -> recommended by 3 seeds  => strong lookalike
    Y, M -> recommended by 1 seed   => weaker match
"""
from collections import defaultdict


def build_recommendation_graph(seed_edges: dict[str, list[str]]) -> dict[str, dict]:
    """seed_edges: seed_username -> ordered list of candidate user_ids
    (best match first, as returned by Instagram's chaining/discover endpoint).

    Returns candidate_user_id -> {"seeds": set[str], "rank_sum": int, "rank_count": int}
    """
    stats: dict[str, dict] = defaultdict(lambda: {"seeds": set(), "rank_sum": 0, "rank_count": 0})
    for seed, candidate_ids in seed_edges.items():
        for rank, user_id in enumerate(candidate_ids):
            entry = stats[user_id]
            entry["seeds"].add(seed)
            entry["rank_sum"] += rank
            entry["rank_count"] += 1
    return stats


def score_candidates(stats: dict[str, dict], total_seeds: int) -> dict[str, dict]:
    """Similarity score 0-100, weighted mostly by seed overlap (how many
    different seed accounts Instagram itself linked this candidate to),
    with a smaller bonus for showing up near the top of any single list.

    Returns candidate_user_id -> {"seed_overlap", "found_via", "similarity_score"}
    """
    scored = {}
    for user_id, entry in stats.items():
        overlap = len(entry["seeds"])
        avg_rank = entry["rank_sum"] / entry["rank_count"] if entry["rank_count"] else 0

        overlap_score = min(overlap / max(total_seeds, 1), 1.0) * 85  # up to 85 pts for overlap
        rank_bonus = max(0.0, 15 - avg_rank)  # up to 15 pts for ranking near the top of a list

        scored[user_id] = {
            "seed_overlap": overlap,
            "found_via": sorted(entry["seeds"]),
            "similarity_score": round(min(100.0, overlap_score + rank_bonus)),
        }
    return scored


def rank_candidates(scored: dict[str, dict], limit: int) -> list[str]:
    """Top `limit` candidate user_ids, best similarity score first."""
    return sorted(scored, key=lambda uid: -scored[uid]["similarity_score"])[:limit]
