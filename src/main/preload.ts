import { contextBridge, ipcRenderer } from "electron";
import type {
  DiscoveredGame,
  InstallOptions,
  InstallProgress,
  InstallResult,
} from "../shared/types";

const progressHandlers = new Set<(progress: InstallProgress) => void>();

ipcRenderer.on("opti:progress", (_event, progress: InstallProgress) => {
  for (const handler of progressHandlers) {
    handler(progress);
  }
});

contextBridge.exposeInMainWorld("optiScaler", {
  scanGames: () =>
    ipcRenderer.invoke("opti:scan-games") as Promise<DiscoveredGame[]>,
  installToGame: (gameId: string, options: InstallOptions) =>
    ipcRenderer.invoke(
      "opti:install-game",
      gameId,
      options,
    ) as Promise<InstallResult>,
  restoreGame: (gameId: string) =>
    ipcRenderer.invoke("opti:restore-game", gameId) as Promise<InstallResult>,
  installToAll: (options: InstallOptions) =>
    ipcRenderer.invoke("opti:install-all", options) as Promise<InstallResult[]>,
  onProgress: (handler: (progress: InstallProgress) => void) => {
    progressHandlers.add(handler);
    return () => progressHandlers.delete(handler);
  },
});
