# Trip Planner

## Stack
- Frontend: React (Vite)
- Backend: FastAPI (Python)
- Database: SQLite via SQLAlchemy + Alembic (swappable for Postgres later)

## Directory layout
- `backend/` — FastAPI project
  - `main.py` — app entrypoint, exposes `GET /health`
  - `requirements.txt` — pinned dependencies
  - `venv/` — local virtual environment (gitignored)
- `frontend/` — React app scaffolded with Vite
  - `src/App.jsx` — root component

## Specs
- [Goal spec](specs/goal-spec.md)
- [Frontend spec](specs/frontend-spec.md)
- [Backend spec](specs/backend-spec.md)
- [API contract](specs/api-contract.md)
- [Acceptance matrix](specs/acceptance-matrix.md) — every acceptance criterion mapped to its tests; update it when a criterion or test changes

## Running locally
Backend:
```
cd backend
./venv/bin/uvicorn main:app --reload
```

Frontend:
```
cd frontend
npm install
npm run dev
```

## Testing
Backend: `cd backend && ./venv/bin/python -m pytest`
Frontend: `cd frontend && npm test`

CI (`.github/workflows/ci.yml`) runs both on every push and pull request.

## Deployment
- Both deploys run from `.github/workflows/ci.yml`, only on a push to `main`, and only after **both** `backend-tests` and `frontend-tests` pass.
- Backend: Azure App Service (`VaijTripPlanner`, F1 free tier), deployed by the `deploy-backend` job.
- Frontend: Vercel (root directory `frontend`), deployed by the `deploy-frontend` job via the Vercel CLI. Vercel's own Git auto-deploy is turned off in `frontend/vercel.json`. Needs GitHub secrets `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`. Production URL: https://trip-planner1-nu.vercel.app
- Frontend -> backend: build-time env var `VITE_API_URL` (backend origin, no `/api`; set in Vercel, see `frontend/.env.example`). Changing it needs a Vercel redeploy. Defaults to `http://127.0.0.1:8000` locally.
- Backend -> frontend: `CORS_ORIGINS` app setting on Azure (comma-separated origins, added to the localhost defaults in `backend/main.py`). Only the production Vercel domain is allowed; preview URLs are blocked.
- `frontend/vercel.json` rewrites all paths to `index.html` so `BrowserRouter` deep links (e.g. share links) work.

## Maps/weather
Conditions come from Open-Meteo (geocoding + current weather) — **no API key**. The map is an OpenStreetMap embed plus link, built in `backend/weather.py`; the frontend never calls an upstream API. Endpoint tests use the offline stub (`tests/conftest.py`), never the network.
