# API Contract

Derived from [frontend-spec.md](frontend-spec.md) and
[backend-spec.md](backend-spec.md). Every endpoint the frontend spec
needs, with request shape and every response status code and its shape,
including error cases. No implementation code.

## Conventions

- All request/response bodies are `application/json`.
- All endpoints are rooted at `/api` (e.g. `/api/trips`), distinct from
  the existing unversioned `/health` check.
- IDs for Trip, Day, and Activity are integers (relational auto-increment
  PKs). `share_token` is a separate opaque, high-entropy string (e.g.
  UUID4) — never a sequential ID, per backend-spec.md.
- Dates are `"YYYY-MM-DD"`. Times are 24-hour `"HH:MM"` strings, no
  timezone (single timezone per trip is assumed — not specified
  elsewhere, flagged here as an open item). Timestamps (`created_at`,
  `updated_at`, `checked_at`) are ISO 8601 UTC.
- Every 4xx body has the shape:
  ```json
  { "error": { "code": "string", "message": "string", "fields": {} } }
  ```
  `fields` is present only for `validation_error` and maps field names
  (or, for array fields, an index-qualified path) to a specific message.
- `500` is reserved for genuine backend faults (e.g. lost DB connection).
  It is never used for an upstream maps/weather failure — see
  [Day conditions](#day-conditions-mapsweather) below, which is the one
  endpoint required to always resolve to `200`.
- Authentication: every endpoint requires a login token
  (`Authorization: Bearer <token>`, obtained from [Auth](#auth)) **except**
  the three login endpoints and the two public `/api/share/{share_token}`
  reads. A missing, malformed, tampered or expired token is
  `401 {"error": {"code": "unauthenticated", ...}}`, checked before the
  request body is validated. Every trip belongs to the user who created it;
  a trip (or a day, or a share-link request) belonging to someone else is
  answered exactly like one that doesn't exist — `404`, same body — so
  its existence is never revealed.

## Auth

Login tokens are short-lived (7 days) and stateless; "logging out" is the
client discarding its token. The token goes in an `Authorization` header,
not a cookie, because the frontend and API are on different domains.

### `POST /api/auth/register`
- **Request**: `{ "email": "a@b.co", "password": "at least 8 characters" }`.
  Email is trimmed and lower-cased; password is 8–128 characters.
- **201** → `{ "access_token": "...", "token_type": "bearer", "user": { "id": 1, "email": "a@b.co" } }`
- **409** `email_taken` — an account with this email exists.
- **422** `validation_error` — invalid email or password length.

### `POST /api/auth/login`
- **Request**: `{ "email": "...", "password": "..." }`
- **200** → same shape as register.
- **401** `invalid_credentials`, message "Incorrect email or password" —
  identical for an unknown email, a wrong password, and an account that has
  no password (Google-only), so the response never reveals which.

### `POST /api/auth/google`
Sign in with Google. The frontend obtains a Google **ID token** from Google
Identity Services and sends it here; the backend verifies it.
- **Request**: `{ "credential": "<Google ID token>" }`
- **200** → same shape as register. Creates an account on first use.
- **401** `invalid_google_token` — not signed by Google, wrong audience
  (not this app's client id), wrong issuer, expired, email not verified by
  Google, or the email is already tied to a *different* Google identity.
- **503** `google_unavailable` — Google sign-in isn't configured
  (`GOOGLE_CLIENT_ID` unset) or Google's signing keys couldn't be fetched.
- **Linking**: if an account with the same email already exists and was made
  with a password, the Google identity is linked to it (its trips are kept)
  **and its password is removed**. A password registration never proved the
  address was the registrant's, so keeping it would let someone who
  pre-registered a victim's email retain access after the real owner arrives.

### `GET /api/auth/me`
- **200** → `{ "id": 1, "email": "a@b.co" }`; **401** without a valid token.
  The frontend uses this to check a stored token on load.

## Trips

### `GET /api/trips`
List all trips, summary form (no nested days/activities).

- **200**
  ```json
  { "trips": [
    { "id": 1, "name": "Kyoto in Autumn",
      "start_date": "2026-11-03", "end_date": "2026-11-07",
      "day_count": 5, "created_at": "...", "updated_at": "..." }
  ] }
  ```
  `start_date`/`end_date` are `null` and `day_count` is `0` for a trip
  with no days yet. An empty trip list is `{ "trips": [] }` (still `200`
  — the frontend's empty state is a rendering decision, not an error).

### `POST /api/trips`
Create a trip.

- **Request**: `{ "name": "Kyoto in Autumn" }`
- **201** → full Trip Detail shape (see below), `"days": []`,
  `"share_token": null`.
- **422** — empty/missing `name`:
  ```json
  { "error": { "code": "validation_error", "message": "Trip name is required",
    "fields": { "name": "must not be empty" } } }
  ```

### `GET /api/trips/{trip_id}`
Fetch one trip with its full itinerary — this is what the Itinerary
Editor loads on open.

- **200**
  ```json
  { "id": 1, "name": "Kyoto in Autumn", "share_token": null,
    "created_at": "...", "updated_at": "...",
    "days": [
      { "id": 10, "trip_id": 1, "date": "2026-11-03",
        "location": "Kyoto, Japan", "notes": null, "order_index": 0,
        "activities": [
          { "id": 100, "day_id": 10, "title": "Fushimi Inari hike",
            "start_time": "08:00", "end_time": "11:00",
            "notes": null, "order_index": 0 }
        ] }
    ] }
  ```
  `days` and each day's `activities` are ordered by `order_index`.
  `days: []` for a trip with no days yet (the Editor's empty state).
- **404**:
  ```json
  { "error": { "code": "not_found", "message": "Trip not found" } }
  ```

### `DELETE /api/trips/{trip_id}`
Deletes the trip, cascading to its Days and Activities, and clears its
`share_token` in the same operation.

- **204** — no body.
- **404** — trip not found (same shape as above).

## Days (and their Activities)

A Day is always saved together with its full set of Activities in one
atomic request (backend-spec.md, business rule 6), so there is no
separate per-Activity endpoint.

### `POST /api/trips/{trip_id}/days`
Add a new, empty day (activities are added afterward via the `PUT`
below). Appended to the end of the trip's day order.

- **Request**: `{ "date": "2026-11-04", "location": "Kyoto, Japan", "notes": null }`
- **201** → the created Day, `"activities": []`.
- **404** — trip not found.
- **422** — missing `date` or `location`:
  ```json
  { "error": { "code": "validation_error", "message": "Invalid day",
    "fields": { "location": "must not be empty" } } }
  ```

### `PUT /api/trips/{trip_id}/days/{day_id}`
Full save of a day and its activities. `activities` is the **complete
desired state** for the day: entries with an existing `id` are updated,
entries with `id: null` are created, and any existing activity whose
`id` is absent from the array is deleted. This whole operation is one
transaction.

- **Request**:
  ```json
  { "date": "2026-11-04", "location": "Kyoto, Japan", "notes": "Bring umbrella",
    "activities": [
      { "id": 100, "title": "Fushimi Inari hike", "start_time": "08:00",
        "end_time": "11:00", "notes": null, "order_index": 0 },
      { "id": null, "title": "Lunch in Gion", "start_time": "12:00",
        "end_time": "13:00", "notes": null, "order_index": 1 }
    ] }
  ```
- **200** → the updated Day, with server-assigned `id`s for any newly
  created activities.
- **404** — trip or day not found.
- **422** — validation failure. In particular, this is where
  backend-spec.md's business rule 1 is enforced: **any** activity whose
  `end_time` precedes its `start_time` rejects the entire request, with
  no partial write.
  ```json
  { "error": { "code": "validation_error",
    "message": "One or more activities have an end time before their start time",
    "fields": { "activities[1].end_time": "must not be before start_time" } } }
  ```
  This mirrors the client-side check in frontend-spec.md (Save disabled
  before the request is sent) but is re-validated here since the client
  check cannot be trusted.

### `DELETE /api/trips/{trip_id}/days/{day_id}`
Deletes a day, cascading to its activities. Remaining days are **not**
renumbered server-side — `order_index` values are left as-is (they are
positions, not a dense 0..n-1 sequence the frontend depends on); the
frontend re-derives display order by sorting on the values returned by
the next `GET`.

- **204** — no body.
- **404** — trip or day not found.

### `PUT /api/trips/{trip_id}/days/reorder`
Reorder the days of a trip. Activity reorder-within-a-day is handled
via the `order_index` values sent in the `PUT` day endpoint above, so
no separate activity-reorder endpoint exists.

- **Request**: `{ "day_ids": [12, 10, 11] }` — the full set of the
  trip's day IDs, in the desired order.
- **200** → `{ "days": [Day, ...] }`, summary shape (no nested
  activities), in the new order.
- **404** — trip not found.
- **422** — `day_ids` doesn't exactly match the trip's current set of
  day IDs (missing, extra, or duplicate entries):
  ```json
  { "error": { "code": "validation_error",
    "message": "day_ids must match the trip's current days exactly",
    "fields": { "day_ids": "missing day 13, unexpected day 99" } } }
  ```

## Day conditions (maps/weather)

### `GET /api/trips/{trip_id}/days/{day_id}/conditions`
Fetches maps/weather conditions for one day's `location`. This is the
one endpoint required to **always resolve to `200`** when the day
itself exists — an upstream maps/weather outage or timeout is an
expected condition the frontend renders (the "unavailable" badge in
frontend-spec.md), never an exception that surfaces as a `5xx`.

- **200, upstream succeeded**:
  ```json
  { "status": "ok",
    "data": { "temperature_c": 18, "condition": "Partly cloudy",
              "map_url": "https://www.openstreetmap.org/?mlat=35.02&mlon=135.75#map=11/35.02/135.75",
              "map_embed_url": "https://www.openstreetmap.org/export/embed.html?bbox=...&layer=mapnik&marker=35.02%2C135.75" },
    "checked_at": "2026-09-18T01:30:00Z" }
  ```
  Only the fields the frontend needs are returned — the raw upstream
  payload and any credentials are never forwarded (backend-spec.md).
  Data comes from Open-Meteo (no API key): the day's `location` is
  geocoded, then the *current* temperature and weather are fetched.
  `map_url` is a link that opens the place on OpenStreetMap;
  `map_embed_url` is an iframe-embeddable OpenStreetMap view. Both are
  empty strings if unavailable, and the frontend omits the map then.
- **200, upstream failed or timed out** (network error, non-2xx from
  the provider, or the call exceeded its bounded timeout):
  ```json
  { "status": "unavailable", "checked_at": "2026-09-18T01:30:00Z" }
  ```
- **404** — the trip or day itself doesn't exist. This is a genuine
  client error and is distinct from "conditions unavailable": a
  missing day is not the same condition as a real day whose weather
  lookup failed.
  ```json
  { "error": { "code": "not_found", "message": "Day not found" } }
  ```

## Sharing

### `POST /api/trips/{trip_id}/share`
Generates a share link for the trip. Idempotent: if the trip already
has a `share_token`, the same token is returned rather than a new one
being minted.

- **Request**: none (empty body).
- **200**: `{ "share_token": "b3f2b6b0-1c2e-4a3e-9c31-9a2e3b7f8e10" }`
  (the frontend composes the full share URL from its own origin plus
  this token — the backend does not assume a public base URL).
- **404** — trip not found.

### `GET /api/share/{share_token}`
Public, unauthenticated, read-only fetch of a shared itinerary —
backs the Share View. No mutation is reachable through this or any
`share_token`-scoped endpoint.

- **200** — same shape as `GET /api/trips/{trip_id}`, minus `share_token`
  itself (a share link never re-exposes the token it was fetched with):
  ```json
  { "id": 1, "name": "Kyoto in Autumn", "created_at": "...", "updated_at": "...",
    "days": [ { "id": 10, "date": "2026-11-03", "location": "Kyoto, Japan",
                 "notes": null, "order_index": 0, "activities": [ ... ] } ] }
  ```
- **404** — the token is invalid, was never generated, or its trip was
  deleted (which clears the token per backend-spec.md). All three cases
  return the identical response, deliberately not distinguishing them
  (never leak which case it was):
  ```json
  { "error": { "code": "not_found", "message": "This itinerary is unavailable" } }
  ```
  This is exactly the message frontend-spec.md's Share View error state
  is written against.

### `GET /api/share/{share_token}/days/{day_id}/conditions`
Same contract as the authenticated conditions endpoint above — always
`200` with `{"status": "ok", ...}` or `{"status": "unavailable", ...}`
for a real day under a valid token.

- **200** — identical shapes to `GET /api/trips/{trip_id}/days/{day_id}/conditions`.
- **404** — invalid/expired token, or `day_id` does not belong to the
  trip behind that token. Same body shape as the share-fetch 404 above.

## Out of scope
- Password reset, email verification, changing email/password, and account
  deletion.
- Revoking a login token before it expires (tokens are stateless; logging
  out only discards the client's copy).
- Rate limiting / lockout on the login endpoints.
- Manually revoking a share link without deleting the trip —
  frontend-spec.md's flow only calls for *generating* a link, so no
  `DELETE /api/trips/{trip_id}/share` is specified here.
- Pagination/filtering on `GET /api/trips`.
- Rate limiting and abuse protection on the public `/api/share/*`
  endpoints.
- Timezone handling for `start_time`/`end_time` (currently assumed
  single-timezone-per-trip).
