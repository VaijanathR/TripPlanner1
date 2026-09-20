# Backend Spec

Derived from [goal-spec.md](goal-spec.md) and [frontend-spec.md](frontend-spec.md).
No implementation code — this defines the data model, business rules, and
non-functional requirements only.

## Data Model

### Trip
- `id` — primary key
- `name` — string, required
- `share_token` — string, nullable, unique; set when a share link is
  generated, cleared/unset if the link is ever revoked
- `created_at`, `updated_at`

A Trip's date range and day count, shown on the Trip List, are derived
from its Days rather than stored redundantly.

### Day
- `id` — primary key
- `trip_id` — foreign key → Trip, required
- `date` — date, required
- `location` — string, required (place name or coordinates; used to look
  up maps/weather data)
- `notes` — text, optional
- `order_index` — integer, required (explicit display order, independent
  of `date`, to support reordering)
- `created_at`, `updated_at`

### Activity
- `id` — primary key
- `day_id` — foreign key → Day, required
- `title` — string, required
- `start_time` — time, required
- `end_time` — time, required
- `notes` — text, optional
- `order_index` — integer, required (order within the day)
- `created_at`, `updated_at`

### Relationships
- Trip has many Days (`Trip 1 —* Day`), cascade delete.
- Day has many Activities (`Day 1 —* Activity`), cascade delete.

## Business Rules

1. **An Activity's `end_time` must not precede its `start_time`.**
   Concretely: whenever a Day is saved along with its Activities, every
   Activity in that payload is checked, and if any Activity's `end_time`
   is before its `start_time`, the entire save is rejected — no partial
   write occurs. This mirrors the client-side check in
   [frontend-spec.md](frontend-spec.md), but is enforced server-side
   independently, since the client check alone cannot be trusted.
2. A Day must reference an existing Trip; an Activity must reference an
   existing Day. Orphaned Days or Activities cannot exist.
3. A Trip's `name` must be non-empty.
4. Deleting a Trip cascades to delete all of its Days and their
   Activities, and invalidates its share link (`share_token` is cleared)
   in the same operation.
