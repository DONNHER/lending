# Agrivit Store Laravel API

The Laravel API serves `/api/v1`. It supports PostgreSQL (PDO PgSQL) and SQLite (PDO SQLite) for local development. It requires PHP 8.3 or newer and Composer.

## Online database and offline register

Set `DB_CONNECTION=pgsql` to serve the store from PostgreSQL after the `argivit` schema is ready. Set the `DB_PGSQL_*` values from `.env.example`, or supply `DATABASE_URL` and `DATABASE_URL_UNPOOLED`. Keep the connection credentials in the backend environment. The PostgreSQL session uses the `argivit` schema for store tables.

The [Windows cashier](../frontend/desktop/README.md) saves offline cash sales to its own SQLite database. It sends the pending sales to Laravel in batches when it reconnects. Loan views and writes require the online Laravel API. Switching databases leaves the local development database available with `DB_CONNECTION=sqlite`.

## Run local PostgreSQL in Docker

Set `DB_CONNECTION=pgsql_docker` and `DOCKER_PG_PASSWORD` in this folder's `.env`. Use a unique password and `APP_ENV=local`. Start Docker Desktop, then run from `backend/`:

```powershell
docker compose up -d --wait
php artisan migrate --seed
php artisan serve --host=127.0.0.1
```

Docker publishes PostgreSQL on `127.0.0.1:55432` by default and keeps its data in a named volume. Set `DOCKER_PG_PORT` if that port is occupied. The seed loads store reference settings into the new database. Create accounts through **Register Shareholder**, then use `php artisan argivit:grant-role <email> <admin|manager|cashier>` to assign staff roles. Sign in again after the role changes.

To try the seeded roles on an empty local database, run `php artisan db:seed --class=DemoAccountsSeeder`. It creates demo accounts and starter shareholder profiles. Then run `php artisan db:seed --class=DemoCatalogSeeder` to add demo products, including **Animal Vitamins & Vet Supplies**, with barcodes, selling units, and opening stock. You can rerun the catalog seed to add missing demo products. Prices, opening quantities, and animal care barcodes are sample values for local testing.

## Open the local SQLite store

Keep the existing database at `database/argivit.sqlite` or set `DB_DATABASE` to its absolute path. This preserves its user, inventory, sales, and loan records. From this folder:

```powershell
composer install
Copy-Item .env.example .env  # Only if .env does not already exist
php artisan key:generate   # Only if APP_KEY is empty
php artisan migrate
php artisan serve --host=127.0.0.1
```

Run the [React frontend](../frontend/README.md) separately. The server defaults to port 8000. Before deploying to another computer, copy the SQLite database as a consistent backup and configure its database path there. The first sign-in for an account with a legacy password hash can take several seconds while Laravel upgrades the hash.

## Start with a new local database

Create an empty `database/argivit.sqlite` and run `php artisan migrate --seed` for reference data. To populate a separate, empty local database with the existing demo accounts and sample transactions, run `php artisan migrate --seed --seeder=DemoSeeder` instead. The demo seeder is restricted to local and test environments.

To use an existing external identity provider, set `AUTH_JWKS_URL`, `AUTH_JWT_ISSUER`, and `AUTH_JWT_AUDIENCE`.

## Laravel email verification codes

Run `php artisan migrate` before enabling `ARGIVIT_EMAIL_MFA=true`. Laravel emails a six-digit code after password sign-in or new shareholder registration. The code expires after five minutes and allows up to five attempts. Test with a local SMTP inbox using synthetic addresses. For a loopback SMTP inbox, set `MAIL_SCHEME=smtp`, `MAIL_HOST=127.0.0.1`, `MAIL_PORT=1025`, and `MAIL_REQUIRE_TLS=false` while testing.

