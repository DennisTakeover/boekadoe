import uuid
from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def _uuid() -> str:
    return uuid.uuid4().hex


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Run(Base):
    """One 'find lookalikes' job: a set of seed accounts + its resulting candidates."""

    __tablename__ = "runs"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    seeds: Mapped[list] = mapped_column(JSON)  # list[str] of seed usernames as entered
    desired_results: Mapped[int] = mapped_column(Integer, default=500)

    # queued -> running -> done | error
    status: Mapped[str] = mapped_column(String, default="queued")
    progress_stage: Mapped[str] = mapped_column(String, default="")
    progress_current: Mapped[int] = mapped_column(Integer, default=0)
    progress_total: Mapped[int] = mapped_column(Integer, default=0)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    candidates: Mapped[list["Candidate"]] = relationship(back_populates="run", cascade="all, delete-orphan")


class Candidate(Base):
    """A single lookalike account found for a run, enriched + scored + classified."""

    __tablename__ = "candidates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_id: Mapped[str] = mapped_column(ForeignKey("runs.id"))
    run: Mapped[Run] = relationship(back_populates="candidates")

    user_id: Mapped[str] = mapped_column(String, index=True)
    username: Mapped[str] = mapped_column(String, index=True)
    full_name: Mapped[str] = mapped_column(String, default="")
    followers: Mapped[int] = mapped_column(Integer, default=0)
    following: Mapped[int] = mapped_column(Integer, default=0)
    posts: Mapped[int] = mapped_column(Integer, default=0)
    biography: Mapped[str] = mapped_column(Text, default="")
    external_url: Mapped[str | None] = mapped_column(String, nullable=True)
    category: Mapped[str | None] = mapped_column(String, nullable=True)
    is_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    is_business: Mapped[bool] = mapped_column(Boolean, default=False)
    is_private: Mapped[bool] = mapped_column(Boolean, default=False)
    profile_pic_url: Mapped[str | None] = mapped_column(String, nullable=True)
    profile_pic_url_hd: Mapped[str | None] = mapped_column(String, nullable=True)

    # Extra public data points (all from Instagram's own profile endpoint) —
    # kept alongside the basics above so exports/matching have everything
    # public that's available per account, not just the bare minimum.
    bio_links: Mapped[list] = mapped_column(JSON, default=list)  # list[{"title": str, "url": str}]
    account_type: Mapped[int | None] = mapped_column(Integer, nullable=True)  # 1=personal, 2=business, 3=creator
    account_type_name: Mapped[str | None] = mapped_column(String, nullable=True)
    category_name: Mapped[str | None] = mapped_column(String, nullable=True)
    business_category_name: Mapped[str | None] = mapped_column(String, nullable=True)
    business_contact_method: Mapped[str | None] = mapped_column(String, nullable=True)
    public_email: Mapped[str | None] = mapped_column(String, nullable=True)
    public_phone_country_code: Mapped[str | None] = mapped_column(String, nullable=True)
    public_phone_number: Mapped[str | None] = mapped_column(String, nullable=True)
    contact_phone_number: Mapped[str | None] = mapped_column(String, nullable=True)
    address_street: Mapped[str | None] = mapped_column(String, nullable=True)
    city_name: Mapped[str | None] = mapped_column(String, nullable=True)
    city_id: Mapped[str | None] = mapped_column(String, nullable=True)
    zip_code: Mapped[str | None] = mapped_column(String, nullable=True)
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    instagram_location_id: Mapped[str | None] = mapped_column(String, nullable=True)
    has_threads_badge: Mapped[bool] = mapped_column(Boolean, default=False)
    threads_badge_label: Mapped[str | None] = mapped_column(String, nullable=True)
    has_broadcast_channel: Mapped[bool] = mapped_column(Boolean, default=False)
    interop_messaging_user_fbid: Mapped[str | None] = mapped_column(String, nullable=True)

    # Recommendation-graph derived fields
    similarity_score: Mapped[int] = mapped_column(Integer, default=0)
    seed_overlap: Mapped[int] = mapped_column(Integer, default=0)
    found_via: Mapped[list] = mapped_column(JSON, default=list)  # list[str] seed usernames

    # Country confidence
    country: Mapped[str | None] = mapped_column(String, nullable=True)
    country_confidence: Mapped[int] = mapped_column(Integer, default=0)
    country_signals: Mapped[list] = mapped_column(JSON, default=list)

    # AI niche classification
    niche_primary: Mapped[str | None] = mapped_column(String, nullable=True)
    niche_secondary: Mapped[str | None] = mapped_column(String, nullable=True)
    is_influencer: Mapped[bool] = mapped_column(Boolean, default=False)
    commercial_potential: Mapped[float] = mapped_column(Float, default=0.0)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
