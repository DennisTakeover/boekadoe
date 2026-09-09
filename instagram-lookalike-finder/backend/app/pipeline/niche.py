"""AI niche classification via the Anthropic API.

This is the one place AI actually helps: turning a bio/category into a
structured niche label. Everything upstream (candidate discovery, scoring)
comes straight from Instagram's own recommendation graph — no AI needed
there.
"""
import asyncio
import json
import logging

from ..config import settings

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """Je classificeert Instagram-accounts voor influencer- en lookalike-marketing.
Antwoord ALLEEN met geldige JSON (geen uitleg, geen markdown) volgens dit schema:
{"primary_niche": string, "secondary_niche": string of null, "is_influencer": boolean, "commercial_potential": getal tussen 0 en 1}

Gebruik korte, herbruikbare niche-labels in het Engels, bv. "parenting", "family_lifestyle",
"fitness", "fashion", "beauty", "food", "kids_products", "travel", "other"."""

_client = None


def _get_client():
    global _client
    if _client is None:
        from anthropic import AsyncAnthropic

        _client = AsyncAnthropic(api_key=settings.anthropic_api_key)
    return _client


_FALLBACK = {
    "primary_niche": "unknown",
    "secondary_niche": None,
    "is_influencer": False,
    "commercial_potential": 0.0,
}


def _strip_markdown_fence(text: str) -> str:
    """Claude sometimes wraps JSON in ```json ... ``` despite being told not to."""
    text = text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else text[3:]
        if text.endswith("```"):
            text = text[: -3]
    return text.strip()


async def classify_niche(
    username: str,
    full_name: str,
    bio: str,
    category: str | None,
    sem: asyncio.Semaphore,
) -> dict:
    if not settings.anthropic_api_key:
        return dict(_FALLBACK)

    prompt = (
        f"username: @{username}\n"
        f"naam: {full_name or '(onbekend)'}\n"
        f"categorie (Instagram): {category or 'onbekend'}\n"
        f"bio: {bio or '(leeg)'}"
    )

    async with sem:
        try:
            resp = await _get_client().messages.create(
                model=settings.niche_model,
                max_tokens=200,
                system=SYSTEM_PROMPT,
                messages=[{"role": "user", "content": prompt}],
            )
            text = _strip_markdown_fence(resp.content[0].text)
            data = json.loads(text)
            return {
                "primary_niche": str(data.get("primary_niche") or "unknown"),
                "secondary_niche": data.get("secondary_niche"),
                "is_influencer": bool(data.get("is_influencer", False)),
                "commercial_potential": float(data.get("commercial_potential", 0.0)),
            }
        except Exception:
            logger.warning("niche classification failed for @%s", username, exc_info=True)
            return dict(_FALLBACK)
