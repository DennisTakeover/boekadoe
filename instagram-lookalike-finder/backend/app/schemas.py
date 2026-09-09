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
