# Frontend Spec

Derived from [goal-spec.md](goal-spec.md). No implementation code — this defines
screens, flow, and behavior only.

## Screens

### 0. Login
Log in or create an account with an email and password, or with Google
(when it is configured). Every screen except the Share View requires a
login.

### 1. Trip List
All of a user's trips. Shows every trip the user has created, each as a
card with trip name, date range, and day count. Actions: open a trip,
create a new trip, delete a trip.

### 2. Itinerary Editor
One trip: its days, and each day's activities. Day-by-day plan with CRUD
on individual days (add a day, edit a day's activities/notes, delete a
day, reorder days). Each activity within a day has at least a title,
start time, and end time. Each day shows a maps/weather panel for its
location. Includes an explicit "Save" action and a "Get share link"
action.

### 3. Share View
Read-only, no login required. View of an itinerary opened via its share
link. Renders the same day-by-day plan (days and their activities) and
maps/weather panels as the Editor, but with no edit controls.

### 4. Account
Reached from the "Account" link in the top bar. Shows the signed-in email and a
"Delete my account" section.

### 5. Admin
Reached from the "Admin" link in the top bar, shown only to administrators.
Lists all accounts and lets an administrator delete one.

## User Flow

1. User opens the app → **Trip List**.
2. User creates a new trip → **Itinerary Editor**.
3. User adds a day to the trip.
4. User adds activities to that day (title, start time, end time, notes).
5. User saves the day/trip.
6. User clicks "Get share link" → link is generated/copied.
7. User (or a recipient with the link, no login required) opens the link
   → **Share View**, read-only.
8. From Trip List, user can also open an existing trip to keep editing,
   or delete a trip, removing it and invalidating its share link.

## Acceptance Criteria

### Login

- Given a visitor who is not logged in opens the Trip List or an Itinerary
  Editor address, the UI sends them to the Login screen, and after a
  successful login returns them to the page they asked for. No trips are
  requested before they log in.
- Given the Login screen, the user can switch between "Log in" and "Create
  account".
- Given a log-in or sign-up request fails, the UI shows the reason inline,
  keeps the email and password the user typed, and stays on the Login screen.
- Given the user creates an account with a password shorter than 8
  characters, the UI explains why before sending any request.
- Given the email is already registered, the UI says so.
- Given Google sign-in is configured, the user can sign in with it; if
  Google's script can't load, the UI says so and email + password still work.
- Given a logged-in user, the UI shows who is logged in and a "Log out"
  action; logging out returns to the Login screen and forgets the session.
- Given a stored session the server no longer accepts, the UI treats the
  user as logged out (no error screen); given the server simply can't be
  reached while checking it, the UI shows a "Retry", not the Login screen.
- Given someone opens a Share View link, no login is required and no
  session check is made.
- Given the server refuses because of too many attempts, the Login screen shows
  its "try again in N minutes" message and leaves the entered email in place.

### Trip List

- Given the trip list is being fetched, the UI shows a loading skeleton
  in place of the trip cards.
- Given the fetch succeeds and the user has no trips, the UI shows an
  empty state with a "Create your first trip" call to action.
- Given the fetch succeeds and the user has one or more trips, the UI
  shows a card per trip with name, date range, and day count.
- Given the fetch fails or times out, the UI shows an error state with
  the reason (where available) and a "Retry" action, not a blank screen.
- Given the user deletes a trip and the delete succeeds, the UI removes
  that card immediately and shows a brief confirmation.
- Given the user deletes a trip and the delete fails, the UI keeps the
  card, shows an inline error on that card, and leaves the rest of the
  list interactive.
