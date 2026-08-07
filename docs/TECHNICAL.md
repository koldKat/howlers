# Howlers Webapp Technical Documentation

## Overview
Howlers Webapp is a small Node.js + vanilla JS application with a static client and a minimal HTTP server.

Repository/runtime note:
- the repository is still named `Howlers Webapp`, but the shipped Bulgarian UI brand shown to end users is **Семейни бисери**

Core stack:
- Node.js built-in `http`, `fs`, and `path`
- `better-sqlite3` for persistence
- server-sent events for live client refreshes
- no frontend framework

## Project Layout
- `server.js`: HTTP server composition, top-level route matching, and app route handlers
- `server/auth.js`: shared authenticated-session guard
- `server/config.js`: paths, port, request limits, backup policy, MIME map, and protected admin usernames
- `server/db.js`: SQLite schema, auth/session helpers, entry queries, summary queries
- `server/http.js`: JSON response helper, request body parsing, token extraction, and localhost detection
- `server/static.js`: static file serving from `public/`
- `server/public.js`: server-rendered public post pages, dynamic sitemap, and robots output
- `server/sse.js`: server-sent events client registry and publish helpers
- `server/state.js`: authenticated and guest app-state builders
- `server/image-validation.js`: shared raster data URL, decoded-size, and file-signature validation
- `server/howler-validation.js`: entry payload validation and default local date helper
- `server/export.js`: TXT export and print/PDF HTML rendering
- `server/backup.js`: hourly SQLite snapshot ZIP creation and 14-day retention
- `server/routes/admin.js`: localhost-only admin page and admin API handlers
- `scripts/regression-test.js`: isolated end-to-end API regression suite using a temporary SQLite database
- `public/index.html`: app structure and themed confirm dialog markup
- `public/css/style.css`: full visual styling, including custom favorite control and confirm modal
- `public/js/app.js`: main client entry point and feature orchestration for auth, profile, editor, feed rendering, SSE, and event binding
- `public/js/app/api.js`: main-app token helpers and JSON API wrapper
- `public/js/app/constants.js`: main-app slugs, formatting metadata, emoticon tokens, and upload limits
- `public/js/app/dom.js`: main-app DOM lookup and shared backdrop-dismiss behavior
- `public/js/app/format.js`: main-app HTML escaping, date formatting, and data URL size helpers
- `public/js/i18n.js`: lightweight i18n module - locale loading, `t()` translation helper, and DOM text application
- `public/locales/bg.json`: Bulgarian translation strings
- `public/admin.html`: localhost-only admin panel (not served to external users)
- `public/css/admin.css`: standalone admin panel styles
- `public/js/admin.js`: admin panel entry point and feature orchestration for stats, entries, users, maintenance actions, auto-refresh, and event binding
- `public/js/admin/core.js`: admin formatting helpers, escaping, table cell helpers, and JSON API wrapper
- `public/js/admin/dialogs.js`: admin toast and confirm dialog wiring
- `scripts/docs-guard.js`: checks whether docs were updated when relevant app files changed
- `scripts/install-hooks.js`: installs the repo pre-commit hook when a `.git` directory exists
- `.githooks/pre-commit`: runs the docs guard before commit
- `docs/USER_GUIDE.md`: end-user documentation
- `docs/USER_GUIDE.html`: HTML version of the end-user documentation
- `docs/ADMIN.md`: admin panel documentation
- `docs/ADMIN.html`: HTML version of the admin panel documentation
- `docs/TECHNICAL.md`: this file
- `docs/TECHNICAL.html`: HTML version of this technical reference

## Runtime
Default port:
- `3019`

Startup:

```bash
npm start
```

The app serves static files from `public/`.
Set `PORT` to override the default listener.

Automatic backups:
- the server creates a ZIP backup of the SQLite database at each clock-hour boundary; restarting the server does not create an extra backup
- retention is 14 days
- each backup is created as a temporary SQLite snapshot and then compressed to a `.zip` archive
- every backup run logs the retention check result, including when `0` expired backups were removed
- a snapshot or ZIP failure is logged without crashing the server; the next clock-hour attempt remains scheduled

Regression checks run with `npm test`. The suite sets `DATABASE_PATH` to a temporary SQLite file and `DISABLE_BACKUPS=1`, so it does not touch normal data or create backups.

