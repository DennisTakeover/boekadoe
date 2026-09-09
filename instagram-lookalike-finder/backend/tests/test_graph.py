from app.pipeline.graph import build_recommendation_graph, rank_candidates, score_candidates


def test_build_recommendation_graph_counts_overlap():
    seed_edges = {
        "seedA": ["X", "Y", "Z", "Q"],
        "seedB": ["X", "M", "Z", "P"],
        "seedC": ["X", "Z", "R", "S"],
    }
    stats = build_recommendation_graph(seed_edges)

    assert stats["X"]["seeds"] == {"seedA", "seedB", "seedC"}
    assert stats["Z"]["seeds"] == {"seedA", "seedB", "seedC"}
    assert stats["Y"]["seeds"] == {"seedA"}
    assert stats["M"]["seeds"] == {"seedB"}


def test_score_candidates_ranks_higher_overlap_first():
    seed_edges = {
        "seedA": ["X", "Y"],
        "seedB": ["X", "M"],
        "seedC": ["X", "R"],
    }
    stats = build_recommendation_graph(seed_edges)
    scored = score_candidates(stats, total_seeds=3)

    assert scored["X"]["seed_overlap"] == 3
    assert scored["Y"]["seed_overlap"] == 1
    assert scored["X"]["similarity_score"] > scored["Y"]["similarity_score"]
    assert scored["X"]["found_via"] == ["seedA", "seedB", "seedC"]


def test_rank_candidates_respects_limit_and_order():
    seed_edges = {
        "seedA": ["X", "Y", "Z"],
        "seedB": ["X", "Y"],
        "seedC": ["X"],
    }
    stats = build_recommendation_graph(seed_edges)
    scored = score_candidates(stats, total_seeds=3)

    top2 = rank_candidates(scored, limit=2)
    assert top2 == ["X", "Y"]
