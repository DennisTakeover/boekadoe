"""Instagram adapter interface.

The rest of the app (pipeline, routers) only ever talks to this interface —
never to aiograpi/instagrapi/InstaHarvest directly. That keeps the private,
unofficial, and change-prone Instagram integration swappable behind one seam:

    our_app.instagram.get_similar(username)

instead of scattering `aiograpi.chaining(...)` calls everywhere. See
AiograpiAdapter for the real implementation and MockAdapter for a
network-free stand-in used in tests and local demos.
"""
from abc import ABC, abstractmethod
from dataclasses import dataclass, field


@dataclass
class BioLink:
    url: str
    title: str = ""


@dataclass
class IGProfile:
    user_id: str
    username: str
    full_name: str = ""
    followers: int = 0
    following: int = 0
    posts: int = 0
    biography: str = ""
    external_url: str | None = None
    category: str | None = None
    is_verified: bool = False
    is_business: bool = False
    is_private: bool = False
    profile_pic_url: str | None = None

    # --- Extra public data points (all exposed by Instagram's own profile
    # endpoint, not guessed) — used to enrich matching beyond the basics. ---
    profile_pic_url_hd: str | None = None
    bio_links: list[BioLink] = field(default_factory=list)

    # Account type: 1=personal, 2=business, 3=creator (Instagram's own enum).
    account_type: int | None = None
    category_name: str | None = None  # e.g. "Blogger" — often more specific than `category`
    business_category_name: str | None = None
    business_contact_method: str | None = None

    # Public contact info (only present when the account chose to publish it).
    public_email: str | None = None
    public_phone_country_code: str | None = None
    public_phone_number: str | None = None
    contact_phone_number: str | None = None

    # Public location info (only present for business/creator accounts with
    # an address set) — a much stronger country/city signal than bio text.
    address_street: str | None = None
    city_name: str | None = None
    city_id: str | None = None
    zip_code: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    instagram_location_id: str | None = None

    # Remaining public fields from Instagram's profile endpoint (low-signal
    # for matching, but included so the API exposes everything public IG
    # gives us — command center callers can decide what to use).
    has_threads_badge: bool = False  # show_text_post_app_badge
    threads_badge_label: str | None = None  # text_post_app_badge_label
    has_broadcast_channel: bool = False  # broadcast_channel non-empty
    interop_messaging_user_fbid: str | None = None


class InstagramAdapter(ABC):
    @abstractmethod
    async def login(self) -> None:
        """Authenticate (or load a persisted session). Called once at startup."""

    @abstractmethod
    async def resolve_user_id(self, username: str) -> str | None:
        """Username -> numeric Instagram user id, or None if not found."""

    @abstractmethod
    async def get_similar_user_ids(self, user_id: str) -> list[str]:
        """Instagram's own 'similar accounts' recommendations for user_id
        (the discover/chaining endpoint behind the 'Suggested for you'
        carousel), best match first. This is the seed of the whole pipeline —
        we are not inventing similarity, Instagram already computed it."""

    @abstractmethod
    async def get_profile(self, user_id: str) -> IGProfile | None:
        """Full profile enrichment for one candidate."""
