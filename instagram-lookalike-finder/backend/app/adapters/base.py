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
from dataclasses import dataclass


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