5. `share_token` is only generated on explicit request (the "Get share
   link" action) — it is not created automatically when a Trip is made.
6. Saving a Day together with its Activities (create, update, delete,
   and reorder of Activities within that Day) is atomic: all of it
   commits, or none of it does.
7. Reordering Days within a Trip, or Activities within a Day, updates
   `order_index` values in place — it never requires deleting and
   recreating records.

## Non-Functional Requirements

### Share links
- Read-only and require no login: accessing a Trip via its
  `share_token` never exposes create/update/delete capability for any
  Trip, Day, or Activity, regardless of who holds the link.
- `share_token` must be high-entropy and unguessable (e.g. a random
  UUID4 or equivalent) — never a sequential/guessable ID — so links
  can't be enumerated.
- A share link stops working the moment its Trip is deleted or its
  `share_token` is cleared; there is no grace period.

### Maps/weather integration
- The maps/weather API key is read from server-side configuration
  (environment variable / secret store) only. It is never included in
  any request or response body returned to a client, and the frontend
  never calls the upstream maps/weather API directly — only the backend
  does.
- Calls to the upstream maps/weather API use a bounded timeout (in the
  low single-digit seconds) so a slow or hanging upstream can never
  block or fail the Trip/Day/Activities read path.
- An upstream failure or timeout degrades gracefully: the affected
  Day's maps/weather data is reported with an explicit "unavailable"
  status in the response rather than causing the whole request to
  error out. This is what lets the frontend render its "unavailable"
  badge per [frontend-spec.md](frontend-spec.md) instead of a blank
  panel or a crash.
- Upstream responses are not passed through verbatim — the backend
  returns only the fields the frontend needs (e.g. condition, temperature,
  a static map reference), never the raw upstream payload or any
  credentials.

### Data integrity
- Backed by a relational database with foreign-key constraints between
  Trip → Day → Activity and cascading deletes as described above.
- Multi-row writes (a Day saved with its Activities) run inside a single
  transaction.

### Validation
- Business rule 1 (end time ≥ start time) is enforced server-side on
  every write, independent of any client-side check.
- Validation failures, not-found conditions, and server errors are
  distinguishable outcomes so the frontend's inline-error and retry
  behavior (per frontend-spec.md) has something consistent to react to.
  Exact status codes and response shapes belong in
  `specs/api-contract.md` (not yet written).

## Accounts and access

Configuration is read from the environment only: `JWT_SECRET` (required,
at least 32 characters, signs login tokens) and `GOOGLE_CLIENT_ID`
(optional; enables Google sign-in). Endpoint shapes are in
`specs/api-contract.md` ("Auth").

### Acceptance criteria
- Every `/api` endpoint except register, login, Google sign-in and the two
  public share reads rejects a request with no valid login with `401`, before
  validating its body.
- A forged, tampered, unsigned, expired, or claim-less login token is
  rejected, as is a token for a user that no longer exists.
- A user can only read, change, delete, or create share links for their own
  trips. Another user's trip, day, or conditions request is answered exactly
  like a missing one (`404`, identical body). Listing trips returns only the
  caller's.
- The same trip's own write endpoint rejects a caller with no login and
  changes nothing, while its share link stays readable with no login.
- Passwords are stored only as salted `scrypt` hashes, and are never
  returned. Registering a duplicate email (any letter case) is `409`; a
  password shorter than 8 or longer than 128 characters is `422`.
- A login for an unknown email, a wrong password, and a password-less
  (Google-only) account are indistinguishable.
- Google sign-in accepts only an ID token that is RS256-signed by Google,
  issued for this app's client id, from Google's issuer, unexpired, and whose
  email Google marked verified. Algorithm-confusion (HS256) tokens are refused.
- Google sign-in for an email that has a password account links it, keeps its
  trips, and removes the password; for an email tied to a different Google
  identity it is refused.
- The app refuses to start without a sufficiently long `JWT_SECRET`.
- Trips that existed before accounts were introduced are kept, owned by a
  placeholder account that nobody can sign in to.

## Rate limiting

The public sign-in endpoints (`/api/auth/login`, `/api/auth/register`,
`/api/auth/google`) are rate limited; the rules and the `429` response are in
`specs/api-contract.md` ("Rate limits"). Attempts are recorded in the database
(a table for attempt counters), so limits survive a restart. Only hashed keys are
stored — a SHA-256 of the email and of the caller address — never raw emails or
addresses.

### Acceptance criteria
- Each of the four limits (R1 to R4) is enforced, and each is independent of the
  others.
- A lock ends once the window has passed (sliding window).
- During a lock, the correct password is refused.
- An unknown email and a registered email are treated identically.
- One caller's failures do not lock a different caller address out of the same
  email (R1 is per email *and* address).
- Counters survive a restart of the application.
- Raw emails and raw caller addresses are never stored.
- Old attempt records are purged automatically.
- Supplying a forged earlier `X-Forwarded-For` entry does not let a caller evade
  a limit.
- If the attempts table cannot be read or written, the request proceeds (the
  limit is briefly not enforced) and the problem is logged.

## Destinations and guides

Sources are free and need no API key, and are called only from
`backend/upstream.py`: Open-Meteo (geocoding), Wikipedia (photos, blurbs) and
Wikidata (notable places). Endpoint shapes are in `specs/api-contract.md`
("Destinations").

### Acceptance criteria
- Place search returns ranked candidates, narrowed strictly by country and
  boosted by state; input is validated; a geocoder outage is a `503`.
- Place search is forgiving about how things are typed: country as a name, prefix,
  ISO code or common alias ("USA", "U.S.A.", "America", "UK"); state as a name or a
  US/Canadian abbreviation ("NV"); a run-together city ("lasvegas") is found with at
  most one extra lookup; when nothing matches, the same-named places elsewhere are
  offered as alternatives (never a silent dead end).
- A trip's destination is stored from the geocoder's answer for the chosen id —
  never from client-sent names or coordinates — and only the trip's owner can set,
  change, clear or read the guide for it.
- A trip can be created with its destination in one step. It is all or nothing: if
  the destination can't be set, no trip is created.
- A guide has photos of the city, state and country, popular places in the city
  (≤15 km) and around it (15–30 km), and things to do derived from the places'
  types.
- Each source fails independently: an outage or rate limit marks only its own
  section `unavailable`; the rest of the guide and the request still succeed.
- A photo is used only if it is about the right place: a same-named place elsewhere
  is rejected by location, a disambiguation page is skipped, a state page must
  describe a region, and a flag or map is never the country photo.
- A place listed under several types appears once, under its most specific theme;
  places without an English name are dropped; places are ranked by how widely they
  are covered.
- A guide is built once, in the background, stored in the database, shared by
  trips to the same place, served without touching the sources while fresh
  (30 days), rebuilt in the background when stale (old content still served),
  built at most once at a time, retried if a build never finished, and marked
  `failed` (and retried next request) if every source failed or the build crashed.
- The shared HTTP helper identifies the app with a `User-Agent`, tells "not found"
  from "rate limited" from other errors, retries a gateway error once (never a
  429), and turns network failures and non-JSON bodies into a typed error.
- The trip list shows each trip's destination and, once its guide has one, a cover
  photo; a shared trip shows its destination but never its share token.
- Existing trips survive the migration with no destination.

## Data persistence

The database location is configuration: `DATABASE_URL` (default
`sqlite:///./trip_planner.db`, right for development and tests). Production must
point it at storage that outlives a deploy; on Azure App Service that is `/home`
(`sqlite:////home/data/trip_planner.db`), because the app itself runs from a
per-deployment temporary folder that is discarded on every deploy.

### Acceptance criteria
- With no configuration the database is a local file, so development and tests
  need no setup; an empty `DATABASE_URL` counts as unset.
- `DATABASE_URL` moves the database, and its folder is created if missing (a fresh
  persistent volume has none).
- Migrations run against the same configured database as the app, never the local
  default, and leave the default untouched.
- Data written by one process is present for the next one (a restart or deploy).
- Foreign keys are enforced on the configured database.

## Out of scope for this spec
- Exact endpoint routes, request/response schemas, and status codes —
  covered in `specs/api-contract.md` (not yet written).
- Password reset, email verification, token revocation, and rate limiting
  on login (see api-contract.md "Out of scope").
- Choice of specific relational database engine.
