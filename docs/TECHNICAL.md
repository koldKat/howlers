# Howlers Webapp Technical Documentation

## Purpose and stack

Howlers Webapp is the repository name. The Bulgarian product name shown in the UI is **Семейни бисери**.

The application is intentionally small and self-contained:

- Node.js built-in HTTP server
- SQLite through `better-sqlite3`
- vanilla JavaScript ES modules in the browser
- server-sent events for live updates
- no frontend framework or build step
- Bulgarian UI strings loaded through a lightweight i18n module

Maintained browser assets use clean, unversioned URLs. The static server sends `Cache-Control: no-cache` and a content ETag, so each load revalidates the file, unchanged files return `304 Not Modified`, and deployments do not require a manual `?v=N` cache-busting cascade.

## Requirements and startup

Runtime requirements:

- Node.js 18 or newer
- npm
- `zip` available on `PATH` for automatic database archives

Install and run:

```bash
npm install
npm start
```

The default address is `http://localhost:3019`.

Environment variables:

- `PORT`: listener port, default `3019`
- `DATABASE_PATH`: absolute path or a path resolved from the process working directory, default `database.sqlite` in the repository root
- `DISABLE_BACKUPS=1`: disables backup scheduling
- `PUBLIC_URL`: trusted origin used in password-reset links, default `https://biseri.net`

The server binds through `server.listen(PORT)` and is therefore reachable on the interfaces selected by Node.js for the host. Admin routes require a localhost socket and reject requests carrying `Forwarded`, `X-Forwarded-*`, or `X-Real-IP`.

## Repository layout

Server composition:

- `server.js`: process entry point, HTTP listener, SSE hub wiring, session cleanup, and backup startup
- `server/app.js`: central request dispatcher and error boundary
- `server/config.js`: paths, limits, backup policy, MIME types, and protected usernames
- `server/http.js`: JSON responses, bounded request parsing, token extraction, and localhost detection
- `server/date-validation.js`: shared local date formatting and real calendar date validation
- `server/entry-ages.js`: backward-compatible per-child age snapshots for multi-child entries
- `server/auth.js`: authenticated session guard
- `server/auth-rate-limit.js`: process-local failed-authentication window by client IP
- `server/mailer.js`: SMTP settings, validation, encoded multipart message generation, bounded connections, and TLS delivery
- `server/db.js`: stable persistence facade used by routes and services
- `server/db/connection.js`: SQLite connection and startup initialization
- `server/db/schema.js`: idempotent schema creation, migrations, and family bootstrap
- `server/db/accounts.js`: credentials, email, lockouts, reset tokens, sessions, viewer data, and profile persistence
- `server/db/families.js`: family membership, invitations, merges, and children
- `server/db/entries.js`: entry queries, writes, mapping, and summaries
- `server/db/admin.js`: admin reports, mutations, maintenance, and backup snapshots
- `server/child-names.js`: singular and multi-child compatibility normalization
- `server/state.js`: authenticated and guest state builders
- `server/sse.js`: live client registry and state publishing
- `server/static.js`: static files under `public/`
- `server/public.js`: public and private-link post HTML, sitemap, and robots output
- `server/export.js`: TXT and print/PDF export rendering
- `server/image-validation.js`: raster data URL size and signature checks
- `server/howler-validation.js`: entry normalization and validation
- `server/backup.js`: hourly ZIP creation and 14-day retention
- `server/routes/session.js`: registration, login, password reset, logout, state, export, and SSE handlers
- `server/routes/profile.js`: profile, avatar, and password handlers
- `server/routes/families.js`: child and family-invitation handlers
- `server/routes/entries.js`: entry create, update, and delete handlers
- `server/routes/admin.js`: localhost-only admin handlers

Browser code:

