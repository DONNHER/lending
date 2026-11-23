# Agrivit Store React frontend

Use Node.js 24 and start the [Laravel API](../backend/README.md) first. From this folder, run:

```powershell
npm.cmd ci
npm.cmd run dev
```

Vite forwards `/api/v1` to `http://127.0.0.1:8000`. Copy `.env.example` to `.env.local` and set `API_PROXY_TARGET` to change the backend address for local development or preview.

## Offline register

```powershell
npm.cmd run build
npm.cmd run preview
```

Use the built app over HTTPS or on `localhost` or `127.0.0.1`. Sign in as the cashier and open the register while online so the browser can save the application and catalog. Continue with cash sales on the same computer and browser during an outage. Saved sales sync while the app is open after Laravel is reachable. Managers can review stock conflicts in **Settings → Offline Sync & Conflicts**.

In **Products & Inventory → New Product**, click the barcode field before scanning a supplier label with a keyboard-mode scanner. For unlabeled products, generate a barcode and print the label after saving. A barcode identifies one product and adds its default selling unit at checkout.

For deployment, serve `dist/` and forward `/api/v1/*` to Laravel on the same origin. Serve `/pos-offline.js` from the root with the rest of the build.

Run `npm.cmd run lint` and `npm.cmd test` to verify the frontend.
