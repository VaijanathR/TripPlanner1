# Trip Planner

## Stack
- Frontend: React (Vite)
- Backend: FastAPI (Python)
- Database: a relational database (TBD — e.g. PostgreSQL or SQLite)

## Directory layout
- `backend/` — FastAPI project
  - `main.py` — app entrypoint, exposes `GET /health`
  - `requirements.txt` — pinned dependencies
  - `venv/` — local virtual environment (gitignored)
- `frontend/` — React app scaffolded with Vite
  - `src/App.jsx` — root component

## Specs
- [Frontend spec](specs/frontend-spec.md) — not yet written
- [Backend spec](specs/backend-spec.md) — not yet written
- [API contract](specs/api-contract.md) — not yet written

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