JSON request bodies are capped at 2 MiB. Oversized bodies return `413`, and malformed percent-encoded paths return `400`, rather than being reported as internal server errors.

## Data Model
### `users`
- `id`
- `username` unique
- `password_hash`
- `salt`
- `locale` (default `'bg'`) - current UI language setting; only Bulgarian is supported right now
- `display_name` - optional human-readable name shown in nav and profile (login username is unchanged)
- `avatar` - optional JPEG, PNG, WebP, or GIF profile picture stored as a base64 data URL (max 300 KiB decoded)
- `created_at`

### `families`
- `id`
- `created_at`

### `family_members`
- `family_id`
- `user_id` - one row per user; each user belongs to exactly one family archive
- `created_at`

### `family_invites`
- `id`
- `family_id` - the family archive the invite points into
- `inviter_user_id`
- `invitee_user_id`
- `status` - `pending`, `accepted`, or `cancelled`
- `created_at`
- `responded_at`

### `sessions`
- `token`
- `user_id`
- `created_at`

### `howlers`
- `id`
- `user_id`
- `family_id` - shared archive scope; all fellow parents see these entries
- `child_name`
- `title`
- `quote` - legacy storage column, retained for backward compatibility
- `story` - stores the current combined entry content
- `photo` - optional JPEG, PNG, WebP, or GIF data URL; decoded image payload is limited to 512 KiB
- `category`
- `happened_on`
- `age_note`
- `mood`
- `tags_json`
- `is_favorite`
- `is_public` - when `1`, entry appears in the public feed at `/api/feed`
- `created_at`
- `updated_at`

API entry objects also include derived `content`, formed by joining non-empty `quote` and `story` values with one blank line. This preserves both parts of records created before the editor fields were merged.

### `kids`
- `id`
- `user_id`
- `family_id` - shared archive scope
- `name` - display name or nickname (max 60 chars)
- `dob` - date of birth in `YYYY-MM-DD` format, or empty string
- `created_at`

## Auth Model
Authentication is token-based.

Flow:
1. user registers or logs in
2. server creates a session token
3. client stores it in `localStorage` under `howlers_webapp_token`
4. client sends it as `Authorization: Bearer <token>`
5. SSE uses `?token=` query parameter

Passwords are hashed with `crypto.scrypt` plus per-user salts.

Each account belongs to exactly one family archive through `family_members`. New users start in their own family. Accepting a fellow-parent invite merges the invitee's existing family archive into the inviter's archive so existing kids and howlers are preserved.

## API
### Auth
- `POST /api/register`
- `POST /api/login`
- `POST /api/logout`
- `GET /api/me` - returns `{ username, displayName, locale, avatar }`
- `POST /api/locale` - body `{ locale }`; currently accepts only `'bg'`, but the endpoint is kept so adding more locales later does not require a larger API refactor

### Profile
- `GET /api/profile` - returns `{ id, username, displayName, locale, avatar, familyId, familyMembers, incomingInvites, outgoingInvites }`
- `PATCH /api/profile` - body `{ displayName }`, updates display name; returns `{ ok, displayName, profile }`
- `POST /api/profile/password` - body `{ currentPassword, newPassword }`, changes password (scrypt re-hash)
- `POST /api/profile/avatar` - body `{ avatar }`, stores or clears an allowlisted raster data URL; max 300 KiB decoded; returns `{ ok, avatar }`

### Family Invites
- `POST /api/family/invites` - body `{ username }`, sends a pending invite to an existing user
- `POST /api/family/invites/:id/accept` - accepts an incoming invite and merges archives
- `DELETE /api/family/invites/:id` - cancels an outgoing invite or declines an incoming invite

### Kids
- `GET /api/kids` - returns array of `{ id, name, dob }` for the authenticated user's shared family archive
- `POST /api/kids` - body `{ name, dob? }`, adds a kid to the shared family list; triggers SSE push; returns `{ ok, kid }`
- `DELETE /api/kids/:id` - removes a kid from the shared family list (does not affect howler entries); triggers SSE push

