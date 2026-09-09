from .base import IGProfile, InstagramAdapter

__all__ = ["IGProfile", "InstagramAdapter"]


def build_adapter() -> InstagramAdapter:
    """Pick the adapter implementation from settings. This is the one place
    that decides real-Instagram vs. mock — nothing else should care."""
    from ..config import settings

    has_credentials = settings.instagram_username and (settings.instagram_password or settings.instagram_sessionid)
    if settings.use_mock_adapter or not has_credentials:
        from .mock_adapter import MockAdapter

        return MockAdapter()

    from .aiograpi_adapter import AiograpiAdapter

    return AiograpiAdapter(
        username=settings.instagram_username,
        password=settings.instagram_password,
        session_path=settings.instagram_session_path,
        totp_seed=settings.instagram_totp_seed,
        sessionid=settings.instagram_sessionid,
        min_delay=settings.ig_min_delay_seconds,
        max_delay=settings.ig_max_delay_seconds,
        max_concurrency=settings.ig_max_concurrency,
    )
