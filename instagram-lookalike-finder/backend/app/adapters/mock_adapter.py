"""Deterministic, network-free adapter for local demos and tests.

Generates a fake but stable recommendation graph and fake profiles so the
whole pipeline (graph building, scoring, country/niche classification,
export) can be exercised without touching Instagram or requiring
credentials. Enable with USE_MOCK_ADAPTER=true.
"""
import hashlib
import random

from .base import IGProfile, InstagramAdapter

_BIOS = [
    "Mama van twee | Amsterdam \U0001f1f3\U0001f1f1 | boekjes & knutselen",
    "Papa blog | Antwerpen \U0001f1e7\U0001f1ea | dagjes uit met kids",
    "Kinderboeken en voorlezen \U0001f4da | www.example.nl",
    "Lifestyle & parenting | Rotterdam",
    "Fitness coach | www.example.com",
    "Mode & beauty tips ✨",
]


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
            is_business=rng.random() < 0.4,
            is_private=rng.random() < 0.1,
            profile_pic_url=None,
        )