### Admin
- `GET /admin` - localhost only; serves the admin panel HTML (403 from any other origin)
- `GET /api/admin/stats` - localhost only; returns system stats + category/mood breakdowns + memory
- `GET /api/admin/users` - localhost only; returns array of user rows with entry/session counts and `isProtected` for protected admin accounts
- `GET /api/admin/entries` - localhost only; returns all entries with user info (most recent first, limit 200)
- `PATCH /api/admin/entries/:id` - toggle `is_public` on an entry; returns `{ isPublic }`, or 404 if the entry does not exist
- `DELETE /api/admin/entries/:id` - permanently delete a single entry, or return 404 if it does not exist
- `DELETE /api/admin/users/:id` - delete user and all their data (entries, kids, sessions), close that user's live SSE streams, and return 403 for protected admin users `slanchoff` and `koldkat`
- `DELETE /api/admin/users/:id/sessions` - clear all sessions for a user, send a `sessionExpired` SSE message to active tabs, and close those streams
- `POST /api/admin/vacuum` - run `VACUUM` + WAL checkpoint to compact the database

### App State
- `GET /api/state`
- `GET /api/events`
- `GET /api/feed` - unauthenticated; returns all public howlers sorted newest first
- `GET /posts/:id` - server-rendered public landing page for a public entry; private/non-public entries return 404 with `noindex`
- `GET /sitemap.xml` - dynamic sitemap containing `/` and public entry pages only
- `GET /robots.txt` - allows public pages, disallows `/admin` and `/api/`, and points crawlers to the dynamic sitemap

### Entries
- `POST /api/howlers` - accepts the entry fields plus optional `photo` data URL; returns the created entry and refreshed app `state`
- `PUT /api/howlers/:id` - replaces entry fields; send `photo: ""` to remove the existing photo; returns the updated entry and refreshed app `state`
- `DELETE /api/howlers/:id` - returns refreshed app `state` without the deleted entry

All authenticated entry routes are family-scoped. A fellow parent can create, edit, or delete any entry in the shared family archive.
For current clients, `content` is the combined post text and `photo` is optional. Photo data must use an allowlisted raster data URL and decode to no more than 512 KiB.
When a new entry omits `happenedOn`, the server assigns its current local calendar date. Updates do not apply this default, so editing an intentionally undated legacy entry does not silently change its date.

## State Shape Returned By `/api/state`
Top-level keys:
- `app`
- `viewer`
- `profile`
- `attention`
- `summary`
- `entries`
- `kids`
- `publicFeed`

`viewer` includes:
- `id`
- `username`
- `displayName`
- `locale`
- `avatar`
- `familyId`

`summary` includes:
- total count
- favorite count
- number of kids represented
- category breakdown
- kid breakdown
- recent items
- first and last timestamps

`attention` includes:
- `pendingInviteCount`
- `pendingInviteSenders` (up to two inviter identities for UI copy)

DB size is only available through the admin panel (`/api/admin/stats`), not in user-facing state.

## UI Notes
### Layout
The app uses a persistent layout visible to all visitors:

The spacing scale is intentionally compact: panels, feed cards, form grids, and especially modal shells use reduced padding and gaps to keep more content visible while retaining practical button and input targets.

- **Sticky nav bar** at the top: app name plus equal-height themed pill controls (Sign In for guests, or `New Entry`, username chip, and a distinct coral logout button for logged-in users).
- Header copy avoids repeating the family/archive concept across eyebrow, title, and subtitle: eyebrow is `Личен дневник`, title remains the brand, and subtitle is `Реплики, случки и малки легенди`.
- **Admin panel** uses Bulgarian UI copy. Its nav bar mirrors the main app header structure, warm gradient, three-line brand treatment, dimensions, shadows, pill controls, and compact mobile behavior while retaining admin status badges and maintenance actions.
- **Feed column** (left, always visible): scrollable list of entries. For guests this shows public entries only. For logged-in users this shows the shared family archive with a simplified search-only toolbar above; if the family archive has no entries yet, it falls back to the public feed until the family creates one.
- **Sidebar** (right): guests see compact promo cards explaining the private archive, optional public posts, photos, search, parent invites, archive export, and the login/register path. Logged-in users instead see Family Snapshot stats (3 full-width stacked stat cards - total, favorites, kids - each with label on left and big number on right, color-coded with left accent border; plus category/kids chips) and the children panel. Sidebars stick below the nav bar at wide screens and stack below the feed on narrow screens.
- Tooltips use app-themed `data-tooltip` styling in the main and admin UI. Native `title` attributes are avoided for interactive controls and truncated admin text so browser-default tooltip styling does not leak into the interface.
- Bulgarian count copy selects singular and plural forms independently for entries/stories and children, avoiding slash forms such as `дете/деца`.
- entry metadata is assembled from non-empty child, date, and age-note values, so undated entries do not render placeholder dates or stray separators

