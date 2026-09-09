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

from .base import BioLink, IGProfile, InstagramAdapter

logger = logging.getLogger(__name__)


class AiograpiAdapter(InstagramAdapter):
    def __init__(
        self,
        username: str,
        password: str | None = None,
        session_path: str = "data/ig_session.json",
        totp_seed: str | None = None,
        sessionid: str | None = None,
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
        self.sessionid = sessionid
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
                # A persisted session may still be valid — check with one cheap
                # authenticated call instead of unconditionally re-running the
                # full device login every restart. Every `accounts/login/` call
                # is itself a fresh "is this a known device?" check in
                # Instagram's eyes, so skipping it whenever possible is the
                # single best thing we can do to avoid re-triggering a
                # challenge on an account that's already working fine.
                await self.client.account_info()
                logger.info("Instagram session still valid, reusing it (no login call made)")
                return
            except Exception:
                logger.info("saved IG session missing/expired, logging in fresh")
        else:
            # Persist the device fingerprint (uuid/android_device_id/user-agent/...)
            # *before* attempting login, not just after a successful one. This is
            # generated randomly on Client() construction — if we only save it on
            # success, a failed/challenged login leaves nothing on disk, so the
            # next restart generates a brand new "device" from scratch and looks
            # like a never-before-seen phone to Instagram every single time,
            # which makes a login challenge all but guaranteed. Saving it up
            # front means every retry (even across restarts) presents as the
            # *same* device consistently trying again, which is what aiograpi's
            # own ChallengeRequired guidance asks for ("retry with the same
            # saved client settings, device identifiers, and proxy/IP").
            self.client.dump_settings(self.session_path)

        if self.sessionid:
            # Workaround for the "native_flow" device-login challenge (see
            # README): aiograpi/Instagram refuses to resolve that challenge
            # automatically no matter how the password-based accounts/login/
            # call is retried, because *that endpoint itself* is what triggers
            # the "unrecognized device" check. login_by_sessionid() sidesteps
            # it entirely by reusing a `sessionid` cookie lifted from an
            # already-authenticated, already-trusted browser session (log in
            # normally on instagram.com, complete whatever check appears
            # there, then copy the `sessionid` cookie into INSTAGRAM_SESSIONID)
            # — no accounts/login/ call, so no device challenge.
            await self.client.login_by_sessionid(self.sessionid)
            self.client.dump_settings(self.session_path)
            logger.info("Instagram login OK via sessionid, session saved to %s", self.session_path)
            return

        if not self.password:
            raise RuntimeError(
                "Geen INSTAGRAM_PASSWORD en geen INSTAGRAM_SESSIONID ingesteld — kan niet inloggen."
            )

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
            # chaining() returns the raw discover/chaining/ payload (a dict
            # with a "users" list of plain dicts), not parsed user objects —
            # despite what the pre-existing code here assumed.
            raw = await self.client.chaining(int(user_id))
            return [str(u["pk"]) for u in raw.get("users", []) if u.get("pk")]

        result = await self._throttled(call, label=f"chaining({user_id})", default=[])
        return result or []

    async def get_profile(self, user_id: str) -> IGProfile | None:
        async def call():
            info = await self.client.user_info(int(user_id))
            bio_links = [
                BioLink(url=str(link.url), title=link.title or "")
                for link in (getattr(info, "bio_links", None) or [])
                if getattr(link, "url", None)
            ]
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
                profile_pic_url_hd=str(info.profile_pic_url_hd) if getattr(info, "profile_pic_url_hd", None) else None,
                bio_links=bio_links,
                account_type=getattr(info, "account_type", None),
                category_name=getattr(info, "category_name", None),
                business_category_name=getattr(info, "business_category_name", None),
                business_contact_method=getattr(info, "business_contact_method", None),
                public_email=getattr(info, "public_email", None) or None,
                public_phone_country_code=getattr(info, "public_phone_country_code", None) or None,
                public_phone_number=getattr(info, "public_phone_number", None) or None,
                contact_phone_number=getattr(info, "contact_phone_number", None) or None,
                address_street=getattr(info, "address_street", None) or None,
                city_name=getattr(info, "city_name", None) or None,
                city_id=str(info.city_id) if getattr(info, "city_id", None) else None,
                zip_code=getattr(info, "zip", None) or None,
                latitude=getattr(info, "latitude", None),
                longitude=getattr(info, "longitude", None),
                instagram_location_id=str(info.instagram_location_id) if getattr(info, "instagram_location_id", None) else None,
                has_threads_badge=bool(getattr(info, "show_text_post_app_badge", False)),
                threads_badge_label=getattr(info, "text_post_app_badge_label", None) or None,
                has_broadcast_channel=bool(getattr(info, "broadcast_channel", None)),
                interop_messaging_user_fbid=getattr(info, "interop_messaging_user_fbid", None) or None,
            )

        return await self._throttled(call, label=f"user_info({user_id})")
