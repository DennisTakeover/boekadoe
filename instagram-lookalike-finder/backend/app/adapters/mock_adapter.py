"""Deterministic, network-free adapter for local demos and tests.

Generates a fake but stable recommendation graph and fake profiles so the
whole pipeline (graph building, scoring, country/niche classification,
export) can be exercised without touching Instagram or requiring
credentials. Enable with USE_MOCK_ADAPTER=true.
"""
import hashlib
import random

from .base import BioLink, IGProfile, InstagramAdapter

_BIOS = [
    "Mama van twee | Amsterdam \U0001f1f3\U0001f1f1 | boekjes & knutselen",
    "Papa blog | Antwerpen \U0001f1e7\U0001f1ea | dagjes uit met kids",
    "Kinderboeken en voorlezen \U0001f4da | www.example.nl",
    "Lifestyle & parenting | Rotterdam",
    "Fitness coach | www.example.com",
    "Mode & beauty tips ✨",
]

# (city, zip, lat, lng) — kept in sync with the NL/BE cities used in _BIOS above.
_CITIES = [
    ("Amsterdam", "1012 AB", 52.3676, 4.9041),
    ("Antwerpen", "2000", 51.2194, 4.4025),
    ("Rotterdam", "3011 AA", 51.9244, 4.4777),
    (None, None, None, None),  # plenty of accounts don't publish a location
]

_ACCOUNT_TYPE_NAMES = {1: "personal", 2: "business", 3: "creator"}


def _stable_int(seed: str, low: int, high: int) -> int:
    h = int(hashlib.sha256(seed.encode()).hexdigest(), 16)
    return low + (h % (high - low))


class MockAdapter(InstagramAdapter):
    async def login(self) -> None:
        return None

    async def resolve_user_id(self, username: str) -> str | None:
        clean = username.lstrip("@").strip().lower()
        return str(_stable_int(f"uid:{clean}", 10_000, 99_999_999))

    async def get_similar_user_ids(self, user_id: str) -> list[str]:
        rng = random.Random(f"chaining:{user_id}")
        # Pull from a shared-ish candidate pool so different seeds overlap,
        # which is exactly the signal the real scoring logic looks for.
        pool = [str(_stable_int(f"cand:{i}", 10_000, 99_999_999)) for i in range(60)]
        rng.shuffle(pool)
        return pool[: rng.randint(15, 30)]

    async def get_profile(self, user_id: str) -> IGProfile | None:
        rng = random.Random(f"profile:{user_id}")
        username = f"account_{user_id[-6:]}"
        is_business = rng.random() < 0.4
        account_type = rng.choice([1, 2, 3])
        city_name, zip_code, lat, lng = rng.choice(_CITIES)
        # Only business/creator accounts with a set location publish contact info.
        has_contact = is_business and city_name is not None and rng.random() < 0.5
        return IGProfile(
            user_id=user_id,
            username=username,
            full_name=username.replace("_", " ").title(),
            followers=rng.randint(2_000, 250_000),
            following=rng.randint(100, 3_000),
            posts=rng.randint(20, 2_000),
            biography=rng.choice(_BIOS),
            external_url=rng.choice([None, "https://example.nl", "https://example.com"]),
            category=rng.choice([None, "Blogger", "Product/service", "Public figure"]),
            is_verified=rng.random() < 0.05,
            is_business=is_business,
            is_private=rng.random() < 0.1,
            profile_pic_url=None,
            profile_pic_url_hd=None,
            bio_links=[BioLink(url="https://linktr.ee/" + username, title="Linktree")] if rng.random() < 0.2 else [],
            account_type=account_type,
            category_name=rng.choice([None, "Blogger", "Health/beauty", "Retail company"]),
            business_category_name=rng.choice([None, "Family", "Retail"]) if is_business else None,
            business_contact_method=rng.choice([None, "EMAIL", "IG_DIRECT"]) if is_business else None,
            public_email=f"{username}@example.com" if has_contact else None,
            public_phone_country_code="31" if has_contact else None,
            public_phone_number="612345678" if has_contact else None,
            contact_phone_number="+31612345678" if has_contact else None,
            address_street="Voorbeeldstraat 1" if has_contact else None,
            city_name=city_name,
            city_id=str(_stable_int(f"city:{city_name}", 1000, 9999)) if city_name else None,
            zip_code=zip_code,
            latitude=lat,
            longitude=lng,
            instagram_location_id=str(_stable_int(f"loc:{city_name}", 1000, 9999)) if city_name else None,
            has_threads_badge=rng.random() < 0.3,
            threads_badge_label="Threads" if rng.random() < 0.3 else None,
            has_broadcast_channel=rng.random() < 0.1,
            interop_messaging_user_fbid=str(_stable_int(f"fbid:{user_id}", 10**14, 10**15)) if rng.random() < 0.5 else None,
        )