- Given the Create trip form, it asks for the trip name and a place: Country,
  State / region and City, searched and chosen exactly as in the Editor's
  "Where are you going?" (matching places to pick from, "Did you mean one of
  these?" when nothing matches). Create trip is available only once a name has
  been entered and a place chosen; changing a place field clears the chosen place.
- Given the user creates a trip successfully, it has the chosen destination and
  the UI navigates to the Itinerary Editor for it, on its Discover tab.
- Given creating the trip fails (including the place not being saved), no trip is
  created, the reason is shown, and what was entered is kept.

### Itinerary Editor

- Given the itinerary is being fetched, the UI shows a loading state for
  the day list (skeleton), not an empty editor.
- Given the fetch succeeds and the trip has zero days, the UI shows an
  empty state with an "Add a day" call to action.
- Given the fetch succeeds and the trip has one or more days, the UI
  shows each day in order with its activities/notes and a maps/weather
  panel.
- Given the fetch fails or times out, the UI shows an error state with a
  "Retry" action; existing unsaved local edits (if any) are not
  discarded.
- Given the user adds a day and the create succeeds, the new day appears
  in the list in the correct order.
- Given the user adds a day and the create fails, the UI shows an
  inline error on the new-day form and keeps the user's entered data.
- Given the user edits a day's fields, the UI shows a "saving" indicator
  while the update is in flight.
- Given a day's update succeeds, the UI shows a brief "saved"
  confirmation and reflects the update immediately.
- Given a day's update fails, the UI shows an inline error, retains the
  user's edited (unsaved) values, and offers a "Retry" action.
- Given the user deletes a day, the UI asks for confirmation before
  removing it.
- Given a day delete succeeds, the UI removes that day and renumbers the
  remaining days.
- Given a day delete fails, the UI keeps the day visible and shows an
  inline error.
- Given a day's maps/weather data is loading, the UI shows a loading
  indicator scoped to that day's panel only (the rest of the day's
  content stays interactive).
- Given a day's maps/weather call times out or fails, the day still
  renders with its saved activities in full, and an "unavailable" badge
  appears in place of the map — never a blank panel and never a crashed
  screen.
- Given the user edits an activity's end time to a value before its
  start time, the Save button is disabled and an inline message
  explains why, before any request reaches the server.
- Given an activity's end time is on or after its start time, the Save
  button is enabled (assuming no other validation errors) and saving
  proceeds normally.
- Given the user requests a share link and it succeeds, the UI shows the
  link and a "copy" action with a confirmation on copy.
- Given the user requests a share link and it fails, the UI shows an
  inline error and offers a "Retry" action.

### Destination and Discover

- Given a trip has no destination (one made before a place was required at
  creation), the Editor asks "Where are you going?" with
  Country, State / region and City inputs; a search needs at least a 2-letter city.
- Given a search, the UI lists every matching place ("Paris, Texas, United States"
  and "Paris, Île-de-France Region, France") to choose from; when nothing matches it
  says so — and, if the same city exists elsewhere, offers those places to choose
  from ("Did you mean one of these?"); a failed search shows why and can be retried.
- Given the user chooses a place, the destination is saved and the guide appears;
  if saving fails the reason is shown and the user can choose again.
- Given a trip has a destination, the header shows it with a "Change destination"
  action (with Cancel), and two tabs appear: **Itinerary** and **Discover {city}**.
  The itinerary is the default tab when the trip has days, Discover when it has none.
  Switching tabs never discards what someone has typed into a day.
- Given the guide is ready, Discover shows photos of the city, state and country
  (each labelled and credited), things to do (grouped by theme, listing places),
  popular places in the city, places around it, and a photo gallery, with the
  Wikipedia / Wikimedia / Wikidata attribution.
- Given the guide is still being built, the UI says so, shows whatever has arrived,
  and keeps checking (for a bounded time); a section that is unavailable says so
  without hiding the sections that worked; a wholly failed guide offers "Try again";
  a guide that can't be loaded offers "Retry" and keeps any earlier content.
- Given a photo can't be loaded, a coloured gradient stands in — never a broken image.
- Given the city photo exists, it becomes the Editor's header image.
- Given the user adds a popular place to a day, it is appended as a new activity
  right after that day's last activity (09:00 for an empty day, two hours long,
  never past midnight), existing activities are kept, the day shows it, and the
  confirmation names the day. If the day has unsaved edits the add is refused with
  a message so nothing is overwritten. A failure shows why and changes nothing.
