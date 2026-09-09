"""CSV (always available) and Google Sheets (optional) export."""
import csv
import io

from .models import Candidate

CSV_COLUMNS = [
    "username",
    "instagram_url",
    "followers",
    "following",
    "bio",
    "category",
    "country",
    "country_confidence",
    "niche",
    "similarity_score",
    "seed_overlap",
    "found_via",
]


def _row(c: Candidate) -> dict:
    return {
        "username": c.username,
        "instagram_url": f"https://instagram.com/{c.username}",
        "followers": c.followers,
        "following": c.following,
        "bio": c.biography,
        "category": c.category or "",
        "country": c.country or "",
        "country_confidence": c.country_confidence,
        "niche": c.niche_primary or "",
        "similarity_score": c.similarity_score,
        "seed_overlap": c.seed_overlap,
        "found_via": ", ".join(c.found_via or []),
    }


def candidates_to_csv(candidates: list[Candidate]) -> str:
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=CSV_COLUMNS)
    writer.writeheader()
    for c in candidates:
        writer.writerow(_row(c))
    return buf.getvalue()


def export_to_google_sheets(candidates: list[Candidate], spreadsheet_id: str, service_account_json: str) -> str:
    """Optional: push results into an existing Google Sheet. Requires a
    service-account JSON key (GOOGLE_SERVICE_ACCOUNT_JSON) shared as an
    editor on the target spreadsheet. Raises RuntimeError with a clear
    message if the `gspread` dependency isn't installed."""
    try:
        import gspread
    except ImportError as exc:  # pragma: no cover - optional dependency
        raise RuntimeError(
            "Google Sheets export vereist het 'gspread' pakket: pip install gspread google-auth"
        ) from exc

    gc = gspread.service_account(filename=service_account_json)
    sh = gc.open_by_key(spreadsheet_id)
    ws = sh.sheet1
    ws.clear()
    ws.append_row(CSV_COLUMNS)
    for c in candidates:
        row = _row(c)
        ws.append_row([row[col] for col in CSV_COLUMNS])
    return sh.url
