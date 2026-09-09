import asyncio

from ..adapters.base import IGProfile, InstagramAdapter


async def enrich_candidates(adapter: InstagramAdapter, user_ids: list[str]) -> dict[str, IGProfile]:
    """Fetch full profiles for every candidate. Concurrency/rate-limiting to
    Instagram itself is the adapter's responsibility (see AiograpiAdapter),
    so this just fans the requests out and drops the ones that failed."""
    results = await asyncio.gather(*(adapter.get_profile(uid) for uid in user_ids))
    return {uid: profile for uid, profile in zip(user_ids, results) if profile is not None}
