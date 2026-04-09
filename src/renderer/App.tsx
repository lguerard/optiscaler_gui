import { useEffect, useMemo, useState } from "react";
import type {
  DiscoveredGame,
  InstallProgress,
  InstallResult,
  ProxyFilename,
} from "@shared/types";

const appIconUrl = new URL("../../build/icon.png", import.meta.url).href;

const PROXY_CHOICES: ProxyFilename[] = [
  "dxgi.dll",
  "winmm.dll",
  "version.dll",
  "dbghelp.dll",
  "d3d12.dll",
  "wininet.dll",
  "winhttp.dll",
  "OptiScaler.asi",
];

const PROXY_GUIDE: Record<ProxyFilename, string> = {
  "dxgi.dll": "Best default for most modern DirectX 12 and DLSS-style setups.",
  "winmm.dll": "Useful when the game or loader prefers an audio hook path.",
  "version.dll":
    "Common fallback for launchers and Microsoft Store style builds.",
  "dbghelp.dll":
    "Handy for editor or benchmark executables that need a softer hook.",
  "d3d12.dll":
    "Targets DirectX 12 first and is useful when the game loads D3D12 directly.",
  "wininet.dll":
    "Use for older launchers or network-heavy wrappers that expect WinINet.",
  "winhttp.dll": "Fallback for Windows HTTP based launchers and helpers.",
  "OptiScaler.asi":
    "ASI loader option for special cases that do not suit DLL proxying.",
};

const GPU_GUIDE: Record<"amd-intel" | "nvidia", string> = {
  "amd-intel":
    "Keep spoofing available so games that expect other upscalers still start cleanly.",
  nvidia:
    "Spoofing is disabled because Nvidia installs rarely need it for the recommended flow.",
};

type ThemeMode = "dark" | "light";
type LibraryViewMode = "grid" | "list";

const THEME_STORAGE_KEY = "optiscaler-theme";
const LIBRARY_VIEW_STORAGE_KEY = "optiscaler-library-view";
const GAME_CACHE_ENABLED_STORAGE_KEY = "optiscaler-game-cache-enabled";
const GAME_CACHE_STORAGE_KEY = "optiscaler-game-cache";
const SELECTED_GAME_STORAGE_KEY = "optiscaler-selected-game";
const PRESERVE_ORIGINAL_STATE_STORAGE_KEY =
  "optiscaler-preserve-original-state";

function formatConfidence(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}

function getGameBadge(game: DiscoveredGame): string {
  const word = game.title.split(/\s+/).find(Boolean) ?? game.source;
  return word.slice(0, 2).toUpperCase();
}

function getProxyGuide(proxyFilename: ProxyFilename): string {
  return PROXY_GUIDE[proxyFilename];
}

function formatCompatibilityList(values?: string[]): string {
  if (!values || values.length === 0) return "Not listed";
  return values.join(", ");
}

function formatCompatibilityInputs(
  primary?: string[],
  fallback?: string[],
): string {
  if (primary && primary.length > 0) {
    return primary.join(", ");
  }

  if (fallback && fallback.length > 0) {
    return `${fallback.join(", ")} (detected locally)`;
  }

  return "Not listed";
}

function formatDetectionEvidence(values?: string[]): string {
  if (!values || values.length === 0) return "No local signatures found";
  return values.join(" | ");
}

function formatActiveSetting(value?: string): string {
  return value ?? "Not found";
}

function formatConfigFiles(values?: string[]): string {
  if (!values || values.length === 0) return "No matching config file";
  return values.join(", ");
}

function getTechnologyBadgeLabel(value?: string): string | null {
  if (!value) return null;

  switch (value) {
    case "DLSS Super Resolution":
      return "DLSS";
    case "FSR 2":
      return "FSR2";
    case "FSR 3 Upscaling":
      return "FSR3";
    case "FSR 4":
      return "FSR4";
    case "XeSS":
      return "XeSS";
    case "TSR":
      return "TSR";
    case "DLSS Frame Generation":
      return "DLSS FG";
    case "FSR 3 Frame Generation":
      return "FSR3 FG";
    case "XeSS Frame Generation":
      return "XeSS FG";
    case "Off / Native":
      return "Native";
    case "Off":
      return "FG Off";
    default:
      return value;
  }
}

