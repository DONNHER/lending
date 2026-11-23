# Lending & Cooperative Store Ledger (Argivit Store)

Cooperative Retail, Inventory, POS, and Member Loan Ledger for Argivit Agricultural Supply Cooperative.

## Project Structure

- **[`backend/`](backend/)**: Laravel API (PHP 8.3+) supporting PostgreSQL and SQLite for store inventory, member verification, capital accounts, and credit limits.
- **[`frontend/`](frontend/)**: React 19 + TypeScript + Vite frontend with offline-resilient POS terminal, inventory management, reports, and member portal.

## Quick Start

### 1. Backend

```powershell
cd backend
php artisan serve --host=127.0.0.1 --port=8000
```

### 2. Frontend

```powershell
cd frontend
npm install
npm run dev
```

### Seeded Demo Accounts (Password: `Argivit2026!`)

- **Admin**: `admin@argivitstore.com`
- **Manager**: `manager@argivitstore.com`
- **Cashier**: `cashier@argivitstore.com`
- **Shareholder**: `mateo@argivitstore.com`
