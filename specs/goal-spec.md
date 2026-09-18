# Goal Spec

## Goal
Let a user plan a multi-day trip and produce a shareable itinerary.

## Constraints
- React frontend
- FastAPI backend
- A relational database
- The external maps/weather API key must never appear in client-side code

## Acceptance criteria
- Itinerary CRUD: create, read, update, and delete a day's plan
- Save and share by link
- When the maps/weather API call fails or times out, the itinerary still renders with a clear "unavailable" state, never a crash
