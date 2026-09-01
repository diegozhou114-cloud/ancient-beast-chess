const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ancientBeastDesktop", {
  lan: {
    supported: true,
    getNetworks: () => ipcRenderer.invoke("lan:get-networks"),
    startHost: () => ipcRenderer.invoke("lan:start-host"),
    stopHost: () => ipcRenderer.invoke("lan:stop-host"),
    setAdvertisedRoom: (room) => ipcRenderer.invoke("lan:set-advertised-room", room),
    startDiscovery: () => ipcRenderer.invoke("lan:start-discovery"),
    stopDiscovery: () => ipcRenderer.invoke("lan:stop-discovery"),
    onRoomsChanged: (listener) => {
      const handler = (_event, rooms) => listener(rooms);
      ipcRenderer.on("lan:rooms-changed", handler);
      return () => ipcRenderer.removeListener("lan:rooms-changed", handler);
    },
  },
});
