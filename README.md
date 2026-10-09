# PingPilot

A single-administrator URL monitor built with Cloudflare Workers, D1, React, Vite and Tailwind CSS.

## Features

- Secure administrator login with PBKDF2 password hashing and HttpOnly, Secure, SameSite=Strict session cookie.
- D1-backed targets, sessions, and execution logs.
- Scheduled HTTP GET checks with preset intervals: 1, 5, 15, 30, and 60 minutes.
- Manual "Ping now", pause/resume, delete, status, latency and execution history.
- 10-second timeout; request redirects are not followed.
- Logs are pruned to the most recent 7 days.
- Bounded scheduled dispatch per minute.

## Requirements

- Node.js 20+ (tested on 22)
- A Cloudflare account (the free plan is enough)

## Deploying to Cloudflare

All commands run from the project root. They work the same in PowerShell, cmd, and bash.

### 1. Install dependencies

```bash
npm install
```

### 2. Log in to Cloudflare

```bash
npx wrangler login
```

This opens a browser window to authorize Wrangler. Confirm with:

```bash
npx wrangler whoami
```

### 3. Create the D1 database

Skip this step if `wrangler.toml` already has a real `database_id` under `[[d1_databases]]` that belongs to your account.

```bash
npx wrangler d1 create pingpilot-db
```

Copy the `database_id` from the output into `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "pingpilot-db"
database_id = "<your-database-id>"
migrations_dir = "migrations"
```

### 4. Apply the database schema

```bash
npm run db:remote
```

This applies everything in `migrations/` to the production D1 database. Re-run it whenever a new migration file is added.

### 5. Create the administrator account

```bash
npm run admin:create:pbkdf2
```

Answer the prompts:

- **Admin username**: 3–40 characters, letters, digits, `.`, `_`, `-`.
- **Admin password**: 12+ characters. Use a unique password you have not shared anywhere.
- **Database target**: `remote` for production.

The script hashes the password locally (PBKDF2-SHA256, 100,000 iterations, the maximum Cloudflare Workers allows) and inserts only the hash and salt into D1. Running it again with an existing username resets that admin's password and signs out its sessions.

### 6. Build and deploy

```bash
npm run build
npm run worker:deploy
```

`npm run build` type-checks and builds the React UI into `dist/`. `wrangler deploy` uploads the Worker together with `dist/` as static assets and registers the once-a-minute Cron Trigger.

On the first deploy Cloudflare may ask you to pick a `workers.dev` subdomain. Wrangler prints the live URL when it finishes, e.g. `https://pingpilot.<your-subdomain>.workers.dev`.

### 7. Verify

1. Open `https://<your-worker-url>/api/health`. It should return `{"ok":true,"service":"PingPilot"}`.
2. Open the root URL and log in with the admin account from step 5.
3. Add a public HTTPS endpoint you own and click **Ping now**.
4. Check that the scheduled run appears in **History** after its interval.

To watch live logs from production:

```bash
npx wrangler tail
```

### Updating a deployed instance

```bash
npm run db:remote
npm run build
npm run worker:deploy
```

`db:remote` is a no-op when there are no new migrations.

### Custom domain (optional)

In the Cloudflare dashboard go to **Workers & Pages → pingpilot → Settings → Domains & Routes → Add → Custom domain** and enter a hostname on a zone in your account. HTTPS is set up automatically. To stop serving on `workers.dev`, set `workers_dev = false` in `wrangler.toml` and redeploy.

## Configuration

Non-secret settings live in `[vars]` in `wrangler.toml`. Change them and redeploy.

| Variable | Default | Meaning |
| --- | --- | --- |
| `APP_NAME` | `PingPilot` | Display name |
| `SESSION_TTL_SECONDS` | `604800` (7 days) | Login session length, clamped to 1 hour–30 days |
| `MAX_TARGETS` | `100` | Max monitored URLs, clamped to 1–500 |
| `MAX_PINGS_PER_TICK` | `20` | Max checks per cron minute, clamped to 1–100 |

## Administrator management

The Worker has no public registration or password reset. Manage the admin directly in D1.

Change a password: re-run the script with the same username. It replaces the hash and signs out that admin's sessions.

```bash
npm run admin:create:pbkdf2
```

Remove an admin:

```bash
npx wrangler d1 execute pingpilot-db --remote --command "DELETE FROM admins WHERE username='<username>';"
```

Sign out every session:

```bash
npx wrangler d1 execute pingpilot-db --remote --command "DELETE FROM sessions;"
```

Never commit credentials or password hashes.

## Local development

Build the UI, create a local admin, and run the Worker locally:

```bash
npm run db:local
npm run admin:create:pbkdf2
npm run build
npm run worker:dev
```

Choose `local` at the database prompt. Then open the URL Wrangler prints (usually `http://localhost:8787`). Use `localhost`, not a LAN IP, because the session cookie is marked `Secure`.

For frontend-only styling work, `npm run dev` starts Vite at `http://localhost:5173`. API calls will not work there unless you add a dev proxy to `vite.config.ts`.

## Troubleshooting

- **`Authentication error [code: 10000]` on deploy**: run `npx wrangler login` again.
- **`no such table: admins`**: the migration has not been applied to that database. Run `npm run db:remote` (or `db:local`).
- **`Couldn't find a D1 DB with the name or binding`**: the `database_id` in `wrangler.toml` belongs to another account or does not exist. Repeat step 3.
- **Login works locally over a LAN IP but not on the phone**: expected. Use the deployed HTTPS URL.

## Operational details

- Cron runs once a minute and processes at most `MAX_PINGS_PER_TICK` due targets, ordered by `next_run_at`. Extra due targets wait for the next tick.
- A "1 minute" interval means eligible once per minute, not exact-to-the-second timing. Cloudflare Cron is not a precision scheduler.
- `fetch` uses `redirect: "manual"` and records 2xx–3xx responses as available. Redirect chains are not followed.
- Only public-looking HTTP(S) URLs are accepted. Workers `fetch` does not expose DNS resolution or IP pinning, so this validation is defense-in-depth rather than a complete SSRF guarantee. Only monitor endpoints you own or are authorized to monitor.
- This is not a high-frequency or high-volume monitoring service. Adjust quotas conservatively.
- Manual checks update `next_run_at` as well as the latest status. Old logs and expired sessions are cleaned during scheduled runs.
- The UI loads a Google Fonts stylesheet. Remove the import from `src/ui/styles.css` to avoid that external request.

## License

Private project scaffold.
