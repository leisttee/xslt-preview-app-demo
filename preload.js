const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  saveTextFile: (suggestedName, content) =>
    ipcRenderer.invoke("save-text-file", { suggestedName, content }),

  pickBaseDirectory: () =>
    ipcRenderer.invoke("pick-base-directory"),

  readTextFileRel: (baseDir, href) =>
    ipcRenderer.invoke("read-text-file-rel", { baseDir, href })
});