On the Linux host, use [Cloudflare Tunnel](https://developers.cloudflare.com/tunnel/concepts/routing/) to publish the HTTPS web app and route `/api/v1` to Laravel on the same origin. Configure outbound email separately through [Cloudflare Email Service SMTP](https://developers.cloudflare.com/email-service/api/send-emails/smtp/). Set `MAIL_SCHEME=smtps`, `MAIL_HOST=smtp.mx.cloudflare.net`, `MAIL_PORT=465`, and `MAIL_USERNAME=api_token`. Store the Email Sending API token in `MAIL_PASSWORD` on the server and set `MAIL_FROM_ADDRESS` to an allowed sender on the onboarded domain. Use a reachable email address for each account that needs to sign in, including the administrator.

## Shareholder shop assistance

To use Gemini, set `GEMINI_API_KEY` in Laravel's `.env`. The default model is `gemini-3.5-flash-lite`. Use `GEMINI_MODEL` to select another model that supports structured output. Keep the key on the server. Google may use free-tier prompts and catalog excerpts to improve its products. [Gemini API terms](https://aistudio.google.com/docs/terms)

To use Ollama, leave `GEMINI_API_KEY` unset. Install [Ollama on the Linux server](https://docs.ollama.com/linux) and run `ollama pull qwen2.5:1.5b`. When Ollama runs in a VM, set its `OLLAMA_HOST` service variable to the private VM address and port `11434`. Limit access to the Laravel host. In Laravel's `.env`, set `OLLAMA_BASE_URL=http://<private-vm-ip>:11434` and `OLLAMA_MODEL=qwen2.5:1.5b`.

Reload the Laravel configuration and restart any long-running API workers after changing providers. The API reads sellable stock for each question, sends relevant catalog entries to the provider, and checks availability again before returning recommendations. Inventory updates require no model training. Keyword search stays available when the provider cannot answer.

## Verify the API

From this folder, run `node --test tests/*.test.ts` with Node.js 24. The suites use temporary SQLite databases and loopback servers. The MFA suite captures mail in a local SMTP fixture.

## API request limits and HTTPS

Laravel counts requests to registered API routes across all route tiers. Each IP gets 100 requests per minute, with a 40-request limit for sign-in, registration, identity synchronization, and email code verification. A rejected request returns HTTP 429 with `Retry-After`.

Serve the production app over HTTPS. Laravel sends HSTS when it sees a secure production request. When Cloudflare Tunnel or another proxy terminates TLS, serve HSTS at the TLS edge and configure Laravel to trust only the immediate proxy’s address or network for forwarded IP and scheme information. The proxy must sanitize forwarded headers. Without a trusted proxy configuration, Laravel uses the direct peer’s IP for rate limiting.

## Bulfa Agrivet catalog and audit maintenance

To seed the Bulfa Agrivet price list into the selected Laravel database, run `php artisan db:seed --class=BulfaAgrivetCatalogSeeder`. This adds the products, package prices, and internal barcodes. It starts with zero stock and preserves existing catalog entries on another run.

On the Linux host, run `php artisan schedule:run` every minute from the backend directory. The audit task marks records older than 90 days as archived at 4:00 AM Manila time. Archived records remain searchable in the audit viewer. Run `php artisan argivit:archive-audit` to apply the same maintenance manually.

## Scheduled private backups

The Laravel scheduler runs the database backup Sunday at 2:00 AM, the member document backup Sunday at 3:00 AM, and the combined ZIP on the first of each month at 1:00 AM. Times use Asia/Manila. The scheduled job at 5:00 AM expires scheduled files after 30 days. The administrative manual backup stays available.

Backups are written to private application storage by default. Set `ARGIVIT_BACKUP_DIRECTORY` to a private directory on a mounted backup drive if available. PostgreSQL backups need `pg_dump` and `pg_restore` on the Laravel host. Set `ARGIVIT_PG_DUMP` and `ARGIVIT_PG_RESTORE` if they are outside PATH. ZIP archives require PHP’s zip extension. The commands `php artisan argivit:backup database`, `php artisan argivit:backup uploads`, and `php artisan argivit:backup full` run each backup on demand. Run `php artisan schedule:list` to verify the registered schedule.

## Password recovery and devices

Set `ARGIVIT_WEB_URL` to the public HTTPS URL of the React app and configure SMTP. Development defaults to `http://localhost:5173`. The recovery email contains a one-time link that expires after 30 minutes. Completing the reset signs out the account’s existing Argivit sessions. An admin can send the same link or sign out all devices through Settings → Users → Security. Profile shows sign-in history and lets users sign out individual devices.

Browser sign-in defaults to the current tab. Remember Me saves the sign-in across browser restarts. Non-cashier Argivit sessions expire after 30 minutes of inactivity and show a five-minute warning. Absolute limits are 12 hours for tab-only sign-in and seven days with Remember Me. The Windows cashier keeps its existing persistent offline sign-in and its queued cash sales. Revocation is enforced when the cashier reconnects. External identity providers manage their own password recovery and provider sessions.

## In-app notifications

The notification bell shows membership and loan review updates, critical sign-in and backup alerts, and scheduled stock and loan reminders. Each account can mark all notices read, remove notices, and choose which categories to receive. The daily 08:00 Asia/Manila task also checks whether the Laravel storage volume is at least 85% full.

The app polls on single-worker development hosts. On a multi-worker Laravel host, set ARGIVIT_NOTIFICATION_STREAM=true to use the authenticated server-sent event stream. The proxy must flush streaming responses. The inbox continues polling if the stream is interrupted.
