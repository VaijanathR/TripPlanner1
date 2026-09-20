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
Frontend: `cd frontend && npm test` (about 20 minutes on WSL because every test file starts slowly; run single files with `npx vitest run <file>` while working, the full suite before pushing)

CI (`.github/workflows/ci.yml`) runs both on every push and pull request.

## Deployment
- Both deploys run from `.github/workflows/ci.yml`, only on a push to `main`, and only after **both** `backend-tests` and `frontend-tests` pass.
- Backend: Azure App Service (`VaijTripPlanner`, F1 free tier), deployed by the `deploy-backend` job.
- Frontend: Vercel (root directory `frontend`), deployed by the `deploy-frontend` job via the Vercel CLI. Vercel's own Git auto-deploy is turned off in `frontend/vercel.json`. Needs GitHub secrets `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`. Production URL: https://trip-planner1-nu.vercel.app
- Frontend -> backend: build-time env var `VITE_API_URL` (backend origin, no `/api`; see `frontend/.env.example`). In CI it comes from the **GitHub repo variable** `VITE_API_URL`, not from Vercel: the copy stored in the Vercel project is a sensitive variable, and `vercel pull` turns those into the literal text `[SENSITIVE]`. Changing it needs a new deploy (push to `main`). Defaults to `http://127.0.0.1:8000` locally.
- Backend -> frontend: `CORS_ORIGINS` app setting on Azure (comma-separated origins, added to the localhost defaults in `backend/main.py`). Only the production Vercel domain is allowed; preview URLs are blocked.
- `frontend/vercel.json` rewrites all paths to `index.html` so `BrowserRouter` deep links (e.g. share links) work.

## Maps/weather
Conditions come from Open-Meteo (geocoding + current weather) — **no API key**. The map is an OpenStreetMap embed plus link, built in `backend/weather.py`; the frontend never calls an upstream API. Endpoint tests use the offline stub (`tests/conftest.py`), never the network.