function getGameTechnologyBadges(game: DiscoveredGame): string[] {
  const badges = new Set<string>();
  const upscalerBadge =
    getTechnologyBadgeLabel(game.activeGraphics?.upscaler) ??
    getTechnologyBadgeLabel(game.detectedGraphics?.upscalers[0]);
  const frameGenerationBadge =
    getTechnologyBadgeLabel(game.activeGraphics?.frameGeneration) ??
    getTechnologyBadgeLabel(game.detectedGraphics?.frameGeneration[0]);

  if (upscalerBadge) {
    badges.add(upscalerBadge);
  }

  if (frameGenerationBadge) {
    badges.add(frameGenerationBadge);
  }

  return Array.from(badges).slice(0, 3);
}

function getInitialTheme(): ThemeMode {
  const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (savedTheme === "dark" || savedTheme === "light") {
    return savedTheme;
  }

  return window.matchMedia("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
}

function getInitialLibraryView(): LibraryViewMode {
  const savedView = window.localStorage.getItem(LIBRARY_VIEW_STORAGE_KEY);
  return savedView === "list" ? "list" : "grid";
}

function getInitialBoolean(storageKey: string, fallback: boolean): boolean {
  const savedValue = window.localStorage.getItem(storageKey);
  if (savedValue === null) {
    return fallback;
  }

  return savedValue === "true";
}

function getInitialCachedGames(): DiscoveredGame[] {
  if (!getInitialBoolean(GAME_CACHE_ENABLED_STORAGE_KEY, true)) {
    return [];
  }

  const raw = window.localStorage.getItem(GAME_CACHE_STORAGE_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as DiscoveredGame[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function getInitialSelectedGameId(): string | null {
  if (!getInitialBoolean(GAME_CACHE_ENABLED_STORAGE_KEY, true)) {
    return null;
  }

  return window.localStorage.getItem(SELECTED_GAME_STORAGE_KEY);
}

function ThemeToggleIcon({ theme }: { theme: ThemeMode }) {
  if (theme === "dark") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M12 4.25a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0V5a.75.75 0 0 1 .75-.75Zm0 12.5a.75.75 0 0 1 .75.75V19a.75.75 0 0 1-1.5 0v-1.5a.75.75 0 0 1 .75-.75Zm7.75-5.5a.75.75 0 0 1 0 1.5h-1.5a.75.75 0 0 1 0-1.5h1.5Zm-14 0a.75.75 0 0 1 0 1.5h-1.5a.75.75 0 0 1 0-1.5h1.5Zm11.127-4.377a.75.75 0 0 1 1.06 1.06l-1.06 1.061a.75.75 0 0 1-1.06-1.06l1.06-1.061Zm-9.754 9.753a.75.75 0 0 1 1.06 1.061l-1.06 1.06a.75.75 0 1 1-1.06-1.06l1.06-1.061Zm10.814 1.06a.75.75 0 1 1-1.06 1.061l-1.06-1.06a.75.75 0 1 1 1.06-1.061l1.06 1.06Zm-9.754-9.753a.75.75 0 0 1-1.06 1.06L6.063 7.934a.75.75 0 0 1 1.06-1.06l1.06 1.06ZM12 8.25A3.75 3.75 0 1 1 8.25 12 3.75 3.75 0 0 1 12 8.25Z"
          fill="currentColor"
        />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M14.77 4.575a.75.75 0 0 1 .743 1.026 7 7 0 1 0 8.913 8.913.75.75 0 0 1 1.025.743 8.5 8.5 0 1 1-10.68-10.68Z"
        fill="currentColor"
        transform="translate(-1.5 -1.5)"
      />
    </svg>
  );
}

export default function App() {
  const [theme, setTheme] = useState<ThemeMode>(() => getInitialTheme());
  const [libraryView, setLibraryView] = useState<LibraryViewMode>(() =>
    getInitialLibraryView(),
  );
  const [useDiscoveryCache, setUseDiscoveryCache] = useState<boolean>(() =>
    getInitialBoolean(GAME_CACHE_ENABLED_STORAGE_KEY, true),
  );
  const [games, setGames] = useState<DiscoveredGame[]>(() =>
    getInitialCachedGames(),
  );
  const [selectedGameId, setSelectedGameId] = useState<string | null>(() =>
    getInitialSelectedGameId(),
  );
  const [showAdvancedOptions, setShowAdvancedOptions] = useState(false);
  const [proxyFilename, setProxyFilename] = useState<ProxyFilename>("dxgi.dll");
  const [gpuVendor, setGpuVendor] = useState<"amd-intel" | "nvidia">(
    "amd-intel",
  );
  const [enableSpoofing, setEnableSpoofing] = useState(true);
  const [installOptiPatcher, setInstallOptiPatcher] = useState(false);
  const [preserveOriginalState, setPreserveOriginalState] = useState<boolean>(
    () => getInitialBoolean(PRESERVE_ORIGINAL_STATE_STORAGE_KEY, true),
  );
  const [progress, setProgress] = useState<InstallProgress | null>(null);
  const [logEntries, setLogEntries] = useState<string[]>(() =>
    getInitialCachedGames().length > 0
      ? [
          `Loaded ${getInitialCachedGames().length} cached games while the library refresh runs.`,
        ]
      : [],
  );
  const [busy, setBusy] = useState(false);

  const selectedGame = useMemo(
    () => games.find((game) => game.id === selectedGameId) ?? null,
    [games, selectedGameId],
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    window.localStorage.setItem(LIBRARY_VIEW_STORAGE_KEY, libraryView);
  }, [libraryView]);

  useEffect(() => {
    window.localStorage.setItem(
      GAME_CACHE_ENABLED_STORAGE_KEY,
      String(useDiscoveryCache),
    );

    if (!useDiscoveryCache) {
      window.localStorage.removeItem(GAME_CACHE_STORAGE_KEY);
      window.localStorage.removeItem(SELECTED_GAME_STORAGE_KEY);
      return;
    }

    window.localStorage.setItem(GAME_CACHE_STORAGE_KEY, JSON.stringify(games));
    if (selectedGameId) {
      window.localStorage.setItem(SELECTED_GAME_STORAGE_KEY, selectedGameId);
    } else {
      window.localStorage.removeItem(SELECTED_GAME_STORAGE_KEY);
    }
  }, [games, selectedGameId, useDiscoveryCache]);

  useEffect(() => {
    window.localStorage.setItem(
      PRESERVE_ORIGINAL_STATE_STORAGE_KEY,
      String(preserveOriginalState),
    );
  }, [preserveOriginalState]);

  useEffect(() => {
    const unsubscribe = window.optiScaler.onProgress((entry) => {
      setProgress(entry);
      setLogEntries((current) =>
        [`${entry.phase.toUpperCase()}: ${entry.message}`, ...current].slice(
          0,
          12,
        ),
      );
    });

    void refreshGames();
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (selectedGame) {
      setProxyFilename(selectedGame.recommendation);
      setShowAdvancedOptions(false);
      if (selectedGame.compatibility?.suggestedSpoofing !== undefined) {
        setEnableSpoofing(selectedGame.compatibility.suggestedSpoofing);
      }
      if (selectedGame.compatibility?.suggestedOptiPatcher !== undefined) {
        setInstallOptiPatcher(selectedGame.compatibility.suggestedOptiPatcher);
      }
    }
  }, [selectedGame]);

  useEffect(() => {
    if (gpuVendor === "nvidia") {
      setEnableSpoofing(false);
    }
  }, [gpuVendor]);

  useEffect(() => {
    if (selectedGameId && games.some((game) => game.id === selectedGameId)) {
      return;
    }

    setSelectedGameId(games[0]?.id ?? null);
  }, [games, selectedGameId]);

  async function refreshGames() {
    setBusy(true);
    try {
      const discovered = await window.optiScaler.scanGames();
      setGames(discovered);
      setSelectedGameId((current) => {
        if (current && discovered.some((game) => game.id === current)) {
          return current;
        }

        return discovered[0]?.id ?? null;
      });
      setLogEntries((current) =>
        [
          `Scan complete: found ${discovered.length} installed games.`,
          ...current,
        ].slice(0, 12),
      );
    } finally {
      setBusy(false);
    }
  }

  async function installSelected() {
    if (!selectedGame) return;
    setBusy(true);
    try {
      const result = await window.optiScaler.installToGame(selectedGame.id, {
        proxyFilename,
        enableSpoofing,
        installOptiPatcher,
        preserveOriginalState,
      });
      setLogEntries((current) =>
        [
          `Installed ${result.gameTitle} to ${result.installedTo}.`,
          ...current,
        ].slice(0, 12),
      );
    } catch (error) {
      setLogEntries((current) =>
        [`Install failed: ${(error as Error).message}`, ...current].slice(
          0,
          12,
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  async function installAll() {
    setBusy(true);
    try {
      const results = await window.optiScaler.installToAll({
        proxyFilename,
        enableSpoofing,
        installOptiPatcher,
        preserveOriginalState,
      });
      setLogEntries((current) =>
        [
          `Installed OptiScaler into ${results.length} game folders.`,
          ...current,
        ].slice(0, 12),
      );
    } catch (error) {
      setLogEntries((current) =>
        [`Bulk install failed: ${(error as Error).message}`, ...current].slice(
          0,
          12,
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  async function restoreSelected() {
    if (!selectedGame) return;
    setBusy(true);
    try {
      const result = await window.optiScaler.restoreGame(selectedGame.id);
      setLogEntries((current) =>
        [`Restored ${result.gameTitle} from backup.`, ...current].slice(0, 12),
      );
    } catch (error) {
      setLogEntries((current) =>
        [`Restore failed: ${(error as Error).message}`, ...current].slice(
          0,
          12,
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar-topbar">
          <div className="brand-block">
            <img src={appIconUrl} alt="OptiScaler GUI" className="brand-mark" />
            <div>
              <div className="brand-title">OptiScaler GUI</div>
              <div className="brand-subtitle">
                Game discovery and automated install
              </div>
            </div>
          </div>

          <button
            type="button"
            className="theme-toggle"
            onClick={() =>
              setTheme((current) => (current === "dark" ? "light" : "dark"))
            }
            aria-label={
              theme === "dark"
                ? "Switch to light theme"
                : "Switch to dark theme"
            }
            title={
              theme === "dark"
                ? "Switch to light theme"
                : "Switch to dark theme"
            }
          >
            <ThemeToggleIcon theme={theme} />
          </button>
        </div>

        <div className="sidebar-note">
          Scan your installed library on the left, then handle install, restore,
          and compatibility checks in a single workspace pane.
        </div>

        <div className="sidebar-actions">
          <button
            className="primary-button"
            onClick={refreshGames}
            disabled={busy}
          >
            Rescan libraries
          </button>

          <div className="view-toggle" role="group" aria-label="Library view">
            <button
              type="button"
              className={libraryView === "grid" ? "active" : ""}
              onClick={() => setLibraryView("grid")}
            >
              Grid
            </button>
            <button
              type="button"
              className={libraryView === "list" ? "active" : ""}
              onClick={() => setLibraryView("list")}
            >
              List
            </button>
          </div>

          <label className="toggle">
            <input
              type="checkbox"
              checked={useDiscoveryCache}
              onChange={(event) => setUseDiscoveryCache(event.target.checked)}
            />
            <span>Use cached library on startup</span>
          </label>
        </div>

        <div
          className={`game-browser ${libraryView === "grid" ? "is-grid" : "is-list"}`}
        >
          {games.map((game) => (
            <button
              key={game.id}
              className={`game-card ${libraryView} ${game.id === selectedGameId ? "selected" : ""}`}
              onClick={() => setSelectedGameId(game.id)}
            >
              <div className="game-card-icon" aria-hidden="true">
                {game.iconDataUrl ? (
                  <img
                    src={game.iconDataUrl}
                    alt=""
                    className="game-card-art"
                  />
                ) : (
                  <span>{getGameBadge(game)}</span>
                )}
              </div>
              <div className="game-card-body">
                {getGameTechnologyBadges(game).length > 0 && (
                  <div
                    className="game-tech-badges"
                    aria-label="Detected graphics technology"
                  >
                    {getGameTechnologyBadges(game).map((badge) => (
                      <span key={badge} className="game-tech-badge">
                        {badge}
                      </span>
                    ))}
                  </div>
                )}
                <div className="game-card-title">{game.title}</div>
                <div className="game-card-meta">
                  <span>{game.source}</span>
                  <span>{formatConfidence(game.confidence)}</span>
                </div>
                <div className="game-card-path">{game.installPath}</div>
              </div>
            </button>
          ))}
          {games.length === 0 && (
            <div className="empty-state">No games discovered yet.</div>
          )}
        </div>
      </aside>

      <main className="content">
        <section className="panel workspace-panel">
          <div className="workspace-header">
            <div>
              <div className="eyebrow">OptiScaler deployment console</div>
              <h1>
                {selectedGame
                  ? selectedGame.title
                  : "Select an installed game to manage"}
              </h1>
              <p>
                The workspace keeps the install flow, compatibility notes, and
                progress history in one pane so the library stays compact.
              </p>
            </div>

            <div className="stats-strip">
              <div className="stat">
                <span>Installed</span>
                <strong>{games.length}</strong>
              </div>
              <div className="stat">
                <span>Selected proxy</span>
                <strong>{proxyFilename}</strong>
              </div>
              <div className="stat">
                <span>Status</span>
                <strong>{busy ? "Working" : "Idle"}</strong>
              </div>
            </div>
          </div>

          <div className="panel-header">
            <h2>Install controls</h2>
            <span>
              {selectedGame ? selectedGame.source : "No game selected"}
            </span>
          </div>

          <div className="quick-install-card">
            <div className="quick-install-copy">
              <span>Recommended setup</span>
              <strong>
                {selectedGame?.compatibility?.source === "wiki"
                  ? "Using OptiScaler wiki recommendations"
                  : "Using safe automatic defaults"}
              </strong>
              <p>
                Install uses the recommended proxy file and suggested spoofing
                behavior automatically. Most users should not need to change
                anything.
              </p>
            </div>
            <div className="quick-install-facts">
              <div>
                <span>Proxy</span>
                <strong>{proxyFilename}</strong>
              </div>
              <div>
                <span>Spoofing</span>
                <strong>{enableSpoofing ? "Enabled" : "Disabled"}</strong>
              </div>
              <div>
                <span>OptiPatcher</span>
                <strong>{installOptiPatcher ? "Enabled" : "Off"}</strong>
              </div>
            </div>
          </div>

          <div className="action-row primary-actions">
            <button
              className="primary-button"
              onClick={installSelected}
              disabled={!selectedGame || busy}
            >
              Install recommended
            </button>
            <button
              className="secondary-button"
              onClick={restoreSelected}
              disabled={!selectedGame || busy}
            >
              Restore previous state
            </button>
            <button
              className="ghost-button"
              onClick={installAll}
              disabled={games.length === 0 || busy}
            >
              Install all recommended
            </button>
          </div>

          <button
            type="button"
            className="ghost-button advanced-toggle"
            onClick={() => setShowAdvancedOptions((current) => !current)}
            disabled={!selectedGame || busy}
          >
            {showAdvancedOptions
              ? "Hide advanced options"
              : "Show advanced options"}
          </button>

          <div className="compatibility-callout">
            OptiScaler works best on games that already expose DLSS2+, FSR2+ or
            XeSS. The app now also scans local binaries and config files to
            infer which upscaler and frame-generation paths ship with each
            detected game, while the wiki entry below still drives the install
            defaults.
          </div>

          {showAdvancedOptions && (
            <div className="advanced-panel">
              <label>
                Proxy filename
                <select
                  value={proxyFilename}
                  onChange={(event) =>
                    setProxyFilename(event.target.value as ProxyFilename)
                  }
                >
                  {PROXY_CHOICES.map((choice) => (
                    <option key={choice} value={choice}>
                      {choice}
                    </option>
                  ))}
                </select>
                <span className="field-help">
                  {getProxyGuide(proxyFilename)}
                </span>
              </label>

              <label>
                GPU profile
                <select
                  value={gpuVendor}
                  onChange={(event) =>
                    setGpuVendor(event.target.value as "amd-intel" | "nvidia")
                  }
                >
                  <option value="amd-intel">AMD / Intel</option>
                  <option value="nvidia">Nvidia</option>
                </select>
                <span className="field-help">{GPU_GUIDE[gpuVendor]}</span>
              </label>

              <div className="option-grid compact-option-grid">
                <div className="option-card">
                  <span>Proxy filename</span>
                  <strong>Which DLL gets dropped into the game folder.</strong>
                  <p>
                    Change this only if the selected game or launcher needs a
                    different hook point than the recommendation.
                  </p>
                </div>
                <div className="option-card">
                  <span>Optional extras</span>
                  <strong>
                    Leave these on the recommended defaults unless you know you
                    need them.
                  </strong>
                  <p>
                    Spoofing can unlock more paths on some games. OptiPatcher is
                    only useful for titles specifically called out by the wiki.
                  </p>
                </div>
              </div>

              <div className="toggle-row">
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={enableSpoofing}
                    onChange={(event) =>
                      setEnableSpoofing(event.target.checked)
                    }
                  />
                  <span>Keep spoofing enabled</span>
                </label>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={installOptiPatcher}
                    onChange={(event) =>
                      setInstallOptiPatcher(event.target.checked)
                    }
                  />
                  <span>Download OptiPatcher when available</span>
                </label>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={preserveOriginalState}
                    onChange={(event) =>
                      setPreserveOriginalState(event.target.checked)
                    }
                  />
                  <span>Preserve original file state for restore</span>
                </label>
              </div>
            </div>
          )}

          {selectedGame && (
            <div className="details-card">
              <div>
                <span>Executable</span>
                <strong>{selectedGame.executablePath}</strong>
              </div>
              <div>
                <span>Recommended</span>
                <strong>{selectedGame.recommendation}</strong>
              </div>
              <div>
                <span>Notes</span>
                <strong>{selectedGame.notes.join(", ")}</strong>
              </div>
              <div>
                <span>Compatibility source</span>
                <strong>
                  {selectedGame.compatibility?.source === "wiki"
                    ? (selectedGame.compatibility.wikiPageTitle ?? "Wiki match")
                    : "Heuristic fallback"}
                </strong>
              </div>
              {selectedGame.compatibility?.wikiPageUrl && (
                <div>
                  <span>Wiki page</span>
                  <strong>{selectedGame.compatibility.wikiPageUrl}</strong>
                </div>
              )}
              <div className="details-section-title">Active config</div>
              <div className="compatibility-summary">
                <div className="compatibility-summary-row">
                  <span>Configured upscaler</span>
                  <strong>
                    {formatActiveSetting(selectedGame.activeGraphics?.upscaler)}
                  </strong>
                </div>
                <div className="compatibility-summary-row">
                  <span>Configured FG</span>
                  <strong>
                    {formatActiveSetting(
                      selectedGame.activeGraphics?.frameGeneration,
                    )}
                  </strong>
                </div>
                <div className="compatibility-summary-row">
                  <span>Config files</span>
                  <strong>
                    {formatConfigFiles(
                      selectedGame.activeGraphics?.configFiles,
                    )}
                  </strong>
                </div>
                <div className="compatibility-summary-row">
                  <span>Config evidence</span>
                  <strong>
                    {formatDetectionEvidence(
                      selectedGame.activeGraphics?.evidence,
                    )}
                  </strong>
                </div>
              </div>
              <div className="details-section-title">Local graphics scan</div>
              <div className="compatibility-summary">
                <div className="compatibility-summary-row">
                  <span>Detected upscalers</span>
                  <strong>
                    {formatCompatibilityList(
                      selectedGame.detectedGraphics?.upscalers,
                    )}
                  </strong>
                </div>
                <div className="compatibility-summary-row">
                  <span>Detected FG methods</span>
                  <strong>
                    {formatCompatibilityList(
                      selectedGame.detectedGraphics?.frameGeneration,
                    )}
                  </strong>
                </div>
                <div className="compatibility-summary-row">
                  <span>Detection evidence</span>
                  <strong>
                    {formatDetectionEvidence(
                      selectedGame.detectedGraphics?.evidence,
                    )}
                  </strong>
                </div>
              </div>
              {selectedGame.compatibility && (
                <>
                  <div className="details-section-title">
                    Wiki compatibility
                  </div>
                  <div className="compatibility-summary">
                    <div className="compatibility-summary-row">
                      <span>Suggested proxy</span>
                      <strong>
                        {selectedGame.compatibility.recommendedProxy ??
                          "dxgi.dll"}
                      </strong>
                    </div>
                    <div className="compatibility-summary-row">
                      <span>Suggested spoofing</span>
                      <strong>
                        {selectedGame.compatibility.suggestedSpoofing ===
                        undefined
                          ? "Use current GPU default"
                          : selectedGame.compatibility.suggestedSpoofing
                            ? "Enabled"
                            : "Disabled"}
                      </strong>
                    </div>
                    <div className="compatibility-summary-row">
                      <span>Suggested OptiPatcher</span>
                      <strong>
                        {selectedGame.compatibility.suggestedOptiPatcher ===
                        undefined
                          ? "Not specified"
                          : selectedGame.compatibility.suggestedOptiPatcher
                            ? "Enable"
                            : "Disable"}
                      </strong>
                    </div>
                    <div className="compatibility-summary-row">
                      <span>Upscaler inputs</span>
                      <strong>
                        {formatCompatibilityInputs(
                          selectedGame.compatibility.upscalerInputs,
                          selectedGame.detectedGraphics?.upscalers,
                        )}
                      </strong>
                    </div>
                    <div className="compatibility-summary-row">
                      <span>FG inputs</span>
                      <strong>
                        {formatCompatibilityInputs(
                          selectedGame.compatibility.fgInputs,
                          selectedGame.detectedGraphics?.frameGeneration,
                        )}
                      </strong>
                    </div>
                    {selectedGame.compatibility.settings && (
                      <div className="compatibility-summary-row">
                        <span>Settings</span>
                        <strong>{selectedGame.compatibility.settings}</strong>
                      </div>
                    )}
                    {selectedGame.compatibility.knownIssues && (
                      <div className="compatibility-summary-row">
                        <span>Known issues</span>
                        <strong>
                          {selectedGame.compatibility.knownIssues}
                        </strong>
                      </div>
                    )}
                    {selectedGame.compatibility.notes && (
                      <div className="compatibility-summary-row">
                        <span>Wiki notes</span>
                        <strong>{selectedGame.compatibility.notes}</strong>
                      </div>
                    )}
                  </div>
                </>
              )}
              <div>
                <span>Installer guidance</span>
                <strong>
                  The selected wiki match now drives the default proxy and
                  spoofing choice. The active config section reflects likely
                  user settings files, while the local scan shows shipped
                  support detected from nearby binaries and config assets.
                </strong>
              </div>
            </div>
          )}

          <div className="activity-block">
            <div className="panel-header">
              <h2>Progress</h2>
              <span>
                {progress ? `${progress.done}/${progress.total}` : "Waiting"}
              </span>
            </div>
            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{
                  width:
                    progress && progress.total
                      ? `${(progress.done / progress.total) * 100}%`
                      : "0%",
                }}
              />
            </div>
            <div className="progress-text">
              {progress
                ? `${progress.phase}: ${progress.message}`
                : "No active operation."}
            </div>
            <div className="log-list">
              {logEntries.map((entry) => (
                <div key={entry} className="log-entry">
                  {entry}
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
