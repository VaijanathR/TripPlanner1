# Acceptance Matrix

Every acceptance criterion in the project, mapped to the test(s) that prove it.

- **Backend tests** are named by function, e.g. `test_share_link_read_succeeds_and_write_is_rejected` (all under `backend/tests/`).
- **Frontend tests** are named by their exact `it("…")` title, in the file shown (all under `frontend/src/`).
- A criterion marked **by design** cannot occur in the current app; the reason is given.
- Not every test here has been mutation-checked. The behaviours that matter most were (the code was deliberately broken and the test confirmed to fail); those are listed under [Mutation checks](#mutation-checks). The rest rest on ordinary review.

Sources: the Step 10 table (below), [goal-spec.md](goal-spec.md), [frontend-spec.md](frontend-spec.md).

## A. Step 10 acceptance-criteria table

| # | Criterion | Required test type | Test(s) | Covered |
|---|---|---|---|---|
| A1 | A Day cannot be saved with an end time before its start time | Unit: call the validation function directly with a bad time pair, assert the expected error | `test_validate_activities_raises_when_end_time_before_start_time` (unit, asserts 422 / `validation_error` / field name); `test_validate_activities_does_not_raise_when_end_time_after_start_time` (unit, the valid counterpart). Companion, endpoint-level: `test_saving_a_day_with_end_before_start_is_rejected_by_the_endpoint` (422 and nothing persisted); `test_update_day_rejects_end_before_start_with_no_partial_write` | Yes |
| A2 | The itinerary still renders with an "unavailable" state when the maps/weather call times out | Integration: mocked upstream configured to time out; endpoint still returns 200 with `status: "unavailable"` | `test_conditions_endpoint_returns_200_unavailable_when_upstream_times_out` (real HTTP endpoint, hanging upstream, asserts 200, `status == "unavailable"`, no `data`, has `checked_at`). Supporting: `test_get_conditions_unavailable_on_timeout`, `test_get_conditions_unavailable_on_provider_error`, `test_get_conditions_never_raises_for_arbitrary_exceptions`. The "renders" half is in the frontend: see A2-UI below | Yes |
| A3 | Share links are read-only and require no login | Integration: unauthenticated request to a share-view endpoint succeeds; the same request against a write endpoint on the same trip is rejected | `test_share_link_read_succeeds_and_write_is_rejected`; `test_no_mutating_verb_reachable_under_public_share_routes`. Frontend: `is read-only: no inputs, buttons, or edit/add/delete controls anywhere` | Yes, with the caveat below |

**A2-UI, the frontend half of A2:** `ConditionsPanel.test.jsx` › "shows the unavailable badge when the API reports status unavailable", "shows the unavailable badge instead of crashing when the request itself fails", "shows the unavailable badge instead of crashing on a malformed response"; `DayEditor.test.jsx` › "still renders the saved activities in full, with an unavailable badge, when conditions fail"; `ShareView.test.jsx` › "shows the unavailable badge in place of the map, with activities intact, when a day's conditions fail".

**A3 caveat (known gap, not a test gap):** the app has **no authentication model** ([api-contract.md](api-contract.md) "Out of scope"). So "requires no login" is trivially true, and "the write endpoint is rejected" is proven against the share-token URL surface (a mutating verb on `/api/share/{token}` gets 404/405), *not* against the trip's own write endpoints, which accept any caller. Adding real authorization is a separate piece of work; when it lands, A3 needs a second test: an unauthenticated `PUT /api/trips/{id}/days/{day_id}` is rejected.

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

## Supporting tests (no criterion of their own)

These back the criteria above indirectly, or pin internal behaviour worth keeping:

- **Trips CRUD:** `test_create_trip`, `test_create_trip_empty_name_is_422`, `test_list_trips_empty`, `test_list_trips_summary_shape`, `test_delete_trip_not_found`.
- **Conditions endpoint:** `test_conditions_day_not_found`, `test_conditions_trip_not_found_also_reports_day_not_found`, `test_shared_day_conditions_wrong_day_for_token`.
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
| D14, E | Malformed response not guarded; 404 no longer mapped to "unavailable"; every error shown as "unavailable"; a Delete button added to the Share View; conditions fetched for the wrong day; route removed | the ConditionsPanel and ShareView tests |

One mutant was *equivalent* (the change could not alter behaviour) and was discarded rather than counted as a survivor; it did lead to a real crash on malformed responses being found and fixed. One mutant was first "killed" only because a test fixture crashed, so it was redone until the intended test failed.

## Keeping this honest

- When a criterion is added or reworded in a spec, add or update its row here in the same change.
- When a test is renamed, update the reference here. Every test title in this file can be found with `grep -rn "<title>" backend/tests frontend/src`.
- CI (`.github/workflows/ci.yml`) runs the whole suite on every push; deploys only run after both test jobs pass.