## Accounts
Email + password and Google sign-in. Every `/api` route needs a login token (`Authorization: Bearer`) except register/login/google and the two public `/api/share/*` reads; a user only reaches their own trips (someone else's looks like a missing one). `backend/auth.py` holds the hashing, tokens and Google verification; `backend/tests/test_access_control.py` fails if any new route is left open, so a new public route must be added to its allowlist deliberately.
- Backend env: `JWT_SECRET` (required, >= 32 chars — the app refuses to start without it; a rotation logs everyone out) and `GOOGLE_CLIENT_ID` (optional; Google sign-in returns 503 without it). Both are Azure app settings; tests set a throwaway `JWT_SECRET` in `tests/conftest.py`.
- Frontend env: `VITE_GOOGLE_CLIENT_ID` (public; from the GitHub repo variable of the same name in CI). Unset = the Google button is hidden.
- Login, sign-up and Google sign-in are rate limited (`backend/ratelimit.py`, table `auth_attempts`, rules R1–R4 in the backend spec; refusals are `429 too_many_attempts`; it fails open if its table is unreadable). The caller address is the last `X-Forwarded-For` entry (verified live on Azure).
- Not built: password reset, email verification, token revocation.

## Destinations and guides
A trip can have a destination (country / state / city, picked from geocoder candidates). The Editor's **Discover** tab shows photos of the city, state and country, popular places in (≤15 km) and around (15–30 km) the city, and things to do derived from place types; places can be added to a day. **No API keys**: Open-Meteo geocoding (`backend/geocoding.py`), Wikipedia (photos, blurbs) and Wikidata (places, ranked by sitelinks) via `backend/guide.py`; all HTTP goes through `backend/upstream.py`.
- **Slow and rate-limited by nature.** Wikidata `around` queries: 15 km ≈ 3.5 s, 25 km ≈ 15 s, 40 km+ is dropped by the gateway (502). Wikimedia answers 429 if you burst or omit a descriptive `User-Agent` (set in `upstream.py`). So a guide is built once **in a background thread**, stored in the `destination_guides` table (shared by every trip to that place, fresh for 30 days), and the frontend polls `GET /api/trips/{id}/guide` while it is `building`. Each section (`photos`, `places_city`, `places_around`) fails on its own.
- Tests never touch the network: `tests/conftest.py` makes any un-faked upstream call fail like an outage and runs the "background" build inline; canned responses live in `tests/fakes.py`.
- Wikidata class ids in `guide.TYPE_THEME` were checked against their labels; add a type by adding its QID to that map (and verify the label).
- Photos are credited (links to the Commons file page / Wikipedia). Guide data is Wikipedia-only English.
- A trip is created with its destination from the Trip List (name and place are both required there): `POST /api/trips` takes an optional `geoname_id` (looked up first, so a failed lookup creates no trip). The Create trip form and the Editor's picker share `components/PlaceSearch.jsx`.
- Frontend: `hooks/useGuide.js` (polling), `components/DestinationPicker.jsx`, `DestinationGuide.jsx`, `PlaceCard.jsx`, `Photo.jsx` (gradient fallback for broken images). "Add to itinerary" refuses days with unsaved edits (`DayEditor` reports dirtiness via `onDirtyChange`).
- Dev: the repo is on `/mnt/d`, where Vite's file watcher doesn't see edits — restart the dev server after changes (details in memory).

## Imagery
Real, licensed travel photos (flight, boat, road, train, nature) instead of drawn scenery. Spec: `specs/frontend-spec.md` "Imagery".
- Files in `frontend/public/photos/`; every photo's title, author, licence, source and what was changed is in `frontend/src/data/photos.json`, which also says which photo does which job (banner, login, per-trip set, strip). `src/photos/photos.js` does the choosing (banner rotates per visit and never repeats twice in a row; a trip's set photo comes from a hash of its id, so it is stable).
- Components: `HeroPhoto.jsx` (photo + scrim, disappears if it can't load so the gradient shows), `TravelStrip.jsx`, `SiteFooter.jsx` ("Photo credits" link on every route, in `App.jsx`), `pages/Credits.jsx` (public `/credits`).
- **Adding or changing a photo:** only public domain, CC0 or CC BY (never share-alike/NC/ND); add the file and its manifest entry together. `photos.test.js` fails on a disallowed licence, a missing or unlisted file, or a size over the limit (banner ≤ 350 KB, every other photo ≤ 150 KB). Only the banner loads eagerly; everything else is `loading="lazy"`.
- Decorative photos use empty `alt`; destination photos (from Wikipedia) keep descriptive text.

## Working agreement
- Never edit `specs/` without the user's approval: discuss a plan → the user approves → show the exact spec wording → write it (its own commit) → code strictly to the spec. New enhancements are proposed first.
- Commit locally, show the result (screenshots in light and dark for UI work), and push only when the user says so: every push to `main` redeploys both apps.
- Ask before creating accounts or data on production, using Azure/Kudu credentials, or changing production settings. `JWT_SECRET` handling is parked (no change without the user's go-ahead).
- When done or needing attention, run `~/bin/notify-user.sh "<title>" "<message>"`.

## Database persistence (important on Azure)
`backend/database.py` reads `DATABASE_URL` (default `sqlite:///./trip_planner.db`); `alembic/env.py` honours the same variable. **On Azure the app runs from a per-deployment temp folder, so with the default every deploy erased all users and trips** (a plain restart kept them). Production must set the app setting `DATABASE_URL=sqlite:////home/data/trip_planner.db` (`/home` is a persistent CIFS volume; SQLite there was tested: journal mode `delete`, 3 concurrent writers fine, ~85 ms per commit). The folder is created automatically. For real durability at scale, move to a hosted Postgres (SQLAlchemy code is portable; migrations use batch mode).

