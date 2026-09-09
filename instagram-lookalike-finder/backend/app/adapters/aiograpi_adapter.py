"""Real Instagram adapter, backed by aiograpi's private-API client.

This talks to *unofficial* Instagram endpoints (the same ones behind the
mobile app's own "Suggested for you" carousel). Instagram can change or
block these at any time, and using them is against Instagram's Terms of
Service — that's a real, ongoing risk of the logged-in account being
flagged or banned. Mitigations applied here:

  * one persisted login session (`dump_settings`/`load_settings`) instead of
    logging in from scratch on every run, which is the single biggest
    trigger for challenges/bans;
  * a semaphore + randomized delay between every private-API call, so we
    never hammer the endpoint;
  * every call is wrapped so one failure (rate limit, challenge, deleted
    account) degrades gracefully instead of crashing the whole run.

If you need to swap in a different backend (e.g. InstaHarvest) later,
implement `InstagramAdapter` again and switch it in `app.main`.
"""
import asyncio
import logging
import random
from pathlib import Path

from .base import IGProfile, InstagramAdapter

logger = logging.getLogger(__name__)


class AiograpiAdapter(InstagramAdapter):
    def __init__(
        self,
        username: str,
        password: str,
        session_path: str = "data/ig_session.json",
        totp_seed: str | None = None,
        min_delay: float = 2.0,
        max_delay: float = 4.5,
        max_concurrency: int = 2,
    ):
        # Imported lazily so the rest of the app (and tests, via MockAdapter)
        # works fine even when the `aiograpi` package isn't installed.
        from aiograpi import Client

        self.username = username
        self.password = password
        self.session_path = Path(session_path)
        self.session_path.parent.mkdir(parents=True, exist_ok=True)
        self.totp_seed = totp_seed
        self.min_delay = min_delay
        self.max_delay = max_delay
        self._sem = asyncio.Semaphore(max_concurrency)
        self.client = Client()

    async def _throttled(self, coro_factory, *, label: str, default=None):
        """Run one private-API call under the concurrency limit + jittered delay."""
        async with self._sem:
            await asyncio.sleep(random.uniform(self.min_delay, self.max_delay))
            try:
                return await coro_factory()
            except Exception:
                logger.warning("Instagram call failed: %s", label, exc_info=True)
                return default

    async def login(self) -> None:
        if self.session_path.exists():
            try:
                self.client.load_settings(self.session_path)
            except Exception:
                logger.warning("could not load saved IG session, logging in fresh", exc_info=True)

        verification_code = ""
        if self.totp_seed:
            import pyotp

            verification_code = pyotp.TOTP(self.totp_seed).now()

        await self.client.login(self.username, self.password, verification_code=verification_code)
        self.client.dump_settings(self.session_path)
        logger.info("Instagram login OK, session saved to %s", self.session_path)

    async def resolve_user_id(self, username: str) -> str | None:
        clean = username.lstrip("@").strip()

        async def call():
            return str(await self.client.user_id_from_username(clean))

        return await self._throttled(call, label=f"resolve_user_id({clean})")

    async def get_similar_user_ids(self, user_id: str) -> list[str]:
        async def call():
            users = await self.client.chaining(int(user_id))
            return [str(u.pk) for u in users]

        result = await self._throttled(call, label=f"chaining({user_id})", default=[])
        return result or []

    async def get_profile(self, user_id: str) -> IGProfile | None:
        async def call():
            info = await self.client.user_info(int(user_id))
            return IGProfile(
                user_id=str(info.pk),
                username=info.username,
                full_name=info.full_name or "",
                followers=info.follower_count or 0,
                following=info.following_count or 0,
                posts=info.media_count or 0,
                biography=info.biography or "",
                external_url=str(info.external_url) if getattr(info, "external_url", None) else None,
                category=getattr(info, "category", None),
                is_verified=bool(info.is_verified),
                is_business=bool(getattr(info, "is_business", False)),
                is_private=bool(info.is_private),
                profile_pic_url=str(info.profile_pic_url) if getattr(info, "profile_pic_url", None) else None,
            )

        return await self._throttled(call, label=f"user_info({user_id})")
