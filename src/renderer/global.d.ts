import type { DiscoveredGame, InstallOptions, InstallProgress, InstallResult } from '@shared/types';

declare global {
  interface Window {
    optiScaler: {
      scanGames: () => Promise<DiscoveredGame[]>;
      installToGame: (gameId: string, options: InstallOptions) => Promise<InstallResult>;
      restoreGame: (gameId: string) => Promise<InstallResult>;
      installToAll: (options: InstallOptions) => Promise<InstallResult[]>;
      onProgress: (handler: (progress: InstallProgress) => void) => () => void;
    };
  }
}

export {};
