# Acceptance Matrix

Every acceptance criterion in the project, mapped to the test(s) that prove it.

- **Backend tests** are named by function, e.g. `test_share_link_read_succeeds_and_write_is_rejected` (all under `backend/tests/`).
- **Frontend tests** are named by their exact `it("…")` title, in the file shown (all under `frontend/src/`).
- A criterion marked **by design** cannot occur in the current app; the reason is given.
- Not every test here has been mutation-checked. The behaviours that matter most were (the code was deliberately broken and the test confirmed to fail); those are listed under [Mutation checks](#mutation-checks). The rest rest on ordinary review.

Sources: the Step 10 table (below), [goal-spec.md](goal-spec.md), [backend-spec.md](backend-spec.md) ("Accounts and access"), [frontend-spec.md](frontend-spec.md).

## A. Step 10 acceptance-criteria table

| # | Criterion | Required test type | Test(s) | Covered |
|---|---|---|---|---|
| A1 | A Day cannot be saved with an end time before its start time | Unit: call the validation function directly with a bad time pair, assert the expected error | `test_validate_activities_raises_when_end_time_before_start_time` (unit, asserts 422 / `validation_error` / field name); `test_validate_activities_does_not_raise_when_end_time_after_start_time` (unit, the valid counterpart). Companion, endpoint-level: `test_saving_a_day_with_end_before_start_is_rejected_by_the_endpoint` (422 and nothing persisted); `test_update_day_rejects_end_before_start_with_no_partial_write` | Yes |
| A2 | The itinerary still renders with an "unavailable" state when the maps/weather call times out | Integration: mocked upstream configured to time out; endpoint still returns 200 with `status: "unavailable"` | `test_conditions_endpoint_returns_200_unavailable_when_upstream_times_out` (real HTTP endpoint, hanging upstream, asserts 200, `status == "unavailable"`, no `data`, has `checked_at`). Supporting: `test_get_conditions_unavailable_on_timeout`, `test_get_conditions_unavailable_on_provider_error`, `test_get_conditions_never_raises_for_arbitrary_exceptions`. The "renders" half is in the frontend: see A2-UI below | Yes |
| A3 | Share links are read-only and require no login | Integration: unauthenticated request to a share-view endpoint succeeds; the same request against a write endpoint on the same trip is rejected | `test_share_link_read_succeeds_and_write_is_rejected` (share read with no credentials succeeds; a write to the share URL is refused); `test_the_same_trips_own_write_endpoint_rejects_an_unauthenticated_caller` (the trip's own write endpoint returns 401 and changes nothing, while the share link still reads); `test_no_mutating_verb_reachable_under_public_share_routes`. Full sweep: see F1. Frontend: `is read-only: no inputs, buttons, or edit/add/delete controls anywhere` | Yes |

**A2-UI, the frontend half of A2:** `ConditionsPanel.test.jsx` › "shows the unavailable badge when the API reports status unavailable", "shows the unavailable badge instead of crashing when the request itself fails", "shows the unavailable badge instead of crashing on a malformed response"; `DayEditor.test.jsx` › "still renders the saved activities in full, with an unavailable badge, when conditions fail"; `ShareView.test.jsx` › "shows the unavailable badge in place of the map, with activities intact, when a day's conditions fail".

**A3, now fully proven:** the app originally had no authentication, so "the write endpoint is rejected" could only be shown against the share URL. With accounts in place (section F), the trip's own write endpoint rejects an unauthenticated caller with 401, and the test checks that nothing changed.

## B. Goal-spec criteria

| # | Criterion | Test(s) | Covered |
|---|---|---|---|
| B1 | Itinerary CRUD: create, read, update, delete a day's plan | Create: `test_create_day`, `test_create_day_trip_not_found`, `test_create_day_missing_location_is_422`. Read: `test_get_trip`, `test_get_trip_not_found`. Update: `test_update_day_upserts_activities`, `test_update_day_removes_activities_missing_from_payload`, `test_update_day_not_found`. Delete: `test_delete_day`, `test_delete_day_not_found`, `test_delete_trip_cascades_to_days_and_activities`. Order: `test_reorder_days`, `test_reorder_days_mismatched_ids_is_422`. UI: see section D | Yes |
| B2 | Save and share by link | Backend: `test_create_share_link`, `test_create_share_link_is_idempotent`, `test_create_share_link_trip_not_found`, `test_read_shared_trip`, `test_read_shared_trip_invalid_token`, `test_deleting_trip_invalidates_share_link`. UI: see sections D (share link) and E (Share View) | Yes |
| B3 | When the maps/weather call fails or times out, the itinerary still renders with a clear "unavailable" state, never a crash | Same as A2, plus `test_conditions_unavailable_shape_is_200_not_5xx`, `test_upstream_failure_makes_conditions_unavailable` (each upstream failure mode for the real provider), `test_malformed_forecast_makes_conditions_unavailable`, `test_unknown_location_makes_conditions_unavailable_not_an_error`, `test_shared_day_conditions` | Yes |
| B4 | *Constraint:* the maps/weather API key must never appear in client-side code | Structural: the current provider (Open-Meteo) needs **no key**, and every upstream call is made server-side in `backend/weather.py`. `test_conditions_ok_shape` asserts the response contains only the whitelisted fields (never the raw upstream payload). `test_production_default_provider_is_the_real_one_not_the_stub` guards the wiring. **If a keyed provider is ever added, add a test that the key is absent from every API response and from the built frontend bundle** | Yes (by construction) |

## C. Frontend spec: Trip List

| # | Criterion | Test(s) in `pages/TripList.test.jsx` | Covered |
|---|---|---|---|
| C1 | While fetching, a loading skeleton replaces the cards | "shows a loading skeleton in place of the trip cards while the list is being fetched" | Yes |
| C2 | Empty list: empty state with a "Create your first trip" call to action | "shows the empty state when there are no trips"; "offers a 'Create your first trip' call to action in the empty state that focuses the name field"; "does not show the empty state when there are trips" | Yes |
| C3 | One or more trips: a card each, with name, date range and day count | "renders a card per trip with derived date range and day count"; "shows 'No days yet' on a card for a trip without days"; "does not show the empty state when there are trips" (singular "1 day") | Yes |
| C4 | Fetch fails or times out: error with the reason and a Retry action, not a blank screen | "shows an error state with retry when the fetch fails"; "recovers when Retry is clicked after a failed fetch" | Yes |
| C5 | Delete succeeds: card removed immediately, brief confirmation shown | "removes a trip card after a successful delete"; "shows a brief confirmation naming the trip after a successful delete, then hides it"; "does not delete anything when the confirmation is declined" | Yes |
| C6 | Delete fails: card kept, inline error on that card, rest of list interactive | "keeps the card, shows the error on that card only, and leaves the rest of the list interactive when a delete fails" | Yes |
| C7 | Create succeeds: navigate to the Itinerary Editor for that trip | "navigates to the new trip after a successful create"; extra: "shows an inline error and stays on the list when creating a trip fails" | Yes |

## D. Frontend spec: Itinerary Editor

Tests are in `pages/ItineraryEditor.test.jsx` (page-level), `components/DayEditor.test.jsx`, `components/ConditionsPanel.test.jsx` and `components/ShareLink.test.jsx`.

| # | Criterion | Test(s) | Covered |
|---|---|---|---|
| D1 | While fetching, a skeleton for the day list, not an empty editor | ItineraryEditor: "shows a skeleton for the day list, not an empty editor, while the trip is being fetched" | Yes |
| D2 | Zero days: empty state with an "Add a day" call to action | ItineraryEditor: "shows the empty-days state when the trip has no days"; "offers an 'Add a day' call to action in the empty state that focuses the new-day form"; "shows the empty state again after the last day is deleted" | Yes |
| D3 | One or more days: each in order, with activities/notes and a maps/weather panel | ItineraryEditor: "shows the days in the order the API returned them", "renders a DayEditor per day when the trip has days". DayEditor: "shows the day's date, location, notes and each activity", "shows the day's maps/weather panel with that day's conditions". ConditionsPanel: "renders the temperature, condition, an embedded map and a larger-map link when the upstream succeeded", "omits the map and link when the provider returned no map urls" | Yes |
| D4 | Fetch fails or times out: error with Retry; unsaved local edits are not discarded | ItineraryEditor: "shows an error state with retry when the fetch fails"; "recovers when Retry is clicked after a failed fetch". *Unsaved edits:* **by design.** The trip is fetched once on load, and a failed load means no days are on screen, so there are no unsaved edits to lose. This becomes testable if background refetching is ever added | Yes (edits clause by design) |
| D5 | Add day succeeds: the new day appears in the correct order | ItineraryEditor: "appends a newly added day in order and clears the form"; "does not allow adding a day until a date and location are entered" | Yes |
| D6 | Add day fails: inline error on the form, entered data kept | ItineraryEditor: "shows an inline error on the new-day form and keeps the entered data when adding a day fails" | Yes |
| D7 | Editing a day: a "saving" indicator while the update is in flight | DayEditor: "shows a saving indicator and blocks a second save while the update is in flight" | Yes |
| D8 | Update succeeds: brief "saved" confirmation, update reflected immediately | DayEditor: "confirms with 'Saved' and hands the updated day to the page after a successful update", "hides the 'Saved' confirmation once the day is edited again". ItineraryEditor: "reflects a saved day's new values in the page's copy of the trip, leaving other days alone" | Yes |
| D9 | Update fails: inline error, edited values retained, Retry offered | DayEditor: "shows an inline error and retains edits when the save request fails"; "offers Retry after a failed save, keeps the edited values, and recovers on Retry" | Yes |
| D10 | Deleting a day asks for confirmation first | DayEditor: "asks for confirmation before deleting the day" (declined path); "removes the day through the API and tells the page once deletion is confirmed" (accepted path) | Yes |
| D11 | Day delete succeeds: day removed, remaining days renumbered | ItineraryEditor: "removes a deleted day and renumbers the remaining days"; DayEditor: "removes the day through the API and tells the page once deletion is confirmed" | Yes |
| D12 | Day delete fails: day stays visible with an inline error | DayEditor: "keeps the day visible and shows an inline error when the delete fails" | Yes |
| D13 | Maps/weather loading: an indicator scoped to that day's panel, rest of the day interactive | ConditionsPanel: "shows a loading indicator while the request is in flight". DayEditor: "keeps the rest of the day interactive while conditions are loading" | Yes |
| D14 | Maps/weather fails or times out: activities render in full, "unavailable" badge in place of the map, never blank or crashed | DayEditor: "still renders the saved activities in full, with an unavailable badge, when conditions fail". ConditionsPanel: "shows the unavailable badge when the API reports status unavailable", "shows the unavailable badge instead of crashing when the request itself fails", "shows the unavailable badge instead of crashing on a malformed response" | Yes |
| D15 | End time before start time: Save disabled, inline message, before any request | DayEditor: "disables Save and shows an inline error when end time is before start time, before any request is sent" | Yes |
| D16 | End time on or after start time: Save enabled and saving proceeds | DayEditor: "renders the existing activity and enables Save when times are valid"; "keeps Save enabled when the end time is exactly the start time" (the *on* boundary); "re-enables Save once the time is corrected, and Save calls the API" | Yes |
| D17 | Share link succeeds: link shown with a copy action and a confirmation on copy | ShareLink: "shows no link until one is requested"; "shows the full share URL and a Copy action once the link is created"; "copies the link to the clipboard and confirms"; "does not claim the link was copied when the clipboard is unavailable"; "disables the button while the request is in flight". ItineraryEditor: "offers a Get share link action for the trip" | Yes |
| D18 | Share link fails: inline error with Retry | ShareLink: "shows an inline error with Retry when creating the link fails, then recovers on Retry" | Yes |
| D+ | *Implemented but not in the spec:* reordering days | ItineraryEditor: "reorders days through the API and reflects the new order"; "keeps the original order and shows an error when reordering fails" | n/a |

## E. Frontend spec: Share View

All in `pages/ShareView.test.jsx`.

| # | Criterion | Test(s) | Covered |
|---|---|---|---|
| E1 | While fetching: a loading state, not a blank page | "shows a loading state, not a blank page, while the itinerary is being fetched" | Yes |
| E2 | Invalid, expired or deleted link: a clear "this itinerary is unavailable" state, not a crash or blank page | "shows the 'unavailable' state, with no retry, when the link is invalid or the trip was deleted" | Yes |
| E3 | Zero days: "No days have been added to this trip yet" | "shows an empty state when the trip has no days" | Yes |
| E4 | One or more days: each day's activities/notes and maps/weather panel, read-only, no edit/add/delete controls | "renders each day's location, date, notes, and activities in order"; "loads each day's conditions through the share-token endpoint"; "is read-only: no inputs, buttons, or edit/add/delete controls anywhere"; "fetches the itinerary using the token from the URL"; "serves the Share View at /share/:token" | Yes |
| E5 | Fetch fails for a reason other than an invalid link: error with Retry | "shows an error with Retry for a non-404 failure, and recovers on Retry"; "treats a server error as a retryable error, not as 'unavailable'" | Yes |
| E6 | A day's maps/weather fails or times out: the same "unavailable" badge, activities in full, never a crash | "shows the unavailable badge in place of the map, with activities intact, when a day's conditions fail" | Yes |

## F. Accounts and access (backend)

From [backend-spec.md](backend-spec.md) "Accounts and access". All backend tests.

| # | Criterion | Test(s) | Covered |
|---|---|---|---|
| F1 | Every `/api` endpoint except register, login, Google and the two public share reads rejects a request with no valid login with 401, before validating the body | `test_every_non_public_route_rejects_a_request_with_no_login` and `test_every_non_public_route_rejects_a_bad_token` (both run once per route, with the route list read from the app's OpenAPI schema, so a new endpoint is covered automatically and must be added to the public allowlist on purpose); `test_the_public_allowlist_has_no_stale_entries`; `test_route_enumeration_actually_finds_the_api` (fails loudly if the sweep ever finds no routes) | Yes |
| F2 | Forged, tampered, unsigned, expired, or claim-less tokens, and tokens for a deleted user, are rejected | `test_an_expired_token_is_rejected`, `test_a_token_signed_with_another_secret_is_rejected`, `test_a_token_with_a_tampered_payload_is_rejected`, `test_an_unsigned_token_is_rejected`, `test_a_token_missing_a_required_claim_is_rejected`, `test_a_valid_token_for_a_user_that_no_longer_exists_is_rejected`, `test_a_non_numeric_subject_is_rejected`, `test_a_malformed_authorization_header_is_rejected`, `test_me_requires_a_token` | Yes |
| F3 | A user reaches only their own trips; someone else's trip, day, conditions or share request looks exactly like a missing one; listing returns only the caller's | `test_a_new_trip_belongs_to_whoever_created_it`, `test_another_users_trip_is_indistinguishable_from_a_missing_one` (all eight trip, day, conditions and share operations, comparing the response to a genuinely missing id), `test_a_rejected_attempt_on_someone_elses_trip_changes_nothing`, `test_a_user_cannot_use_their_own_trip_id_to_reach_another_users_day`, `test_a_share_link_is_readable_by_anyone_but_creating_one_is_owner_only` | Yes |
| F4 | The same trip's own write endpoint rejects a caller with no login and changes nothing, while its share link stays readable with no login | `test_an_unauthenticated_write_to_a_trips_own_endpoint_is_rejected_and_changes_nothing`, `test_share_links_still_work_with_no_login`, `test_the_same_trips_own_write_endpoint_rejects_an_unauthenticated_caller` | Yes |
| F5 | Passwords stored only as salted scrypt hashes and never returned; duplicate email (any case) is 409; password length bounds; email is normalised | `test_register_stores_a_salted_hash_never_the_password`, `test_register_returns_a_working_token_and_the_user` (response has only `id` and `email`), `test_password_hashes_verify_only_the_right_password`, `test_a_missing_or_malformed_stored_hash_never_verifies`, `test_register_rejects_a_duplicate_email_case_insensitively`, `test_register_rejects_an_invalid_email`, `test_register_rejects_a_password_outside_the_length_bounds`, `test_register_normalises_the_email` | Yes |
| F6 | Login for an unknown email, a wrong password, and a password-less account are indistinguishable | `test_login_gives_the_same_401_for_a_wrong_password_and_an_unknown_email`, `test_login_gives_the_same_401_for_an_account_that_has_no_password`, `test_login_with_the_right_password_returns_a_working_token` | Yes |
| F7 | Google sign-in accepts only an RS256 ID token from Google, for this app's client id, from Google's issuer, unexpired, with an email Google verified; algorithm-confusion refused | Verifier (real RSA signatures): `test_a_valid_google_id_token_yields_the_identity_with_a_lowercased_email`, `test_the_alternate_google_issuer_form_is_accepted`, `test_a_bad_google_id_token_is_rejected` (wrong audience, wrong issuer, expired, unverified email, string-typed verified flag, missing claims), `test_a_token_signed_by_someone_other_than_google_is_rejected`, `test_an_hs256_token_cannot_be_passed_off_as_a_google_rs256_token`, `test_an_unreachable_key_endpoint_is_reported_as_unavailable_not_invalid`, `test_verification_is_unavailable_when_no_client_id_is_set`. Endpoint: `test_first_google_sign_in_creates_an_account_and_returns_a_working_token`, `test_signing_in_again_with_google_returns_the_same_account`, `test_an_invalid_google_credential_is_rejected`, `test_google_being_unreachable_is_a_503_not_a_login_failure`, `test_google_sign_in_is_off_when_no_client_id_is_configured`, `test_an_empty_google_credential_is_a_validation_error`, `test_a_google_only_account_cannot_log_in_with_a_password` | Yes |
| F8 | Google sign-in for an email with a password account links it, keeps its trips and removes the password; for an email tied to a different Google identity it is refused | `test_google_email_matching_a_password_account_links_it_keeps_its_trips_and_drops_the_password`, `test_an_email_already_tied_to_a_different_google_identity_is_never_re_pointed` | Yes |
| F9 | The app refuses to start without a long enough `JWT_SECRET` | `test_importing_the_app_without_a_jwt_secret_fails_at_startup`, `test_the_app_refuses_to_run_without_a_long_enough_jwt_secret` | Yes |
| F10 | Trips that existed before accounts are kept, owned by a placeholder account nobody can sign in to | `test_existing_trips_are_kept_and_given_to_a_login_less_legacy_owner`, `test_upgrading_an_empty_database_creates_no_legacy_user`, `test_the_migration_can_be_downgraded_and_upgraded_again`, `test_deleting_a_user_deletes_their_trips` | Yes |

## G. Frontend spec: Login

Tests are in `App.test.jsx`, `pages/Login.test.jsx`, `components/RequireAuth.test.jsx`, `components/GoogleSignInButton.test.jsx`, `auth/AuthContext.test.jsx`, `api/client.test.js` and `auth/tokenStore.test.js`.

| # | Criterion | Test(s) | Covered |
|---|---|---|---|
| G1 | A visitor who isn't logged in and opens the Trip List or an Editor address is sent to Login, and returned to that page after logging in; no trips are requested first | App: "sends an anonymous visitor from the trip list to the login page without loading any trips", "sends an anonymous visitor from a trip to login, and back to that trip after logging in". RequireAuth: "sends an anonymous visitor to /login and remembers where they were going". Login: "returns the user to the page they were trying to reach" | Yes |
| G2 | The user can switch between "Log in" and "Create account" | Login: "shows the log-in form by default", "logs in with the entered credentials and goes to the trip list", "switches to registration and creates the account" | Yes |
| G3 | A failed log-in or sign-up shows the reason inline, keeps what was typed, stays on Login | Login: "shows the error, keeps what was typed, and stays on the page when login fails", "disables the form while the request is in flight", "clears a previous error when switching between log in and create account" | Yes |
| G4 | A password shorter than 8 characters is explained before any request is sent (sign-up only) | Login: "rejects a too-short password before sending anything", "does not apply the length rule to logging in (old passwords must still work)" | Yes |
| G5 | An already-registered email is reported | Login: "tells the user when the email is already registered", "shows a server validation message without the technical prefix" | Yes |
| G6 | Google sign-in works when configured; if Google's script can't load, the UI says so and email + password still work | Login: "logs in with the credential Google returns and goes to the trip list", "shows why Google sign-in failed and stays on the page". GoogleSignInButton: "renders nothing, and never loads Google, when no client id is configured", "initialises Google with the configured client id and renders its button", "passes the credential Google returns to the app", "uses the latest onCredential handler without re-initialising Google", "shows a fallback message, and leaves email login usable, when the script fails to load", "initialises Google once the script has loaded" | Yes |
| G7 | A logged-in user sees who is logged in and a "Log out" action; logging out returns to Login and forgets the session | RequireAuth: "shows the page, and who is logged in, for a logged-in user", "logs out from the user bar". App: "shows the trip list, and who is logged in, to a returning user with a valid stored session", "logging out returns to the login page and forgets the session", "does not show the login page to someone who is already logged in". Login: "sends an already logged-in visitor straight past the login page". AuthContext: "logging out clears the token and the user" | Yes |
| G8 | A stored session the server rejects means logged out (no error screen); if the server just can't be reached, Retry, not Login | AuthContext: "drops a stored token the server no longer accepts", "keeps the token and reports an error when the server can't be reached, then recovers on retry", "ends the session when a logged-in request is rejected with 401". RequireAuth: "offers Retry, rather than a login screen, when the server couldn't be reached", "shows a loading state, not the page and not a redirect, while the stored session is checked". App: "treats a stored session the server rejects as logged out". Client: "reports a 401 on a logged-in request to the session handler, and still throws", "does not treat wrong credentials at /auth/login as a dead session", "does not call the session handler for a 401 when nobody was logged in", "does not call the session handler for other errors or successes" | Yes |
| G9 | A Share View link needs no login and makes no session check | App: "lets anyone open a share link without logging in". ShareView: "serves the Share View at /share/:token" | Yes |

## Supporting tests (no criterion of their own)

These back the criteria above indirectly, or pin internal behaviour worth keeping:

- **Trips CRUD:** `test_create_trip`, `test_create_trip_empty_name_is_422`, `test_list_trips_empty`, `test_list_trips_summary_shape`, `test_delete_trip_not_found`.
- **Conditions endpoint:** `test_conditions_day_not_found`, `test_conditions_trip_not_found_also_reports_day_not_found`, `test_shared_day_conditions_wrong_day_for_token`.
- **Login plumbing (frontend):** token store (`tokenStore.test.js`: "returns nothing when no token has been stored", "stores a token in localStorage and reads it back", "clear removes the token from storage and memory", "keeps working from memory when localStorage throws"); the API client sending the token ("sends no Authorization header when there is no token", "sends the stored token as a Bearer header on every request", "picks up a token stored after the client was created"); the auth context ("is anonymous, without asking the server, when no token is stored", "checks a stored token and becomes logged in as that user", "stores the token and becomes logged in", "passes the entered credentials through to the API", "stays logged out, with no token stored, when login fails", "refuses to be used outside an AuthProvider").
- **Weather provider internals:** `test_get_conditions_ok`, `test_stub_provider_is_deterministic_per_location`, `test_open_meteo_maps_response_to_conditions`, `test_open_meteo_bounds_every_http_call`, `test_open_meteo_unknown_weather_code_still_returns_a_condition`, `test_geocoding_prefers_the_result_matching_the_hint`, `test_geocoding_falls_back_to_the_name_alone_when_the_full_string_finds_nothing`, `test_geocoding_is_cached_per_location`, `test_a_failed_geocode_is_not_cached`.

## Mutation checks

For each key behaviour, the implementation was deliberately broken and the named test confirmed to fail, then the change reverted. Highlights:

| Area | Mutation | Caught by |
|---|---|---|
| A1 | Flip the end/start comparison; remove the validation call from the update endpoint | the unit tests; the endpoint-level acceptance test |
| A2 | Remove the timeout; let provider errors raise | `test_conditions_endpoint_returns_200_unavailable_when_upstream_times_out` |
| A3 | Make the share GET always 404; add a write route to the share URL | `test_share_link_read_succeeds_and_write_is_rejected` |
| B3 / real provider | Ship the stub as default; drop the HTTP timeout; ignore the country hint; disable the geocode cache; skip the name-only fallback; swap lat/lon | the matching `test_weather.py` tests |
| C, D | Delete error on the wrong card; confirmation never dismissed; new day inserted first; failed add clears the form; failed save discards edits; failed delete still removes the day; no saving indicator; confirmation prompt removed; page ignores a saved day; equal times treated as invalid | the tests named in the rows above |
| F1-F4 | Login token ignored; ownership check removed; trip list not filtered by owner; new trips assigned to the wrong user; conditions ownership check removed | the sweep and isolation tests in `test_access_control.py`, `test_auth.py` |
| F5-F9 | `verify_password` always true; login distinguishes unknown email from wrong password; token expiry not enforced; Google audience / issuer not verified; unverified Google email accepted; linking keeps the password; an email re-pointed to a different Google identity; app starts without a secret | `test_auth.py`, `test_google_login.py` |
| G | Token never sent; auth-endpoint 401 treated as a dead session; rejected stored token kept; logout leaves the token; network error wipes the session; anonymous visitors see the page; page shown while the session is still loading; short passwords accepted; navigation happens even when login fails; remembered destination ignored; trip list not behind login; share links put behind login | `client.test.js`, `AuthContext.test.jsx`, `RequireAuth.test.jsx`, `Login.test.jsx`, `App.test.jsx` |
| D14, E | Malformed response not guarded; 404 no longer mapped to "unavailable"; every error shown as "unavailable"; a Delete button added to the Share View; conditions fetched for the wrong day; route removed | the ConditionsPanel and ShareView tests |

One mutant was *equivalent* (the change could not alter behaviour) and was discarded rather than counted as a survivor; it did lead to a real crash on malformed responses being found and fixed. One mutant was first "killed" only because a test fixture crashed, so it was redone until the intended test failed.

## Keeping this honest

- When a criterion is added or reworded in a spec, add or update its row here in the same change.
- When a test is renamed, update the reference here. Every test title in this file can be found with `grep -rn "<title>" backend/tests frontend/src`.
- CI (`.github/workflows/ci.yml`) runs the whole suite on every push; deploys only run after both test jobs pass.
