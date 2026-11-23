const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('argivitDesktop', {
  snapshot: () => ipcRenderer.invoke('cashier:snapshot'),
  saveCatalog: (products) => ipcRenderer.invoke('cashier:save-catalog', products),
  queueSale: (event) => ipcRenderer.invoke('cashier:queue-sale', event),
  acknowledgeSales: (ids) => ipcRenderer.invoke('cashier:acknowledge-sales', ids),
  serverOrigin: () => ipcRenderer.invoke('cashier:server-origin'),
  setServerOrigin: (origin) => ipcRenderer.invoke('cashier:set-server-origin', origin),
});
