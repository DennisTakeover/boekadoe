from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from ..db import SessionLocal, get_db
from ..export import candidates_to_csv, export_to_google_sheets
from ..models import Candidate, Run
from ..pipeline.runner import MATCHMAKING_READY_STATUSES, run_discovery, run_matchmaking
from ..schemas import CandidateOut, CreateRunRequest, RunOut

router = APIRouter(prefix="/runs", tags=["runs"])


@router.post("", response_model=RunOut)
def create_run(payload: CreateRunRequest, background_tasks: BackgroundTasks, request: Request, db: Session = Depends(get_db)):
    seeds = [s.lstrip("@").strip() for s in payload.seeds if s.strip()]
    if not seeds:
        raise HTTPException(400, "Geef minstens één seed-account op.")

    run = Run(seeds=seeds, desired_results=payload.desired_results, status="queued")
    db.add(run)
    db.commit()
    db.refresh(run)

    adapter = request.app.state.instagram_adapter
    background_tasks.add_task(run_discovery, run.id, adapter, SessionLocal)
    return run


@router.get("", response_model=list[RunOut])
def list_runs(db: Session = Depends(get_db)):
    return db.query(Run).order_by(Run.created_at.desc()).limit(50).all()


@router.post("/{run_id}/matchmaking", response_model=RunOut)
def start_matchmaking(run_id: str, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """Phase 2: kick off AI niche classification / matchmaking reasoning over
    an already-discovered run's candidates. Separate from POST /runs (phase 1,
    discovery) so you can inspect the raw list — or re-run this phase alone —
    without re-hitting Instagram."""
    run = db.get(Run, run_id)
    if run is None:
        raise HTTPException(404, "Run niet gevonden")
    if run.status not in MATCHMAKING_READY_STATUSES:
        raise HTTPException(
            409,
            f"Run staat op status '{run.status}' — matchmaking kan pas nadat fase 1 (data ophalen) is afgerond.",
        )

    run.status = "matchmaking"
    db.commit()
    db.refresh(run)

    background_tasks.add_task(run_matchmaking, run.id, SessionLocal)
    return run


@router.get("/{run_id}", response_model=RunOut)
def get_run(run_id: str, db: Session = Depends(get_db)):
    run = db.get(Run, run_id)
    if run is None:
        raise HTTPException(404, "Run niet gevonden")
    return run


def _filtered_candidates(
    db: Session,
    run_id: str,
    min_followers: int | None,
    max_followers: int | None,
    countries: str | None,
    niches: str | None,
    business_only: bool,
    min_score: int | None,
) -> list[Candidate]:
    q = db.query(Candidate).filter(Candidate.run_id == run_id)
    if min_followers is not None:
        q = q.filter(Candidate.followers >= min_followers)
    if max_followers is not None:
        q = q.filter(Candidate.followers <= max_followers)
    if countries:
        wanted = {c.strip() for c in countries.split(",") if c.strip()}
        q = q.filter(Candidate.country.in_(wanted))
    if niches:
        wanted = {n.strip() for n in niches.split(",") if n.strip()}
        q = q.filter(Candidate.niche_primary.in_(wanted))
    if business_only:
        q = q.filter(Candidate.is_business.is_(True))
    if min_score is not None:
        q = q.filter(Candidate.similarity_score >= min_score)
    return q.order_by(Candidate.similarity_score.desc()).all()


@router.get("/{run_id}/candidates", response_model=list[CandidateOut])
def get_candidates(
    run_id: str,
    min_followers: int | None = None,
    max_followers: int | None = None,
    countries: str | None = Query(None, description="Comma-separated country names, e.g. Netherlands,Belgium"),
    niches: str | None = Query(None, description="Comma-separated niche labels"),
    business_only: bool = False,
    min_score: int | None = None,
    db: Session = Depends(get_db),
):
    if db.get(Run, run_id) is None:
        raise HTTPException(404, "Run niet gevonden")
    return _filtered_candidates(db, run_id, min_followers, max_followers, countries, niches, business_only, min_score)


@router.get("/{run_id}/export.csv")
def export_csv(
    run_id: str,
    min_followers: int | None = None,
    max_followers: int | None = None,
    countries: str | None = None,
    niches: str | None = None,
    business_only: bool = False,
    min_score: int | None = None,
    db: Session = Depends(get_db),
):
    if db.get(Run, run_id) is None:
        raise HTTPException(404, "Run niet gevonden")
    candidates = _filtered_candidates(db, run_id, min_followers, max_followers, countries, niches, business_only, min_score)
    csv_text = candidates_to_csv(candidates)
    return StreamingResponse(
        iter([csv_text]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="lookalikes_{run_id}.csv"'},
    )


@router.post("/{run_id}/export/sheets")
def export_sheets(run_id: str, spreadsheet_id: str, db: Session = Depends(get_db)):
    from ..config import settings

    if not settings.google_service_account_json:
        raise HTTPException(501, "Google Sheets export is niet geconfigureerd (GOOGLE_SERVICE_ACCOUNT_JSON ontbreekt).")
    if db.get(Run, run_id) is None:
        raise HTTPException(404, "Run niet gevonden")
    candidates = db.query(Candidate).filter(Candidate.run_id == run_id).order_by(Candidate.similarity_score.desc()).all()
    try:
        url = export_to_google_sheets(candidates, spreadsheet_id, settings.google_service_account_json)
    except RuntimeError as exc:
        raise HTTPException(501, str(exc)) from exc
    return {"url": url}