- `public/index.html`: main app and modal structure
- `public/site.webmanifest`, `public/favicon.svg`, and `public/icons/`: install metadata and app icon assets
- `public/js/app.js`: application boot, auth lifecycle, editor submission, dialogs, and SSE orchestration
- `public/js/app/api.js`: token storage and JSON API wrapper
- `public/js/app/constants.js`: categories, moods, emoticons, formatting, and client upload limits
- `public/js/app/dom.js`: DOM references and backdrop dismissal
- `public/js/app/child-picker.js`: multi-child selection and age-note calculation
- `public/js/app/editor-tools.js`: cursor-aware shared formatting and emoticon controls, shortcuts, photo processing, and editor controls
- `public/js/app/entry-presentation.js`: entry labels, metadata, inline formatting, and SVG emoticon rendering
- `public/js/app/feed.js`: public and private feed rendering, filtering, and summary presentation
- `public/js/app/feed-loading.js`: reusable feed-loader cloning and localized status updates
- `public/js/app/auth.js`: login, registration, forgot-password, and reset-password controller
- `public/js/app/post-detail.js`: public/private-link detail dialog, browser history, and Web Share integration
- `public/js/app/format.js`: escaping, dates, and data URL sizing
- `public/js/app/kids.js`: child-list rendering and child create/delete actions
- `public/js/app/profile.js`: profile modal, avatars, passwords, exports, and family invitations
- `public/js/i18n.js`: locale loading and DOM translation
- `public/locales/bg.json`: Bulgarian strings
- `public/admin.html`, `public/js/admin.js`, `public/js/admin/*`, `public/css/admin.css`: admin panel

Documentation and verification:

- `scripts/regression-test.js`: isolated HTTP regression suite
- `scripts/docs-guard.js`: staged-change documentation guard
- `scripts/generate-docs.js`: Markdown to HTML documentation generator and sync checker
- `.githooks/pre-commit`: repository pre-commit hook
- `docs/*.md`: documentation sources
- `docs/*.html`: generated standalone equivalents

## Request flow

`server.js` constructs the application dependencies and starts the listener. `server/app.js` parses the URL, dispatches explicit API and SEO routes to feature handlers, and falls back to static GET handling. Its awaited dispatch is the shared error boundary for synchronous and asynchronous route failures. JSON request bodies are limited to 2 MiB and must contain an object. Oversized requests, malformed JSON, non-object JSON, and malformed encoded paths return `400` or `413` as appropriate.

API responses use JSON unless the route explicitly returns HTML, XML, plain text, an export, or an SSE stream. Unmatched non-GET routes return `404`.

New usernames are trimmed and limited to 60 characters. Registration and password changes require passwords from 6 through 256 characters. Login remains compatible with existing credentials created before these limits were enforced.

Static serving resolves paths below `public/` and rejects traversal outside that root.

The install manifest exposes the SVG favicon with `purpose: any` and opaque 192 px and 512 px PNG icons with `purpose: any maskable`. The maskable declaration lets adaptive Android launchers clip the sky-blue `#57b9ff` canvas directly instead of placing it inside a white fallback circle. New sky-icon filenames prevent reuse of older cached black icon files. The separate 180 px Apple touch icon uses the same sun artwork on the same sky-blue background. The manifest uses `#57b9ff` for browser chrome and `#fff6dc` for the launch background, matching the app's sky and cream theme colors. PNG and web manifest files have explicit response MIME types.

The feed starts with a functional loading state whose sun matches `public/favicon.svg`. Its eight rays are grouped into four opposite pairs and animated only through opacity, so each pair appears and disappears together. `public/js/app/feed-loading.js` retains the initial semantic loader as a template and restores it before public-feed transitions; this clears authenticated cards immediately during logout or session expiry instead of leaving private content visible while `/api/feed` is pending. Successful public or authenticated rendering replaces the loader directly. `prefers-reduced-motion: reduce` disables the ray animation and leaves all pairs visible.

## Database and migrations

The database connection module enables WAL mode and foreign keys at startup, then delegates initialization to the schema module. Schema creation is idempotent. Older databases are upgraded with `addColumnIfMissing()` calls and a family bootstrap transaction. Feature repositories import the initialized connection and are combined through `server/db.js`, which keeps the existing persistence API stable for callers.

### `users`

- `id`, `username`, `password_hash`, `salt`, `created_at`
- `locale`, currently normalized to `bg`
- optional `display_name`
- optional `avatar` data URL
- optional case-insensitively unique `email`
- `failed_login_attempts` and optional `locked_until`; `-1` represents an indefinite admin lock

Avatars must be JPEG, PNG, WebP, or GIF and decode to no more than 300 KiB.

