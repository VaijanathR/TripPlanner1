import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from errors import register_error_handlers
from routers import conditions, days, sharing, trips

app = FastAPI(title="Trip Planner API")

# Extra allowed origins (e.g. the deployed Vercel frontend), comma-separated.
_extra_origins = [o.strip().rstrip("/") for o in os.getenv("CORS_ORIGINS", "").split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", *_extra_origins],
    allow_methods=["*"],
    allow_headers=["*"],
)

register_error_handlers(app)

app.include_router(trips.router)
app.include_router(days.router)
app.include_router(conditions.router)
app.include_router(sharing.trip_share_router)
app.include_router(sharing.public_share_router)


@app.get("/health")
def health():
    return {"status": "ok"}
