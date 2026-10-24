<p align="center"><img src="frontend/public/logo.svg" alt="Tallyfin logo" width="112"></p>
<h1 align="center">Tallyfin</h1>
<p align="center">Keep a tally of who pays for your Jellyfin server: plans, payment dates, reminders, and usage-based profitability.</p>

Tallyfin is a small self-hosted app to manage the people who pay for access to your Jellyfin server.

- **Subscribers** are imported from Jellyfin with your API key. Every Jellyfin user shows up; you decide who is billed, who is exempt (family, admins) and who is paused or cancelled.
- **Plans** are prices for a period (10 USD / month, 100 USD / year, 5 CAD / 2 weeks…).
- **Payments** are recorded per subscriber. Recording one extends the next payment date by one plan period (paying early extends from the current due date, not from today).
- **Reminders** go out as a daily digest (Discord, Telegram, ntfy, Gotify, email, or a generic webhook) N days before a payment is due, on the due date, and while it is overdue.
- **Usage** comes from [Tracearr](https://tracearr.com) (watch time, plays, transcodes, last watched, top titles) and [Seerr / Jellyseerr](https://seerr.dev) (requests), matched to each Jellyfin user automatically.
- **Profitability** compares what each subscriber pays with how much they actually use the server, ranks them, and (optionally) allocates your monthly server cost by watch-time share to show a per-subscriber margin.

Stack: Django 5 + Django REST Framework backend, React 18 + Vite frontend, PostgreSQL, packaged as two Docker images (backend, frontend) plus a Postgres service.

## Quick start (Docker)

```bash
cp .env.example .env         # set SECRET_KEY, POSTGRES_PASSWORD, TZ
docker compose up -d --build
```

Open `http://your-host:8080`. The first visit asks you to create the admin account (or set `ADMIN_PASSWORD` in `.env` to create it automatically).

Then in **Settings**:

1. **Jellyfin**: server URL and an API key (Jellyfin dashboard → Administration → API Keys). Click *Test connection*, save, then *Sync now* in the top bar to import your users.
2. **Tracearr** (optional): URL and a public API key (Tracearr → Settings → API Keys, starts with `trr_pub_`).
3. **Seerr / Jellyseerr** (optional): URL and the API key from Settings → General.
4. **Notification channels**: at least one, otherwise reminders only appear inside the app.

Create your plans under **Plans**, then open **Subscribers**, click *Edit* on a user, assign a plan and the next payment date. Use *Payment* to record money received.

### Services

| Service     | Role                                                                 |
|-------------|----------------------------------------------------------------------|
| `db`        | PostgreSQL 16 with a named volume                                    |
| `backend`   | Django API (gunicorn). Runs migrations and creates the admin on start |
| `scheduler` | Same image, runs `manage.py run_scheduler`: periodic sync + daily reminder digest |
| `frontend`  | nginx serving the React build and proxying `/api/` and `/admin/` to the backend |

Only the frontend publishes a port (`APP_PORT`, default 8080). Put it behind your reverse proxy (Cloudflare Tunnel, Traefik, Nginx Proxy Manager, Caddy…) for HTTPS: the bundled nginx forwards the original scheme and host (`X-Forwarded-Proto`, or Cloudflare's `CF-Visitor`), so no extra configuration is needed. With Cloudflare Tunnel, point the tunnel's public hostname at `http://frontend:80` (cloudflared on the same Docker network) or at `http://<host>:8080`. Set `COOKIE_SECURE=1` once you are on HTTPS. If your proxy strips `X-Forwarded-Proto`, add the public URL to `CSRF_TRUSTED_ORIGINS`.

All variables in `.env.example` can also be given as stack environment variables (Portainer, Dockge…); the `.env` file is optional.

## Deploying published images (GitHub Container Registry)

The workflow in `.github/workflows/ci.yml` runs on every push to `main`/`master`, on `v*` tags, and on pull requests:

1. Backend tests against a real Postgres, a migrations check, and the frontend typecheck + build.
2. If those pass (and it is not a pull request), it builds both images for `linux/amd64` and `linux/arm64` and pushes them to `ghcr.io/<owner>/<repo>-backend` and `ghcr.io/<owner>/<repo>-frontend` with these tags:

| Push to default branch | Git tag `v1.2.3` |
|---|---|
| `sha-<short sha>`, `sha-<full sha>`, `<branch>`, `latest` | `1.2.3`, `1.2`, `latest` |

Packages on GHCR are private by default. Either make them public (package → Package settings → Change visibility) or run `docker login ghcr.io` on the server with a personal access token that has `read:packages`.

On the server you only need `docker-compose.prod.yml` and a `.env`:

```bash
# .env: set IMAGE_PREFIX=ghcr.io/<owner>/<repo> plus the usual SECRET_KEY, POSTGRES_PASSWORD, TZ
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d

# roll to (or back to) an exact commit
IMAGE_TAG=sha-1a2b3c4 docker compose -f docker-compose.prod.yml up -d
```

`docker-compose.yml` (without `.prod`) keeps building from source for local use.

## How it works

### Statuses

| Status     | Meaning                                                                 |
|------------|-------------------------------------------------------------------------|
| Active     | Has a plan, next payment is later than the due-soon window              |
| Due soon   | Payment due within *Due-soon window* days (default 7) or within the grace period |
| Overdue    | Past the due date plus *Grace period* days                              |
| No plan    | Jellyfin user with no plan assigned (not billed)                        |
| Exempt / Paused / Cancelled | Manual billing status; never reminded, not counted in revenue |
| Exemption expired | An exempt account whose *Exempt until* date has passed (trial over) |

### Access enforcement

When enabled (Settings → Access enforcement, on by default) the scheduler disables the Jellyfin account of anyone whose subscription has lapsed, and logs them out everywhere:

- **Who**: billed subscribers overdue past the grace period (plus an optional number of extra days), and exempt accounts whose *Exempt until* date has passed. Jellyfin administrators are never touched.
- **How**: the user policy is set to disabled, a message is shown on their active sessions, playback is stopped, and every device registered to the user is deleted, which revokes its tokens so all clients are signed out.
- **Restore**: an account that Tallyfin disabled is re-enabled automatically as soon as a payment (or a new exemption date) puts the subscriber back in good standing. Accounts you disabled manually, in Tallyfin or in Jellyfin, are left alone.
- **Audit and notice**: every change is logged on the subscriber's page and on the Reminders page, and a notification goes to your channels. `manage.py enforce_access --dry-run` previews what would change.

### Reminders

The scheduler checks every minute. Once a day at *Send time* it collects every paying subscriber whose due date triggers a reminder:

- `due_in_N` for each N in *Days before due date* (default `7,3,1`)
- `due_today`
- `overdue_N` on the first overdue day after the grace period, then every *Repeat overdue every* days

All triggered items go out as **one digest** to every configured channel. Each (subscriber, kind, due date) is logged so nothing is sent twice. The **Reminders** page shows what is pending, lets you preview the digest, and send it immediately.

### Sync

Every *Sync interval* minutes (and whenever you click *Sync now*):

1. Jellyfin `/Users` → subscriber list, admin/disabled flags, last login. Users deleted in Jellyfin are flagged as removed, never deleted here (their payment history stays).
2. Tracearr `/api/v2/public/users` → identities matched on `external_user_id` (the Jellyfin user id) or username; `/users/{id}/stats` for 7-day / 30-day / all-time plays and watch time; `/history?since=30d` for transcodes, active days, top titles and last watched.
3. Seerr `/api/v1/user` → matched on `jellyfinUserId` or username; `/request?requestedBy=` for the request count in the last 30 days.

If automatic matching picks the wrong identity you can set the Tracearr / Seerr user id manually in *Edit subscription → matching overrides*.

### Profitability

For each subscriber (last 30 days):

- **Revenue / month** = plan price normalised to a month.
- **Revenue per hour** = revenue / hours watched. High = pays a lot for little use.
- **Usage share** = their hours / everyone's hours.
- **Running cost** = electricity + other fixed costs, where electricity = server watts × hours on per day × 30.44 days × price per kWh (Settings → Billing).
- **Allocated cost** = running cost × usage share; **margin** = revenue − allocated cost (shown once a running cost is configured).
- **Transcode %** and **requests** highlight CPU-heavy or request-heavy users.

The *Everyone* view includes exempt users and users without a plan so you can see free usage.

### Jellyfin access

A subscriber's page has *Disable Jellyfin access* / *Enable Jellyfin access*, which flips `IsDisabled` on the Jellyfin user policy. It is always a manual action; nothing is disabled automatically.

## Development

Backend (uses SQLite unless `DATABASE_URL` is set):

```bash
cd backend
python -m venv .venv && .venv/Scripts/activate      # or source .venv/bin/activate
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver 8000
python manage.py test                               # test suite
python manage.py run_scheduler --once               # one scheduler tick
python manage.py sync_now                           # sync from the CLI
python manage.py send_reminders --dry-run           # preview today's digest
```

Frontend (Vite dev server proxies `/api` to `localhost:8000`):

```bash
cd frontend
npm install
npm run dev
```

The proxy keeps the browser's `Host` header so Django's CSRF origin check passes, and `http://localhost:5173` / `http://127.0.0.1:5173` are trusted by default. If you serve the dev UI from another origin, add it to `CSRF_TRUSTED_ORIGINS`.

The Django admin is available at `/admin/` with the same account if you need to look at raw data.

## API

All endpoints live under `/api/` and use session authentication (cookie + `X-CSRFToken` header).

| Endpoint | Purpose |
|---|---|
| `GET/PUT /api/settings/` | Integration keys, billing rules, reminder schedule, channels (secrets are masked) |
| `POST /api/settings/test/{jellyfin|tracearr|seerr}/` | Test a connection |
| `GET /api/plans/`, `POST`, `PATCH /{id}/`, `DELETE /{id}/` | Plans |
| `GET /api/subscribers/`, `GET/PATCH /{id}/` | Subscribers with status and usage |
| `POST /api/subscribers/{id}/payments/` | Record a payment (extends the due date) |
| `GET /api/subscribers/{id}/activity/` | Live recent plays and requests |
| `POST /api/subscribers/{id}/jellyfin-access/` | Enable / disable the Jellyfin account |
| `GET /api/payments/`, `DELETE /api/payments/{id}/` | Payment ledger |
| `GET /api/dashboard/` | Counts, MRR, revenue by month, attention list, now playing |
| `GET /api/profitability/` | Ranked revenue-vs-usage table |
| `GET/POST /api/sync/` | Sync status / trigger a sync |
| `GET/POST /api/reminders/` | Pending, upcoming, log / send (or `{"dry_run": true}` to preview) |
| `GET/POST /api/enforcement/` | Accounts about to be disabled / restored, recent access events / apply now (or `{"dry_run": true}`) |