### `families` and `family_members`

Each user belongs to exactly one family through a unique `family_members.user_id`. A new user receives a new family. Entries and children are scoped by `family_id` so every family member sees the shared archive.

### `family_invites`

Invites record the target family, inviter, invitee, status, creation time, and response time. Status is `pending`, `accepted`, or `cancelled`.

Accepting an invite runs in a transaction. It moves the invitee family's entries, children, members, and relevant pending invites into the inviter family, then removes the old family row. This is a merge, not a reversible membership toggle.

### `sessions`

- bearer `token`
- `user_id`
- `created_at`
- `last_active_at`

`getSession()` updates `last_active_at`. At server startup, sessions inactive for more than seven days are purged. Session deletion is also used by logout and admin session clearing.

### `password_reset_tokens` and `mail_settings`

Reset rows store a SHA-256 token hash, user, expiry, optional use time, and creation time. Raw 256-bit reset tokens exist only in the generated email link. Tokens expire after one hour and are one-time use.

`mail_settings` contains one row with SMTP host, port, `tls`, `starttls`, or `none` security, username, password, sender, and update time. Admin responses expose only `hasPassword`, never the password value.

### `kids`

Children have an owner `user_id`, shared `family_id`, name, optional `dob`, and creation time. Removing a child from the family list does not alter existing entry text.

### `howlers`

Important columns:

- owner `user_id` and shared `family_id`
- legacy first-child `child_name`, full `child_names_json`, `title`, `happened_on`, and `age_note`
- legacy `quote` plus current `story`
- `photo`, `category`, `mood`, and `tags_json`
- `is_favorite` and `is_public`
- optional unique `share_token` for private link sharing
- `created_at` and `updated_at`

`child_names_json` stores the complete ordered child-name list. `child_name` remains populated with the first name for backward storage compatibility. Startup migration backfills existing rows as one-item lists. API objects expose `childNames` plus a compatibility `childName` label that joins all names with commas. Create and update requests accept `childNames`; requests using the former singular `childName` remain valid.

The browser derives `age_note` from the entry date and every selected saved child that has a birth date. A single child keeps the compact age value. Multiple children use semicolon-separated name-to-age pairs so the stored snapshot and all feed/export views remain unambiguous. A manually edited age note is preserved.

API objects expose derived `content` by joining non-empty `quote` and `story` values with one blank line. Current clients store the combined editor content in `story`; the old columns remain readable so earlier records are not lost.

Entry photos use allowlisted raster data URLs and decode to no more than 512 KiB. Images and avatars are stored inside SQLite, so they contribute directly to database and backup size.

## Authentication and authorization

Passwords are hashed with `crypto.scrypt` and a random per-user salt. Session tokens are 32 random bytes encoded as hexadecimal.

Five consecutive incorrect passwords temporarily lock a normal account for 15 minutes. Successful authentication or admin unlock clears the account counter. A process-local IP throttle blocks subsequent login or registration requests after eight failures within 15 minutes and is cleared by successful authentication. Forwarded addresses are trusted only when the immediate peer is localhost; when local Nginx appends a chain, the throttle uses its last address rather than a client-controlled first value. Expired per-address buckets are purged every 15 minutes. `slanchoff` and `koldkat` bypass automatic and manual lock logic.

An admin lock uses `locked_until = -1`, revokes all sessions, and closes active SSE clients. Resetting a password clears temporary lock state and revokes sessions, but does not bypass an indefinite admin lock.

Forgot-password requests return the same message for present, absent, and email-less accounts. A separate process-local limit allows three reset requests per client address in 15 minutes. A token is stored only after SMTP accepts the reset message. Links are built from trusted `PUBLIC_URL`, never the request `Host` header. SMTP connections time out after 15 seconds, and non-ASCII sender names and subjects use encoded mail headers.

Normal API clients send `Authorization: Bearer <token>`. EventSource and browser export navigation use `?token=` because those browser APIs do not set the bearer header in this app.

Authorization boundaries:

- authenticated archive routes are scoped to the session user's family
- every family member can create, edit, and delete entries in that shared archive
- public feed and public post routes expose only entries with `is_public = 1`
- public entry objects replace tags with an empty array
- private link routes require a valid random share token and also replace tags with an empty array
- admin routes depend on a direct localhost socket with no forwarding headers, not a user role
- `slanchoff` and `koldkat` cannot be deleted or locked through the admin API

