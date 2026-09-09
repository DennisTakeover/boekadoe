import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .adapters import build_adapter
from .config import settings
from .db import init_db
from .routers import runs

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    adapter = build_adapter()
    try:
        await adapter.login()
    except Exception:
        # Don't crash the whole server on a bad/expired Instagram session —
        # surface the failure per-run instead (resolve/chaining calls will
        # just come back empty and the run will end in status=error).
        logger.exception("Instagram adapter login failed at startup")
    app.state.instagram_adapter = adapter
    yield


app = FastAPI(title="Instagram Lookalike Finder", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(runs.router)


@app.get("/health")
def health():
    return {"ok": True}