There is no separate login page. The Sign In / Register form appears as a centred modal overlay, triggered by the "Sign In" nav button. A top-right `×`, Escape, or an intentional stationary click on the backdrop dismisses it.

### Public Feed
Guests land on the feed immediately without a separate landing screen. Any entry marked as **Public** appears there.
For logged-out users, `setAuthState(false)` hides the authenticated sidebar and shows the guest promo sidebar next to the feed on wide screens.
Tags are private archive metadata: `listPublicHowlers()` replaces them with an empty array, and public cards do not render a tag container. Authenticated family state retains the original tags for search and editing.
Public feed titles link to `/posts/:id`, which is also the URL listed in the sitemap. Public post pages include canonical, description, Open Graph, Twitter summary, and JSON-LD metadata generated from public entry content.

### Dashboard (removed)
The old 12-column grid dashboard (launcher panel, recent activity, summary, spotlight, archive, favorites panels) has been replaced by the feed+sidebar layout described above.

### Editor Dialog
The howler form now lives inside a modal dialog instead of a persistent dashboard panel.

Behavior:
- the `New Entry` launcher opens a blank form dialog
- the default view is intentionally simplified for casual users: only the core fields are shown first
- the former quote and story inputs are presented as one `content` field; API responses derive it by joining non-empty legacy `quote` and `story` values with a blank line
- the database columns remain for backward compatibility; current `content` writes store the complete combined text in `story` and clear `quote`, preserving all visible text when an old entry is edited
- the editor accepts one post photo, previews it locally, retains it during edits, and allows explicit replacement or removal
- browser-side processing converts uploads to JPEG, limits the longest edge to 1600 px, and reduces quality/dimensions until the decoded payload is at most 512 KiB
- the server independently allowlists JPEG/PNG/WebP/GIF data URLs, validates their binary signatures, and rejects decoded payloads above 512 KiB
- custom SVG emoticon palettes below the title and combined content field provide 12 hand-drawn expressions and insert any number at the current text caret; they do not use Unicode emoji or platform-default artwork
- inline faces are stored in the existing text fields as allowlisted tokens such as `:laugh:` and rendered as SVG only after all ordinary text is HTML-escaped
- rendered SVG markup is emitted without surrounding whitespace so fields using `white-space: pre-wrap` do not introduce line breaks around emotes
- compact formatting toolbars support bold, italic, underline, and strikethrough in the title and combined content field using `[b]`, `[i]`, `[u]`, and `[s]` markers
- the editor remembers the latest title/content selection, so toolbar clicks wrap the selected text in the correct field even after the button receives pointer input
- the same formatting actions are available from `Ctrl/Cmd+B`, `Ctrl/Cmd+I`, `Ctrl/Cmd+U`, and `Ctrl/Cmd+Shift+X`, operating on the current selection or caret in new and edit dialogs
- formatting markers are stored as plain text, converted only to fixed allowlisted HTML elements after escaping, retained verbatim in TXT export, and rendered in the printable HTML export
- optional metadata such as date, category, mood, tags, favorite/public flags, and age note live behind an explicit advanced-options toggle
- the advanced section uses the actual `hidden` attribute now, so it stays collapsed until explicitly opened
- child selection is now a themed in-app select instead of an unstyleable browser datalist
- choosing an existing child with a saved birth date auto-fills the entry age note based on the selected entry date (or today when no date is set)
- clicking `Edit` on any entry opens the same dialog in edit mode
- save and delete actions close the dialog after a successful request
- the editor and profile use a consistent circular `×` control in the top-right
- pressing `Escape` or intentionally clicking the backdrop closes a dialog
- backdrop dismissal requires the pointer press and release to both occur on the backdrop with negligible movement, so dragging a text selection outside the dialog does not close it
- the main app and admin backgrounds keep both the color bands and SVG drawing layers fixed while content scrolls

### Favorite + Public Controls
Both the favorite and public toggles are styled as checkbox cards (see **Favorite Control** below).