Tokens are stored in browser `localStorage`. Deployments should use HTTPS when accessed across a network and should avoid logging URLs containing export or SSE tokens.

## API routes

### Authentication and profile

- `POST /api/register`: `{ username, password, email? }`, returns `{ token, username }`
- `POST /api/login`: `{ username, password }`, returns `{ token, username }`
- `POST /api/password-reset/request`: `{ identity }`, returns a non-enumerating delivery message
- `POST /api/password-reset`: `{ token, password, passwordConfirm }`, consumes a one-time token
- `POST /api/logout`: deletes the supplied session and closes its SSE clients
- `GET /api/me`: returns `{ username, email, displayName, locale, avatar }`
- `POST /api/locale`: authenticated compatibility endpoint that normalizes the account locale to `bg`
- `GET /api/profile`: profile, family members, and pending invites
- `PATCH /api/profile`: updates `displayName` and optional recovery `email`, then returns the refreshed profile
- `POST /api/profile/password`: changes a password after verifying the current password
- `POST /api/profile/avatar`: stores or clears an avatar data URL

### State and public content

- `GET /api/state`: full authenticated application state
- `GET /api/events`: guest or authenticated SSE stream
- `GET /api/feed`: public entries without private tags
- `GET /api/public/howlers/:id`: one public entry without private tags
- `GET /api/shared/:token`: one link-shared entry without private tags
- `GET /posts/:id`: server-rendered public entry or `404` for a private/missing entry
- `GET /shared/:token`: server-rendered link-shared entry with `noindex` metadata
- `GET /sitemap.xml`: root page plus up to 50,000 public entry URLs
- `GET /robots.txt`: crawler rules and sitemap address

Authenticated state contains `app`, `viewer`, `profile`, `attention`, `summary`, `entries`, `kids`, and `publicFeed`. Guest SSE state contains `app` and `publicFeed`.

### Entries and children

- `POST /api/howlers`: creates an entry and returns `{ ok, entry, state }`
- `PUT /api/howlers/:id`: replaces an entry and returns `{ ok, entry, state }`
- `DELETE /api/howlers/:id`: deletes an entry and returns `{ ok, state }`
- `POST /api/howlers/:id/share`: returns a public path or creates and returns a stable private share path
- `GET /api/kids`: lists shared family children
- `POST /api/kids`: creates a child and returns `{ ok, kid }`
- `DELETE /api/kids/:id`: removes a child from the shared list

Current entry input uses `childNames` and `content`. Legacy `childName`, `quote`, and `story` input remains accepted. Every entry requires at least one child name and either non-empty text or a valid photo. A missing title is accepted for photo entries and normalized to `Снимка`. Child names are deduplicated case-insensitively and a request may contain up to 20 names. Empty category and mood use `said` and `golden`; non-empty values must be in the fixed lists from `public/js/app/constants.js`.

New entries without `happenedOn` receive the server's current local date. Updates do not add a date to an intentionally undated old entry.

Private and public feed queries sort by immutable `created_at DESC, id DESC`. `happened_on` is event metadata only and does not affect feed position. Updating an entry changes `updated_at` but does not move it to the top of the feed.

### Family invites

- `POST /api/family/invites`: sends an invite by username
- `POST /api/family/invites/:id/accept`: accepts an incoming invite and merges families
- `DELETE /api/family/invites/:id`: declines an incoming invite or cancels an outgoing invite

### Export

- `GET /api/export?format=txt`: downloads UTF-8 plain text
- `GET /api/export?format=pdf`: returns print-oriented HTML and opens the browser print dialog

The PDF route does not generate a PDF file on the server. The user selects PDF in the browser print dialog.

### Admin

All admin routes require a direct localhost request. Requests with forwarding headers receive `403`, even when the reverse proxy connects from localhost:

