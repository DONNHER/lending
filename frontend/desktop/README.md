# Agrivit Cashier for Windows

The installer includes Electron, the React app, and native SQLite. The cashier computer needs a reachable Laravel URL for first sign-in and product download. After setup, the desktop app can reopen offline and queue cash sales in `cashier.sqlite` under its Windows application data directory. Keep using the same Windows profile and cashier account until the app confirms that its sales have synced.

## Install and connect

1. Run `Agrivit-Cashier-Setup-*.exe` and open **Agrivit Cashier**.
2. On **Server connection**, enter the public HTTPS origin of Laravel, such as `https://pos.example.com`. For testing Laravel on the same computer, `http://localhost:8000` also works.
3. Sign in online with the assigned cashier account and wait for the product catalog to load. Pending cash sales sync automatically in batches when the same server is reachable again.

Use **Register → Server connection** to update the server address. The app keeps the existing address while offline sales are pending.

## Build and test

From `frontend/` on Windows with Node.js installed:

```powershell
npm.cmd ci
npm.cmd run test:desktop
npm.cmd run desktop:build
```

The build writes the installer to `frontend/release/`. To run the desktop app from source after building React, run `npm.cmd run desktop`. A keyboard-mode barcode scanner and a Windows printer driver work through the app’s existing scan field and print dialog. Direct USB or serial pairing needs a separate Electron device chooser.
