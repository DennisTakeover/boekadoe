"""Two manually-triggered phases:

  Phase 1 (run_discovery):  seeds -> Instagram recommendations -> recommendation
      graph -> dedupe/score -> enrich profiles -> country classify -> persist.
      No AI calls — just Instagram data. Ends with status "discovered".

  Phase 2 (run_matchmaking): AI niche classification / matchmaking reasoning
      (Claude) over an already-discovered run's candidates. Triggered
      separately (POST /runs/{id}/matchmaking") so you can inspect the raw
      list — or re-run this phase alone — without re-hitting Instagram.

Both run as fire-and-forget asyncio background tasks. Progress is written
straight to the Run row so the frontend can poll it. A proper job queue
(Celery/RQ + Redis) is the natural V2 upgrade once this needs to survive
process restarts or run across multiple workers — see README "Known
limitations".
"""
import asyncio
import logging

from sqlalchemy.orm import Session

from ..adapters.base import InstagramAdapter
from ..config import settings
from ..models import Candidate, Run
from .country import classify_country
from .enrichment import enrich_candidates
from .graph import build_recommendation_graph, rank_candidates, score_candidates
from .niche import classify_niche

logger = logging.getLogger(__name__)

ACCOUNT_TYPE_NAMES = {1: "personal", 2: "business", 3: "creator"}

# Statuses from which (re-)running matchmaking is allowed — must have
# candidates persisted already (i.e. discovery has completed at least once).
MATCHMAKING_READY_STATUSES = {"discovered", "done"}


def _set_progress(db: Session, run: Run, stage: str, current: int = 0, total: int = 0) -> None:
    run.progress_stage = stage
    run.progress_current = current
    run.progress_total = total
    db.commit()


async def run_discovery(run_id: str, adapter: InstagramAdapter, session_factory) -> None:
    """Phase 1: find + enrich candidates. Leaves niche/matchmaking fields
    unset (None) — call run_matchmaking() next to classify them with AI."""
    db = session_factory()
    try:
        run = db.get(Run, run_id)
        if run is None:
            logger.error("run %s disappeared before pipeline start", run_id)
            return

        run.status = "discovering"
        db.commit()

        # 1. Resolve seed usernames to user ids.
        _set_progress(db, run, "resolving seeds", 0, len(run.seeds))
        seed_ids: dict[str, str] = {}
        for i, seed in enumerate(run.seeds, start=1):
            uid = await adapter.resolve_user_id(seed)
            if uid:
                seed_ids[seed] = uid
            else:
                logger.warning("could not resolve seed @%s, skipping", seed)
            _set_progress(db, run, "resolving seeds", i, len(run.seeds))

        if not seed_ids:
            run.status = "error"
            run.error_message = "Geen van de opgegeven seed-accounts kon worden gevonden op Instagram."
            db.commit()
            return

        # 2. Pull Instagram's own recommendations per seed.
        _set_progress(db, run, "fetching recommendations", 0, len(seed_ids))
        seed_edges: dict[str, list[str]] = {}
        for i, (seed, uid) in enumerate(seed_ids.items(), start=1):
            seed_edges[seed] = await adapter.get_similar_user_ids(uid)
            _set_progress(db, run, "fetching recommendations", i, len(seed_ids))

        # 3. Build the recommendation graph and score every unique candidate.
        stats = build_recommendation_graph(seed_edges)
        scored = score_candidates(stats, total_seeds=len(seed_edges))
        top_ids = rank_candidates(scored, limit=run.desired_results)

        if not top_ids:
            run.status = "error"
            run.error_message = "Instagram gaf geen aanbevelingen terug voor deze seed-accounts."
            db.commit()
            return

        # 4. Enrich full profiles for the shortlist.
        _set_progress(db, run, "enriching profiles", 0, len(top_ids))
        profiles = await enrich_candidates(adapter, top_ids)
        _set_progress(db, run, "enriching profiles", len(profiles), len(top_ids))

        # 5. Classify country (a local heuristic, not AI) and persist each
        # candidate. Niche/matchmaking fields are left unset here — that's
        # phase 2's job (run_matchmaking), triggered separately.
        _set_progress(db, run, "saving candidates", 0, len(profiles))
        for i, user_id in enumerate(top_ids, start=1):
            profile = profiles.get(user_id)
            if profile is None:
                continue  # enrichment failed for this one; skip rather than store partial data

            country = classify_country(profile.biography, profile.external_url, profile.city_name)
            score = scored[user_id]

            db.add(
                Candidate(
                    run_id=run.id,
                    user_id=profile.user_id,
                    username=profile.username,
                    full_name=profile.full_name,
                    followers=profile.followers,
                    following=profile.following,
                    posts=profile.posts,
                    biography=profile.biography,
                    external_url=profile.external_url,
                    category=profile.category,
                    is_verified=profile.is_verified,
                    is_business=profile.is_business,
                    is_private=profile.is_private,
                    profile_pic_url=profile.profile_pic_url,
                    profile_pic_url_hd=profile.profile_pic_url_hd,
                    bio_links=[{"title": link.title, "url": link.url} for link in profile.bio_links],
                    account_type=profile.account_type,
                    account_type_name=ACCOUNT_TYPE_NAMES.get(profile.account_type),
                    category_name=profile.category_name,
                    business_category_name=profile.business_category_name,
                    business_contact_method=profile.business_contact_method,
                    public_email=profile.public_email,
                    public_phone_country_code=profile.public_phone_country_code,
                    public_phone_number=profile.public_phone_number,
                    contact_phone_number=profile.contact_phone_number,
                    address_street=profile.address_street,
                    city_name=profile.city_name,
                    city_id=profile.city_id,
                    zip_code=profile.zip_code,
                    latitude=profile.latitude,
                    longitude=profile.longitude,
                    instagram_location_id=profile.instagram_location_id,
                    has_threads_badge=profile.has_threads_badge,
                    threads_badge_label=profile.threads_badge_label,
                    has_broadcast_channel=profile.has_broadcast_channel,
                    interop_messaging_user_fbid=profile.interop_messaging_user_fbid,
                    similarity_score=score["similarity_score"],
                    seed_overlap=score["seed_overlap"],
                    found_via=score["found_via"],
                    country=country["country"],
                    country_confidence=country["confidence"],
                    country_signals=country["signals"],
                    # niche_primary/niche_secondary/is_influencer/commercial_potential
                    # stay at their column defaults (None/False/0.0) until
                    # run_matchmaking() classifies this candidate.
                )
            )
            if i % 10 == 0:
                db.commit()
            _set_progress(db, run, "saving candidates", i, len(profiles))

        run.status = "discovered"
        _set_progress(db, run, "discovered", len(profiles), len(profiles))
    except Exception as exc:  # noqa: BLE001 - a run failing must never crash the server
        logger.exception("discovery failed for run %s", run_id)
        db.rollback()
        run = db.get(Run, run_id)
        if run is not None:
            run.status = "error"
            run.error_message = str(exc)
            db.commit()
    finally:
        db.close()