- `GET /admin`
- `GET /api/admin/stats`
- `GET /api/admin/users`
- `GET /api/admin/entries`
- `PATCH /api/admin/entries/:id`
- `DELETE /api/admin/entries/:id`
- `DELETE /api/admin/users/:id`
- `DELETE /api/admin/users/:id/sessions`
- `PATCH /api/admin/users/:id/lock`
- `GET /api/admin/mail`
- `PUT /api/admin/mail`
- `POST /api/admin/mail/test`
- `POST /api/admin/vacuum`

Admin entry mutation returns `404` when the entry does not exist. Protected-user deletion and locking return `403`. Saving SMTP with a blank password preserves the existing secret.

## Entry validation

Server validation enforces:

- one through 20 children per entry, deduplicated without regard to letter case
- each child name up to 60 characters
- title up to 120 characters, with `Снимка` supplied for untitled photo entries
- current combined content up to 5,000 characters
- legacy quote up to 800 and story up to 4,000 characters
- a real calendar date in `YYYY-MM-DD` form when present
- fixed category and mood values
- raster image MIME, decoded size, and matching file signature

Entry validation errors include both `error` and a stable `field` name. The editor keeps the message in its bottom alert and applies `aria-invalid`, `aria-describedby`, and the red `editor-field-invalid` style to the matching control. Editing that control clears its visual error state and the stale message.

An entry must contain text or a photo. A valid photo-only entry may use any valid past date and does not require filler text.

Tags are normalized by trimming, removing empty values and duplicates, and keeping at most eight.

## Live update model

The browser hydrates over HTTP and then opens `/api/events`.

- authenticated clients receive full family state
- guest clients receive the current public feed
- entry mutations publish to all clients because they may affect public content
- profile, child, and invite changes publish to affected family users
- the mutating tab also renders the refreshed state from create, update, and delete responses
- invalidated sessions receive `{ sessionExpired: true }` before the stream closes
- failed streams are removed so they cannot make later mutations fail
- EventSource reconnects after transient network loss

There is no custom SSE heartbeat. Reverse proxies should allow long-lived event-stream responses and disable buffering for `/api/events`.

## Backups and recovery

At startup the scheduler waits until the next clock-hour boundary. It then runs every hour.

Each run:

1. creates a consistent temporary SQLite snapshot with `VACUUM INTO`
2. compresses it as `backups/database-YYYY-MM-DD_HH-00-00.zip`
3. removes the temporary snapshot
4. deletes `.zip` and `.sqlite` backup files older than 14 days
5. logs creation and retention results

If snapshot creation or `zip` fails, the error is logged and later hourly attempts remain scheduled. A server restart does not create an immediate backup.

Recovery is manual. Stop the server, preserve the current database files, extract a selected archive, place the recovered SQLite file at `DATABASE_PATH`, and then restart. Test recovery on a copy before replacing production data.

## Public pages and SEO

Public entry pages use `/posts/:id` and include canonical metadata, Open Graph fields, JSON-LD article data, and the normal application shell. Only public entries are included in the sitemap.

Private entries are shared through `/shared/:token`. The token is 24 cryptographically random bytes encoded as a 32-character base64url value and protected by a partial unique database index. Conditional creation prevents simultaneous share requests from replacing a token that another request just returned. The token is created only by the authenticated share endpoint, remains stable for later shares, and is never included in state, feed, SSE, or sitemap payloads. The link is intentionally accessible without login to anyone who knows it. Both the HTML response header and page metadata mark it `noindex, nofollow`. The response also uses `Cache-Control: private, no-store` and `Referrer-Policy: no-referrer`; the JSON link endpoint and private-entry API are non-cacheable as well. `/shared/` is not blocked in `robots.txt`, because a crawler must be allowed to fetch the response before it can honor `noindex`. Private numeric `/posts/:id` routes still return `404`.

The authenticated feed keeps a share action for private entries so a family member can create or reuse the token. Once `/shared/:token` is opened, the server renders the detail share control with `hidden`, and the client controller keeps it hidden based on the route kind. Public `/posts/:id` details retain the share action.

The base URL is built from `X-Forwarded-Proto`, `X-Forwarded-Host`, or `Host`. A reverse proxy must provide trustworthy values so canonical and sitemap URLs are correct.

## Frontend behavior

The main client keeps token and UI state in module scope, renders escaped user text, and converts the supported lightweight formatting markers and emoticon tokens to safe HTML.

