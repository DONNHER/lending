const { app, BrowserWindow, Menu, dialog, ipcMain } = require('electron');
const { join } = require('node:path');
const { openCashierDatabase } = require('./cashier-db.cjs');
const { ORIGIN, normalizeApiOrigin, verifyApiOrigin, openLoopback } = require('./loopback.cjs');

async function launch() {
  if (process.platform !== 'win32') throw new Error('The standalone register targets Windows.');
  const database = openCashierDatabase(join(app.getPath('userData'), 'cashier.sqlite'));
  if (!database.getApiOrigin() && process.env.ARGIVIT_API_URL) {
    database.setApiOrigin(normalizeApiOrigin(process.env.ARGIVIT_API_URL));
  }
  let mainWindow;
  const server = await openLoopback({
    dist: join(__dirname, '..', 'dist'), desktopPath: __dirname, getApiOrigin: database.getApiOrigin,
  });
  app.on('before-quit', () => { server.close(); database.close(); });

  function handle(channel, action) {
    ipcMain.handle(`cashier:${channel}`, (event, ...args) => {
      const sender = event.senderFrame;
      if (event.sender !== mainWindow?.webContents || sender !== event.sender.mainFrame ||
          new URL(sender.url).origin !== ORIGIN) {
        throw new Error('The register denied this request.');
      }
      return action(...args);
    });
  }
  handle('snapshot', database.snapshot);
  handle('save-catalog', database.saveCatalog);
  handle('queue-sale', database.queueSale);
  handle('acknowledge-sales', database.acknowledgeSales);
  handle('server-origin', database.getApiOrigin);
  handle('set-server-origin', async (value) => {
    const origin = await verifyApiOrigin(value);
    return database.setApiOrigin(origin);
  });

  mainWindow = new BrowserWindow({
    title: 'Agrivit Cashier', width: 1360, height: 900, minWidth: 900, minHeight: 640,
    show: false,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false,
    },
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin !== ORIGIN) event.preventDefault();
  });
  mainWindow.webContents.setWindowOpenHandler(({ url, disposition }) => {
    if (url === 'about:blank' && (disposition === 'new-window' || disposition === 'foreground-tab')) {
      return { action: 'allow', overrideBrowserWindowOptions: {
        webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, preload: undefined },
      } };
    }
    return { action: 'deny' };
  });
  mainWindow.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));

  Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: 'Register', submenu: [
    { label: 'Server connection…', click: () => { void mainWindow.loadURL(`${ORIGIN}/setup.html`); } },
    { role: 'reload' }, { type: 'separator' }, { role: 'quit' },
  ] }]));
  app.on('second-instance', () => {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  return mainWindow.loadURL(database.getApiOrigin() ? ORIGIN : `${ORIGIN}/setup.html`);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('window-all-closed', () => app.quit());
  app.whenReady().then(launch).catch((error) => {
    dialog.showErrorBox('Agrivit Cashier could not start', error.message);
    app.quit();
  });
}
