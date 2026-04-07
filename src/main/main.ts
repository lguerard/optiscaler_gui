import { app, BrowserWindow, ipcMain, nativeImage } from "electron";
import path from "node:path";
import fs from "node:fs";
import { discoverGames } from "./gameDiscovery";
import {
  installOptiScalerIntoGame,
  restoreOptiScalerFromGame,
} from "./installer";
import type { InstallOptions, InstallProgress } from "../shared/types";

let mainWindow: BrowserWindow | null = null;
let latestDiscoveredGames: Awaited<ReturnType<typeof discoverGames>> = [];

function getWindowIcon() {
  const iconPath = path.join(app.getAppPath(), "build", "icon.ico");
  if (!fs.existsSync(iconPath)) {
    return undefined;
  }

  const image = nativeImage.createFromPath(iconPath);
  return image.isEmpty() ? undefined : image;
}

function sendProgress(progress: InstallProgress): void {
  mainWindow?.webContents.send("opti:progress", progress);
}

function createWindow(): BrowserWindow {
  const icon = getWindowIcon();
  const window = new BrowserWindow({
    width: 1500,
    height: 920,
    minWidth: 1180,
    minHeight: 760,
    backgroundColor: "#081018",
    title: "OptiScaler GUI",
    icon,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  if (icon) {
    window.setIcon(icon);
  }

  if (!app.isPackaged) {
    window.loadURL("http://localhost:5173");
  } else {
    window.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  return window;
}

app.whenReady().then(() => {
  app.setAppUserModelId("com.optiscaler.gui");
  mainWindow = createWindow();

  ipcMain.handle("opti:scan-games", async () => {
    latestDiscoveredGames = await discoverGames();
    return latestDiscoveredGames;
  });

  ipcMain.handle(
    "opti:install-game",
    async (_event, gameId: string, options: InstallOptions) => {
      const games =
        latestDiscoveredGames.length > 0
          ? latestDiscoveredGames
          : await discoverGames();
      const game = games.find((entry) => entry.id === gameId);
      if (!game) {
        throw new Error(
          "Selected game was not found during the most recent scan.",
        );
      }

      return installOptiScalerIntoGame(game.installPath, options, {
        report: sendProgress,
      });
    },
  );

  ipcMain.handle("opti:restore-game", async (_event, gameId: string) => {
    const games =
      latestDiscoveredGames.length > 0
        ? latestDiscoveredGames
        : await discoverGames();
    const game = games.find((entry) => entry.id === gameId);
    if (!game) {
      throw new Error(
        "Selected game was not found during the most recent scan.",
      );
    }

    return restoreOptiScalerFromGame(game.installPath);
  });

  ipcMain.handle(
    "opti:install-all",
    async (_event, options: InstallOptions) => {
      const games =
        latestDiscoveredGames.length > 0
          ? latestDiscoveredGames
          : await discoverGames();
      const results = [] as Awaited<
        ReturnType<typeof installOptiScalerIntoGame>
      >[];

      for (const game of games) {
        const result = await installOptiScalerIntoGame(
          game.installPath,
          options,
          {
            report: sendProgress,
          },
        );
        results.push(result);
      }

      return results;
    },
  );

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
