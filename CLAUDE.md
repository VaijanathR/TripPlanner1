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