Post bodies use justified alignment through the shared `.entry-content` rule, including feed cards, hydrated detail dialogs, and server-rendered detail content. `overflow-wrap: anywhere` protects narrow screens, while `hyphens: auto` can use the document's Bulgarian language metadata when supported by the browser.

Modal dismissal accepts Escape, the close button, or an intentional click on the backdrop. Pointer dragging that starts inside a dialog does not dismiss it when released outside.

The editor overlay follows `window.visualViewport.height` and `offsetTop`, updating on viewport resize and scroll. This avoids positioning the mobile sheet against the larger layout viewport while browser chrome or the software keyboard reduces the visible area. CSS `100dvh` is the fallback, safe-area insets pad the mobile overlay, body scrolling is locked while editing, and the editor header remains sticky inside its scroll container.

The shared-post dialog keeps the entry title only inside the entry card. Its compact header contains the shared-post label and close control, avoiding a duplicate visible title. The dialog uses `height: fit-content` because Brave's native modal top-layer rules stretch `height: auto` to the available viewport after `showModal()` hydration. It keeps an 8 px viewport margin on narrow screens and gives long posts a bounded, internally scrolling body. Private shared links hide the otherwise empty footer because they deliberately have no share action. Server-rendered detail routes use explicit 50% positioning and translation so the pre-hydration dialog is centered without stretching to the viewport. On narrow screens the family settings sheet receives dialog semantics, moves focus to its close control, traps keyboard focus while open, closes on Escape, and returns focus to its opener.

Hydrated post details preserve the server view's semantic `h1`. Closing a direct detail route restores the root title, canonical link, description, and Open Graph metadata, and removes detail-only robots, referrer, and JSON-LD elements. Reopening the mobile editor resets its scroll container to the top before it becomes visible.

Direct `/posts/:id` and `/shared/:token` responses mark their populated dialog with `data-server-rendered`. CSS fixes that dialog above the app with an opaque viewport-covering shadow before JavaScript runs. During boot, `openInitialRoute()` consumes the embedded entry immediately after localization and before authentication or feed loading. The main feed then hydrates behind the already visible modal, so a direct share hit presents the requested post first while retaining instant close-to-feed navigation.

The CSS uses three responsive ranges:

- up to 860 px: the layout becomes one column
- up to 600 px: controls stack and editor/profile dialogs become bottom sheets
- up to 860 px: family summary and child management move into a full-screen settings sheet opened from an SVG cog in the app header; its sticky close row and `z-index: 120` keep it above the `z-index: 100` navigation bar
- up to 400 px: compact actions stack where necessary

The background illustration is fixed to the viewport. Its doodles are aligned with the sky, sand, and grass color bands.

## Internationalization

`public/js/i18n.js` loads JSON locale files, applies `data-i18n`, placeholder, and tooltip attributes, and exposes `t()` for dynamic text. Only `bg` is currently supported.

To add a locale, create a matching JSON file, add its code to `SUPPORTED`, and provide a UI selection and persistence flow. Server-side errors and rendered public pages also need translation work before the application can be considered multilingual.

## Verification and documentation workflow

Available commands:

```bash
npm test
npm run docs:build
npm run docs:html-check
npm run docs:check
npm run hooks:install
```

`npm test` starts the server on a temporary port with a temporary SQLite database and backups disabled. It covers malformed and oversized requests, duplicate emails, automatic and manual account locks, forwarded-address throttling, reset-request limits, protected accounts, password reset consumption, write-only SMTP settings, profiles, passwords, avatars, invites, family merge, children and calendar dates, single-child and multi-child entries, formatting tokens, photos, public and private-link sharing, sitemap exclusion, public feed, SEO routes, export, logout, and direct-only admin routes.

`docs/*.md` files are the source of truth. `npm run docs:build` regenerates standalone HTML equivalents, while `npm run docs:html-check` fails if generated HTML is stale.

`npm run docs:check` examines staged application changes, including deletions, requires a staged Markdown documentation update when behavior, API, storage, setup, or maintainability changed, and verifies that all generated HTML files match their Markdown sources. A Git inspection error fails the check. `DOCS_GUARD_BYPASS=1` skips only the relevance check and still checks HTML synchronization.
