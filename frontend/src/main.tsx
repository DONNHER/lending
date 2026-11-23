import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { getDesktopPosBridge, initializeDesktopPos } from './lib/posOffline.ts';
import { useAppStore } from './stores/app-store.ts';
import './index.css';

const root = createRoot(document.getElementById('root')!);
const desktop = getDesktopPosBridge();

if (desktop) {
  void initializeDesktopPos(desktop).then((offlineOutbox) => {
    useAppStore.setState({ offlineOutbox });
    root.render(<App />);
  }).catch(() => {
    root.render(<main className="mx-auto max-w-lg p-8" role="alert">
      <h1 className="text-xl font-semibold">Could not open the register’s local database</h1>
      <p className="mt-2">Close and reopen Agrivit Cashier. Contact the manager if the problem continues.</p>
    </main>);
  });
} else {
  root.render(<App />);
}

if (!desktop && import.meta.env.PROD && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.register('/pos-offline.js').catch((error) => {
    console.warn('Offline POS app shell could not be installed.', error);
  });
}