async def run_matchmaking(run_id: str, session_factory) -> None:
    """Phase 2: AI niche classification / matchmaking reasoning (Claude) over
    an already-discovered run's candidates. No Instagram calls — safe to
    re-run on its own (e.g. after tweaking the prompt) without re-fetching
    anything."""
    db = session_factory()
    try:
        run = db.get(Run, run_id)
        if run is None:
            logger.error("run %s disappeared before matchmaking start", run_id)
            return

        candidates = db.query(Candidate).filter(Candidate.run_id == run_id).all()
        if not candidates:
            run.status = "error"
            run.error_message = "Geen kandidaten om te classificeren — draai eerst fase 1 (data ophalen)."
            db.commit()
            return

        run.status = "matchmaking"
        db.commit()

        niche_sem = asyncio.Semaphore(settings.niche_max_concurrency)
        _set_progress(db, run, "AI matchmaking", 0, len(candidates))
        for i, candidate in enumerate(candidates, start=1):
            niche = await classify_niche(
                candidate.username, candidate.full_name, candidate.biography, candidate.category, niche_sem
            )
            candidate.niche_primary = niche["primary_niche"]
            candidate.niche_secondary = niche["secondary_niche"]
            candidate.is_influencer = niche["is_influencer"]
            candidate.commercial_potential = niche["commercial_potential"]
            if i % 10 == 0:
                db.commit()
            _set_progress(db, run, "AI matchmaking", i, len(candidates))

        run.status = "done"
        _set_progress(db, run, "done", len(candidates), len(candidates))
    except Exception as exc:  # noqa: BLE001 - a run failing must never crash the server
        logger.exception("matchmaking failed for run %s", run_id)
        db.rollback()
        run = db.get(Run, run_id)
        if run is not None:
            run.status = "error"
            run.error_message = str(exc)
            db.commit()
    finally:
        db.close()