- **Favorite**: includes the entry in the family favorite count and marks it as a favorite in the archive.
- **Public**: makes the entry visible to anyone in the public feed at `/api/feed`.

The public/favorite state is edited in the form, but not repeated as extra chips on the feed cards.

### Profile + Family Archive
The profile modal now has a **Family Archive** section.
- profile identity saves return the complete refreshed profile; the client renders from its merged profile object so partial SSE or mutation payloads cannot blank fields such as `displayName`

Behavior:
- shows every current family member
- lets the user send a username-based invite to another existing account
- pins incoming invites to a highlighted attention section at the very top of the profile modal, with **Accept** / **Decline**
- lists outgoing invites with **Cancel invite**
- surfaces pending incoming invites outside the profile modal too, via a highlighted archive notice and a count badge on the nav profile button
- accepting an invite merges both archives into one shared family archive

The avatar uploader in the profile modal uses a small circular `+` badge anchored to the avatar preview. Hover/focus reveals a themed tooltip; the old full-overlay avatar text is no longer shown.

### Favorite Control
The favorite toggle is intentionally not browser-native in appearance.
It is implemented as:
- a real checkbox for semantics
- visually restyled into a themed card control
- custom checked indicator via CSS

### Confirmation Dialog
Deletion uses a custom modal instead of `window.confirm()`.

Implementation:
- HTML overlay and dialog in `public/index.html`
- modal styles in `public/css/style.css`
- promise-based confirm helper in `public/js/app.js`

### Theme
The current UI theme is intentionally colorful and playroom-inspired:
- the page background uses the shared full-viewport `public/background-scene.svg` illustration over three CSS color bands, with small doodles distributed toward both sides so wide displays do not leave the edges empty
- doodles follow the meaning of each band: the blue sky contains the sun, clouds, and several simple flying-bird marks made from uneven paired arcs; the yellow sand contains an unmistakable sandcastle, pail, shovel, and beach ball; the green grass contains a child-drawn house with a diagonally tilted chimney visibly attached to the roof, a tree, flowers, grass tufts, one running stick figure, and another waving while holding a balloon
- the SVG is built from simple one-stroke constructions with uneven outlines, doubled crayon-like marks, mismatched details, imperfect symmetry, and inconsistent proportions; repeated objects are drawn separately rather than cloned so the scene resembles a child's drawing rather than polished icon art
- a low-contrast CSS texture layer sits fixed over the page so the background keeps some depth without continuous animation cost
- the sticky header is translucent on purpose so the top of the doodle scene can visually continue through it instead of being cut off
- panel sections use distinct color families so the dashboard feels more playful and thematic
- preserved layout, spacing, and component structure so this remains a styling-only change

## Live Update Model
The client hydrates once, then opens `/api/events`.

Live update behavior:
- authenticated sessions receive the full app state over SSE, including viewer/profile data, family archive state, kids, attention data, and the current public feed
- failed or already-closed SSE responses are removed from the registry so they cannot make an unrelated mutation return a server error
- guest sessions can also subscribe to `/api/events`; they receive public-feed updates without logging in
- authenticated SSE clients keep their session token attached server-side; if the token is deleted by logout, admin session clearing, or user deletion, the server sends `{ sessionExpired: true }` and closes the stream
- the client handles `sessionExpired` by clearing the local token, closing private dialogs, rendering the public feed, reopening guest SSE, and showing the login dialog
- profile modal content can now update live because the SSE payload includes `profile`
- entry create/update/delete and admin public-entry changes fan out through SSE so both the public feed and authenticated public-feed fallback stay current
- the mutating tab renders the refreshed `state` returned by create/update/delete immediately; SSE remains the cross-tab and cross-user synchronization mechanism rather than the only local refresh path
- transient SSE connection drops are allowed to reconnect quietly; the client no longer turns every short interruption into a visible disconnect warning
- family/profile/kid/invite changes still publish only to affected authenticated users

CPU-oriented guardrails:
- avoid animating full-screen fixed background layers unless there is a strong reason
- avoid scroll-time blur effects on persistent surfaces like the sticky header
- debounce user-driven re-renders such as live search instead of repainting on every keystroke

