from app.pipeline.country import classify_country


def test_flag_emoji_gives_high_confidence():
    result = classify_country("Mama van Sophie | Amsterdam \U0001f1f3\U0001f1f1", None)
    assert result["country"] == "Netherlands"
    assert result["confidence"] >= 90


def test_belgian_city_keyword_detected():
    result = classify_country("Papa blog uit Antwerpen", None)
    assert result["country"] == "Belgium"
    assert result["confidence"] > 0


def test_no_signals_returns_none():
    result = classify_country("coffee, dogs, sunsets", None)
    assert result["country"] is None
    assert result["confidence"] == 0


def test_tld_contributes_signal():
    result = classify_country("", "https://mysite.nl")
    assert result["country"] == "Netherlands"
    assert result["confidence"] > 0
