"""End-to-end pipeline: seeds -> Instagram recommendations -> recommendation
graph -> dedupe/score -> enrich -> classify -> persist.

Runs as a fire-and-forget asyncio task kicked off by the POST /runs endpoint.
Progress is written straight to the Run row so the frontend can poll it. A
proper job queue (Celery/RQ + Redis) is the natural V2 upgrade once this
needs to survive process restarts or run across multiple workers — see
README "Known limitations".
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


def _set_progress(db: Session, run: Run, stage: str, current: int = 0, total: int = 0) -> None:
    run.progress_stage = stage
    run.progress_current = current
    run.progress_total = total
    db.commit()


async def run_pipeline(run_id: str, adapter: InstagramAdapter, session_factory) -> None:
    db = session_factory()
    try:
        run = db.get(Run, run_id)
        if run is None:
            logger.error("run %s disappeared before pipeline start", run_id)
            return

        run.status = "running"
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

        # 5. Classify country + niche and persist each candidate.
        niche_sem = asyncio.Semaphore(settings.niche_max_concurrency)
        _set_progress(db, run, "classifying accounts", 0, len(profiles))
        for i, user_id in enumerate(top_ids, start=1):
            profile = profiles.get(user_id)
            if profile is None:
                continue  # enrichment failed for this one; skip rather than store partial data

            country = classify_country(profile.biography, profile.external_url)
            niche = await classify_niche(profile.username, profile.full_name, profile.biography, profile.category, niche_sem)
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
                    similarity_score=score["similarity_score"],
                    seed_overlap=score["seed_overlap"],
                    found_via=score["found_via"],
                    country=country["country"],
                    country_confidence=country["confidence"],
                    country_signals=country["signals"],
                    niche_primary=niche["primary_niche"],
                    niche_secondary=niche["secondary_niche"],
                    is_influencer=niche["is_influencer"],
                    commercial_potential=niche["commercial_potential"],
                )
            )
            if i % 10 == 0:
                db.commit()
            _set_progress(db, run, "classifying accounts", i, len(profiles))

        run.status = "done"
        _set_progress(db, run, "done", len(profiles), len(profiles))
    except Exception as exc:  # noqa: BLE001 - a run failing must never crash the server
        logger.exception("pipeline failed for run %s", run_id)
        db.rollback()
        run = db.get(Run, run_id)
        if run is not None:
            run.status = "error"
            run.error_message = str(exc)
            db.commit()
    finally:
        db.close()