## Validation Rules
Server-side validation requires:
- `childName`
- `title`
- non-empty `content` for the current client, while legacy `quote`/`story` API payloads remain accepted
- a real calendar date in `YYYY-MM-DD` form if date is present
- bounded lengths for child name, title, and combined content; legacy quote/story payloads retain their previous limits
- category in `said | did | mixed | milestone | oops | wisdom | art | bedtime`
- mood in `golden | chaotic | sweet | legendary | hilarious | heartwarming | facepalm | proud | bittersweet`

All validation, authentication, invite, image, and general API errors returned to the Bulgarian client use Bulgarian wording. The static HTML also contains Bulgarian fallback copy before the locale bundle finishes loading.

## Documentation Guard
The repo includes a lightweight documentation guard:

- `npm run docs:check` checks staged files in git, or accepts explicit file paths as arguments
- if relevant app files changed under `public/`, `server/`, `server.js`, `package.json`, or `package-lock.json`, the guard expects at least one tracked Markdown doc (`docs/USER_GUIDE.md`, `docs/TECHNICAL.md`, or `docs/ADMIN.md`) to be updated in the same change
- `npm run hooks:install` copies `.githooks/pre-commit` into `.git/hooks/pre-commit`
- `npm install` also triggers the installer through the `prepare` script when the project is inside a git checkout
- set `DOCS_GUARD_BYPASS=1` only for changes that are genuinely documentation-neutral

Documentation conventions:
- meaningful user-visible or maintenance-relevant changes should be reflected in the docs
- `TECHNICAL.*` should stay in English
- `USER_GUIDE.*` should stay concise, Bulgarian, and easy for non-technical users to scan
- `ADMIN.*` should stay Bulgarian and focused on localhost-only maintenance tasks

This does not replace judgment. The check exists to force a docs review whenever code changes are likely to affect behavior, UI, setup, API, auth/session handling, storage, or maintainability.

## Static Assets
- `public/favicon.svg`: browser favicon asset; uses a hand-drawn sun illustration inspired by the app background doodles aligned with the app's playful family archive theme
- `public/background-scene.svg`: shared main/admin background illustration aligned to the blue, yellow, and green color bands
- `public/emoticons.svg`: custom hand-drawn SVG symbol sprite used for inline text emotes in the editor, feed cards, and print export
- `public/locales/bg.json`: Bulgarian UI strings

## Internationalization
The app ships a lightweight i18n layer (`public/js/i18n.js`) with no external dependencies.

Key exports:
- `initI18n(preferredLocale)`: loads the given locale (or default if unsupported), applies translations to the static DOM
- `t(key, vars)`: returns the translated string for `key`; `vars` is an optional object of `{placeholder: value}` substitutions
- `setLocale(lang)`: switches locale and re-applies translations to the static DOM (no storage side-effect - the caller decides where to persist)
- `getLocale()`: returns the active locale code
- `applyI18n()`: walks `[data-i18n]`, `[data-i18n-placeholder]`, and `[data-i18n-tooltip]` elements and sets their localized text/placeholder/tooltip data; also sets `document.documentElement.lang`

Supported locales:
- `bg` - Bulgarian

Adding a new locale:
1. Create `public/locales/<code>.json` with the same keys as `bg.json`
2. Add the code to the `SUPPORTED` array in `i18n.js`
3. Re-enable a UI switcher in `app.js` and/or the auth/profile flows if you want runtime language switching

English support has been removed from the shipped UI, but the i18n layer remains in place so additional locales can be added later without refactoring the whole app.

## Responsive / Mobile
Three CSS breakpoints in `public/css/style.css`:

| Breakpoint | Target | Key changes |
|---|---|---|
| `≤ 860px` | Tablet | Single-column layout; sidebar unsticks and flows below feed |
| `≤ 600px` | Phone | Base font 14px; nav eyebrow hidden, profile chip collapses to avatar only; toolbar stacks; editor and profile modal become bottom sheets (full-width, rounded top corners); entry card heads stack; config form goes 1-column |
| `≤ 400px` | Small phone | Slightly smaller buttons; confirm dialog actions stack vertically |

Responsive UI is a standing requirement for this app:
- new UI work must remain usable at tablet and phone widths, not just desktop
- no new feature should introduce horizontal overflow for core screens, dialogs, forms, or alerts
- action rows must wrap or stack cleanly for touch use
- profile, auth, editor, kids, and invite flows should stay fully usable on mobile after future changes
