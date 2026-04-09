export type ProxyFilename =
  | "dxgi.dll"
  | "winmm.dll"
  | "version.dll"
  | "dbghelp.dll"
  | "d3d12.dll"
  | "wininet.dll"
  | "winhttp.dll"
  | "OptiScaler.asi";

export type GameSource =
  | "Steam"
  | "Epic"
  | "GOG"
  | "Ubisoft"
  | "Xbox"
  | "Battle.net"
  | "Manual"
  | "Unknown";

export type CompatibilitySource = "wiki" | "heuristic" | "none";

export interface CompatibilityRecommendation {
  source: CompatibilitySource;
  wikiPageTitle?: string;
  wikiPageUrl?: string;
  recommendedProxy?: ProxyFilename;
  suggestedSpoofing?: boolean;
  suggestedOptiPatcher?: boolean;
  upscalerInputs?: string[];
  fgInputs?: string[];
  settings?: string;
  knownIssues?: string;
  notes?: string;
}

export interface GraphicsTechnologyDetection {
  upscalers: string[];
  frameGeneration: string[];
  evidence: string[];
}

export interface GraphicsTechnologyConfiguration {
  upscaler?: string;
  frameGeneration?: string;
  evidence: string[];
  configFiles: string[];
}

export interface DiscoveredGame {
  id: string;
  title: string;
  source: GameSource;
  installPath: string;
  executablePath: string;
  recommendation: ProxyFilename;
  confidence: number;
  notes: string[];
  iconDataUrl?: string;
  detectedGraphics?: GraphicsTechnologyDetection;
  activeGraphics?: GraphicsTechnologyConfiguration;
  compatibility?: CompatibilityRecommendation;
}

export interface InstallOptions {
  releaseUrl?: string;
  proxyFilename: ProxyFilename;
  enableSpoofing: boolean;
  installOptiPatcher: boolean;
  preserveOriginalState: boolean;
}

export interface InstallProgress {
  phase: string;
  message: string;
  done: number;
  total: number;
}

export interface InstallResult {
  gameId: string;
  gameTitle: string;
  installedTo: string;
  proxyFilename: ProxyFilename;
  restored: boolean;
  notes: string[];
}