- Given the trip list, a trip with a destination shows it, and shows its destination
  photo as the card cover (a gradient under it, so a slow photo never leaves a blank
  card).

### Share View

- Given the shared itinerary is being fetched, the UI shows a loading
  state, not a blank page.
- Given the link is invalid, expired, or the underlying trip was
  deleted, the UI shows a clear "this itinerary is unavailable" state
  (not a generic crash or blank page).
- Given the fetch succeeds and the itinerary has zero days, the UI shows
  an empty state ("No days have been added to this trip yet").
- Given the fetch succeeds and the itinerary has one or more days, the
  UI renders each day's activities/notes and maps/weather panel,
  read-only (no edit, add, or delete controls anywhere on the page).
- Given the shared trip has a destination, its header shows it (read-only).
- Given the fetch fails for a reason other than an invalid link (e.g.
  network/server error), the UI shows an error state with a "Retry"
  action.
- Given a day's maps/weather call fails or times out, the UI shows the
  same "unavailable" badge in place of the map as the Editor — the
  day's activities still render in full, never a crash.

### Account

- Every signed-in screen's top bar has an "Account" link; the Account screen
  shows the signed-in email.
- "Delete my account" states what will be deleted (the account, all its trips
  and their share links) and that it cannot be undone, and asks for a
  confirmation: a password field for an account with a password, or the
  account's own email typed in for an account without one. The Delete button
  stays disabled until that field is filled, and nothing is deleted before it
  is pressed.
- After a successful deletion the user is logged out and sent to Login, which
  says the account was deleted.
- A wrong confirmation shows "That doesn't match. Nothing was deleted." and
  leaves the user signed in; a lock shows the same "try again in N minutes"
  message as Login.
- For an administrator the section shows no form, only that administrator
  accounts can't be deleted until the address is removed from the administrator
  list.

### Admin

- The "Admin" link appears only for administrators. A signed-in
  non-administrator who opens the Admin address is told they aren't allowed; a
  visitor who isn't logged in is sent to Login like any other screen.
- The screen lists every account with its email, when it was created and how
  many trips it has. Administrator accounts are marked "Admin" and have no
  Delete button.
- Deleting asks for confirmation naming the account's email. After confirming,
  the account disappears from the list. If the server refuses, the error is
  shown and the list is unchanged.
- The screen never shows password data or any trip content.

### Imagery

- Every photograph the app shows comes from a source whose license allows
  this use (public domain, CC0, or CC BY). Its author, license, and source
  link are recorded and listed on a public "Photo credits" page, reachable
  without logging in and linked from every screen. Photos under share-alike
  licenses are not used.
- The photos cover four themes: flying, boats, road trips, and nature.
- The Login screen and the Trip List banner show a travel photo. The Trip
  List banner shows a different photo from the set on each visit.
- Given a trip has a destination photo, its card and header use it.
  Otherwise they use a photo from the set chosen consistently for that trip,
  so the same trip always shows the same photo.
- Given the Trip List, a "Travel your way" strip of four tiles (fly, sail,
  drive, ride the rails) is shown. The tiles are decorative and have no
  actions.
- Given a photo can't be loaded, a colored gradient stands in and nothing
  else on the screen changes. A broken image is never shown.
- Given text over a photo, it stays readable in both the light and dark
  themes.
- Decorative photos have empty alternative text, and destination photos keep
  their descriptive text.
- The banner photo is at most 350 KB and every other photo at most 150 KB.
  Only the banner photo is downloaded up front, and the others load as they
  come into view.

## Out of scope for this spec
- Visual design, styling, and component library choices.
- Exact request/response shapes — covered in `specs/api-contract.md`.
- Password reset, email verification, and changing account details.
