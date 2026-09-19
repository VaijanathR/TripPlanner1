# Goal Spec

## Goal
Let a user plan a multi-day trip and produce a shareable itinerary.

## Constraints
- React frontend
- FastAPI backend
- A relational database
- The external maps/weather API key must never appear in client-side code
- Passwords are stored only as salted hashes and are never returned by the API
- Destination data (geocoding, photos, places) comes from free, key-less sources, fetched only by the backend and cached; photos are credited to their source

## Acceptance criteria
- Itinerary CRUD: create, read, update, and delete a day's plan
- Save and share by link
- When the maps/weather API call fails or times out, the itinerary still renders with a clear "unavailable" state, never a crash
- Destinations: a user can choose a trip's destination by typing a country, state and city and picking from the matching places
- Discover: for a trip's destination the app shows photos of the city, state and country, popular places in and around the city, and things to do; a slow or failing data source never breaks the trip page
- Popular places can be added to a day of the itinerary in one step, without ever overwriting unsaved edits
- Accounts: a user can sign up and log in with an email and password, or with Google, and only ever sees and changes their own trips. Share links stay public and read-only.
