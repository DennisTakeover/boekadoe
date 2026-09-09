"""Heuristic country classifier with a confidence score.

Instagram doesn't reliably expose a "country" field on public profiles, so
we combine several weak signals from the bio + external link and report how
confident we are, e.g.:

    Bio: "Mama van Sophie | Amsterdam \U0001f1f3\U0001f1f1"
    -> Netherlands, confidence 98%

    Bio: "mom of two, coffee addict"
    -> Netherlands, confidence 63%  (only a language-detection signal)

Signal weights are tuned so a single weak signal (bio language) never
outscores a strong one (flag emoji, explicit city name).
"""
from collections import defaultdict

COUNTRY_NAMES: dict[str, str] = {
    "NL": "Netherlands",
    "BE": "Belgium",
    "DE": "Germany",
    "GB": "United Kingdom",
    "US": "United States",
    "FR": "France",
}

FLAG_EMOJI_TO_CODE: dict[str, str] = {
    "\U0001f1f3\U0001f1f1": "NL",
    "\U0001f1e7\U0001f1ea": "BE",
    "\U0001f1e9\U0001f1ea": "DE",
    "\U0001f1ec\U0001f1e7": "GB",
    "\U0001f1fa\U0001f1f8": "US",
    "\U0001f1eb\U0001f1f7": "FR",
}

# Keep this focused on the NL/BE market Boekadoe cares about; extend as needed.
CITY_KEYWORDS_TO_CODE: dict[str, str] = {
    "amsterdam": "NL",
    "rotterdam": "NL",
    "utrecht": "NL",
    "den haag": "NL",
    "'s-gravenhage": "NL",
    "eindhoven": "NL",
    "groningen": "NL",
    "nederland": "NL",
    "antwerpen": "BE",
    "antwerp": "BE",
    "brussel": "BE",
    "brussels": "BE",
    "gent": "BE",
    "belgie": "BE",
    "belgië": "BE",
}

TLD_TO_CODE: dict[str, str] = {".nl": "NL", ".be": "BE", ".de": "DE", ".fr": "FR"}

# Weak signal: Dutch is spoken in both NL and BE, so this alone stays low-confidence.
LANG_TO_CODE: dict[str, str] = {"nl": "NL"}

FLAG_WEIGHT = 40
CITY_WEIGHT = 35
TLD_WEIGHT = 20
LANG_WEIGHT = 15
MAX_CONFIDENCE = 98


def classify_country(bio: str | None, external_url: str | None, ig_city_name: str | None = None) -> dict:
    # Instagram's own (business/creator) location field, when set, is a fact
    # from the platform rather than a heuristic on free text — it wins
    # outright over bio/TLD/language guesses instead of just adding to them.
    if ig_city_name:
        city_lower = ig_city_name.lower()
        for keyword, code in CITY_KEYWORDS_TO_CODE.items():
            if keyword in city_lower:
                return {
                    "country": COUNTRY_NAMES[code],
                    "confidence": MAX_CONFIDENCE,
                    "signals": [f"Instagram city field '{ig_city_name}' -> {COUNTRY_NAMES[code]}"],
                }

    text = bio or ""
    lower = text.lower()
    scores: dict[str, int] = defaultdict(int)
    signals: list[str] = []

    for emoji, code in FLAG_EMOJI_TO_CODE.items():
        if emoji in text:
            scores[code] += FLAG_WEIGHT
            signals.append(f"flag emoji {emoji} -> {COUNTRY_NAMES[code]}")

    for keyword, code in CITY_KEYWORDS_TO_CODE.items():
        if keyword in lower:
            scores[code] += CITY_WEIGHT
            signals.append(f"bio mentions '{keyword}' -> {COUNTRY_NAMES[code]}")

    if external_url:
        url_lower = external_url.lower().rstrip("/")
        for tld, code in TLD_TO_CODE.items():
            if url_lower.endswith(tld) or f"{tld}/" in url_lower:
                scores[code] += TLD_WEIGHT
                signals.append(f"website TLD {tld} -> {COUNTRY_NAMES[code]}")

    lang = _detect_lang(text)
    if lang in LANG_TO_CODE:
        code = LANG_TO_CODE[lang]
        scores[code] += LANG_WEIGHT
        signals.append(f"bio language '{lang}' -> {COUNTRY_NAMES[code]}")

    if not scores:
        return {"country": None, "confidence": 0, "signals": []}

    best_code = max(scores, key=lambda c: scores[c])
    confidence = min(MAX_CONFIDENCE, scores[best_code])
    return {"country": COUNTRY_NAMES[best_code], "confidence": confidence, "signals": signals}


def _detect_lang(text: str) -> str | None:
    if len(text.strip()) < 8:
        return None
    try:
        from langdetect import DetectorFactory, LangDetectException, detect

        DetectorFactory.seed = 0  # deterministic results
        return detect(text)
    except LangDetectException:
        return None
    except ImportError:
        return None
