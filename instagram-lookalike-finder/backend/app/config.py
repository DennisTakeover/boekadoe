"""Central configuration, read from environment variables (.env supported)."""
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # --- Instagram ---
    instagram_username: str | None = None
    instagram_password: str | None = None
    instagram_totp_seed: str | None = None  # optional, for accounts with TOTP 2FA
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

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
