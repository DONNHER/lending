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

## Verify the API

From this folder, run `node --test tests/api-contract.test.ts` with Node.js 24. The suite starts Laravel on loopback and uses a fresh temporary database.
