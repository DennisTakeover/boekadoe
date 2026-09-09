import logging
import secrets
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

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


# --- API-key auth ---
# Required once this API is reachable from outside localhost (e.g. via the
# Cloudflare Tunnel that exposes it to the command center): anyone with the
# URL could otherwise trigger real Instagram scraping on the shared account
# and read scraped third-party personal data. /health and CORS preflight
# (OPTIONS) requests are exempt so uptime checks and browser calls still work.
_UNAUTHENTICATED_PATHS = {"/health", "/docs", "/redoc", "/openapi.json"}


@app.middleware("http")
async def require_api_key(request: Request, call_next):
    if settings.api_key and request.method != "OPTIONS" and request.url.path not in _UNAUTHENTICATED_PATHS:
        # Query param fallback: plain <a href> download links (CSV export)
        # can't attach a custom header, so accept it there too.
        provided = request.headers.get("x-api-key") or request.query_params.get("api_key")
        if not provided or not secrets.compare_digest(provided, settings.api_key):
            return JSONResponse({"detail": "Ongeldige of ontbrekende X-API-Key header."}, status_code=401)
    return await call_next(request)


@app.get("/health")
def health():
    return {"ok": True}
