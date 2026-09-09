"""Central configuration, read from environment variables (.env supported)."""
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # --- Instagram ---
    instagram_username: str | None = None
    instagram_password: str | None = None
    instagram_totp_seed: str | None = None  # optional, for accounts with TOTP 2FA
    # Alternative to username+password: a `sessionid` cookie value lifted from an
    # already-logged-in browser session. Sidesteps the private accounts/login/
    # endpoint entirely (see aiograpi_adapter.py) — the workaround for the
    # "native_flow" device-login challenge that a fresh password login can trigger.
    instagram_sessionid: str | None = None
    instagram_session_path: str = "data/ig_session.json"
    ig_min_delay_seconds: float = 2.0
    ig_max_delay_seconds: float = 4.5
    ig_max_concurrency: int = 2

    # Force the mock adapter even if IG credentials are set (handy for local dev/demo).
    use_mock_adapter: bool = False

    # --- Niche classification (Anthropic) ---
    anthropic_api_key: str | None = None
    niche_model: str = "claude-haiku-4-5-20251001"
    niche_max_concurrency: int = 5

    # --- Database ---
    database_url: str = "sqlite:///./data/app.db"

    # --- Export ---
    google_service_account_json: str | None = None

    # --- API ---
    cors_origins: str = "http://localhost:3000"
    # Shared-secret required (as `X-API-Key` header) on every request once the
    # tool is reachable from outside localhost (e.g. via a Cloudflare Tunnel
    # for the command center) — otherwise anyone with the URL could trigger
    # real Instagram scraping on the shared account and read scraped PII.
    # Leave empty to disable (local-only dev, e.g. `npm run dev` on localhost).
    api_key: str | None = None

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
