from datetime import datetime

from pydantic import BaseModel, Field


class CreateRunRequest(BaseModel):
    seeds: list[str] = Field(..., min_length=1, description="Instagram usernames, with or without leading @")
    desired_results: int = Field(500, ge=1, le=5000)


class RunOut(BaseModel):
    id: str
    created_at: datetime
    seeds: list[str]
    desired_results: int
    status: str
    progress_stage: str
    progress_current: int
    progress_total: int
    error_message: str | None

    model_config = {"from_attributes": True}


class BioLinkOut(BaseModel):
    title: str
    url: str


class CandidateOut(BaseModel):
    username: str
    full_name: str
    followers: int
    following: int
    posts: int
    biography: str
    external_url: str | None
    category: str | None
    is_verified: bool
    is_business: bool
    is_private: bool
    profile_pic_url: str | None
    profile_pic_url_hd: str | None

    # Extra public data points, for matching beyond the basics.
    bio_links: list[BioLinkOut]
    account_type: int | None
    account_type_name: str | None
    category_name: str | None
    business_category_name: str | None
    business_contact_method: str | None
    public_email: str | None
    public_phone_country_code: str | None
    public_phone_number: str | None
    contact_phone_number: str | None
    address_street: str | None
    city_name: str | None
    city_id: str | None
    zip_code: str | None
    latitude: float | None
    longitude: float | None
    instagram_location_id: str | None
    has_threads_badge: bool
    threads_badge_label: str | None
    has_broadcast_channel: bool
    interop_messaging_user_fbid: str | None

    similarity_score: int
    seed_overlap: int
    found_via: list[str]
    country: str | None
    country_confidence: int
    niche_primary: str | None
    niche_secondary: str | None
    is_influencer: bool
    commercial_potential: float

    model_config = {"from_attributes": True}
