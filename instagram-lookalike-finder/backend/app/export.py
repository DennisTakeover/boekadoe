"""CSV (always available) and Google Sheets (optional) export."""
import csv
import io

from .models import Candidate

CSV_COLUMNS = [
    "username",
    "instagram_url",
    "full_name",
    "followers",
    "following",
    "posts",
    "bio",
    "external_url",
    "bio_links",
    "category",
    "category_name",
    "account_type",
    "is_verified",
    "is_business",
    "is_private",
    "business_category_name",
    "business_contact_method",
    "public_email",
    "public_phone_country_code",
    "public_phone_number",
    "contact_phone_number",
    "address_street",
    "city_name",
    "zip_code",
    "latitude",
    "longitude",
    "has_threads_badge",
    "threads_badge_label",
    "has_broadcast_channel",
    "country",
    "country_confidence",
    "niche",
    "niche_secondary",
    "is_influencer",
    "commercial_potential",
    "similarity_score",
    "seed_overlap",
    "found_via",
]


def _row(c: Candidate) -> dict:
    return {
        "username": c.username,
        "instagram_url": f"https://instagram.com/{c.username}",
        "full_name": c.full_name,
        "followers": c.followers,
        "following": c.following,
        "posts": c.posts,
        "bio": c.biography,
        "external_url": c.external_url or "",
        "bio_links": ", ".join(f"{l.get('title') or 'link'}: {l['url']}" for l in (c.bio_links or [])),
        "category": c.category or "",
        "category_name": c.category_name or "",
        "account_type": c.account_type_name or "",
        "is_verified": c.is_verified,
        "is_business": c.is_business,
        "is_private": c.is_private,
        "business_category_name": c.business_category_name or "",
        "business_contact_method": c.business_contact_method or "",
        "public_email": c.public_email or "",
        "public_phone_country_code": c.public_phone_country_code or "",
        "public_phone_number": c.public_phone_number or "",
        "contact_phone_number": c.contact_phone_number or "",
        "address_street": c.address_street or "",
        "city_name": c.city_name or "",
        "zip_code": c.zip_code or "",
        "latitude": c.latitude if c.latitude is not None else "",
        "longitude": c.longitude if c.longitude is not None else "",
        "has_threads_badge": c.has_threads_badge,
        "threads_badge_label": c.threads_badge_label or "",
        "has_broadcast_channel": c.has_broadcast_channel,
        "country": c.country or "",
        "country_confidence": c.country_confidence,
        "niche": c.niche_primary or "",
        "niche_secondary": c.niche_secondary or "",
        "is_influencer": c.is_influencer,
        "commercial_potential": c.commercial_potential,
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
