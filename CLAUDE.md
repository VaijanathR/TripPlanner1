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
- Backend: Azure App Service (`VaijTripPlanner`, F1 free tier), auto-deployed by the `deploy-backend` job in CI on push to `main`.
- Frontend: Vercel, root directory `frontend`, auto-deployed by Vercel's GitHub integration (no workflow file). Production URL: https://trip-planner1-nu.vercel.app
- Frontend -> backend: build-time env var `VITE_API_URL` (backend origin, no `/api`; set in Vercel, see `frontend/.env.example`). Changing it needs a Vercel redeploy. Defaults to `http://127.0.0.1:8000` locally.
- Backend -> frontend: `CORS_ORIGINS` app setting on Azure (comma-separated origins, added to the localhost defaults in `backend/main.py`). Only the production Vercel domain is allowed; preview URLs are blocked.
- `frontend/vercel.json` rewrites all paths to `index.html` so `BrowserRouter` deep links (e.g. share links) work.
