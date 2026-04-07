import { app } from "electron";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  DiscoveredGame,
  GameSource,
  GraphicsTechnologyConfiguration,
  GraphicsTechnologyDetection,
  ProxyFilename,
} from "../shared/types";
import { getWikiCompatibilityAdvice } from "./wikiCompatibility";

const INVALID_EXE_PATTERNS = [
  /^unins/i,
  /^setup/i,
  /^install/i,
  /vcredist/i,
  /dxsetup/i,
  /crash/i,
  /repair/i,
  /launcher/i,
  /webhelper/i,
];

const INVALID_FOLDER_PATTERNS = [
  /^__installer$/i,
  /^redist$/i,
  /^redistributables?$/i,
  /^support$/i,
  /^launcher$/i,
  /^engine$/i,
  /^prereq/i,
  /^directx/i,
  /^commonredist$/i,
  /^epic online services$/i,
];

const INVALID_EXECUTABLE_PATH_SEGMENTS = [
  /\\__installer(\\|$)/i,
  /\\redist(\\|$)/i,
  /\\redistributables?(\\|$)/i,
  /\\support(\\|$)/i,
  /\\directx(\\|$)/i,
  /\\prereq[^\\]*(\\|$)/i,
  /\\commonredist(\\|$)/i,
  /\\engine\\extras(\\|$)/i,
  /\\_?installer(\\|$)/i,
];

const ROOT_CANDIDATES: Array<{ source: GameSource; roots: string[] }> = [
  {
    source: "Steam",
    roots: [
      path.join(
        process.env.PROGRAMFILES_X86 ?? "C:\\Program Files (x86)",
        "Steam",
        "steamapps",
        "common",
      ),
      path.join(
        process.env.PROGRAMFILES ?? "C:\\Program Files",
        "Steam",
        "steamapps",
        "common",
      ),
    ],
  },
  {
    source: "Epic",
    roots: [
      path.join(process.env.PROGRAMFILES ?? "C:\\Program Files", "Epic Games"),
      path.join(
        process.env.PROGRAMFILES_X86 ?? "C:\\Program Files (x86)",
        "Epic Games",
      ),
    ],
  },
  {
    source: "GOG",
    roots: [
      path.join(
        process.env.PROGRAMFILES ?? "C:\\Program Files",
        "GOG Galaxy",
        "Games",
      ),
    ],
  },
  {
    source: "Ubisoft",
    roots: [
      path.join(
        process.env.PROGRAMFILES_X86 ?? "C:\\Program Files (x86)",
        "Ubisoft",
        "Ubisoft Game Launcher",
        "games",
      ),
    ],
  },
  {
    source: "Xbox",
    roots: [path.join("C:\\", "XboxGames")],
  },
];

const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".bmp",
  ".ico",
]);

const LOCAL_ART_KEYWORDS = [
  "cover",
  "capsule",
  "header",
  "hero",
  "library",
  "poster",
  "banner",
  "boxart",
];

const steamManifestCache = new Map<string, Map<string, string>>();
const remoteArtCache = new Map<string, string | undefined>();
const gogCatalogCache = new Map<string, string | undefined>();
const epicRemoteUrlCache = new Map<string, string | undefined>();
const ubisoftRemoteUrlCache = new Map<string, string | undefined>();
const epicCatalogTextCache = new Map<string, string>();

const REMOTE_ART_CACHE_FOLDER = "game-art-cache";
const REMOTE_ART_USER_AGENT =
  "OptiScaler-GUI/0.1 (+https://github.com/optiscaler/OptiScaler)";
const EPIC_IMAGE_URL_REGEX =
  /https?:\/\/[^\s"'<>]+(?:dieselgameboxtall|dieselgamebox|portrait|storefront|vertical|cover)[^\s"'<>]*/gi;

const DETECTION_TEXT_EXTENSIONS = new Set([
  ".cfg",
  ".conf",
  ".ini",
  ".json",
  ".txt",
  ".user",
  ".utxt",
  ".xml",
]);

const DETECTION_BINARY_EXTENSIONS = new Set([".dll", ".exe"]);
const DETECTION_MAX_TEXT_BYTES = 512 * 1024;
const DETECTION_MAX_BINARY_BYTES = 4 * 1024 * 1024;
const DETECTION_MAX_FILES = 28;
const CONFIG_MAX_FILES = 24;
const CONFIG_MAX_BYTES = 512 * 1024;
const DETECTION_PATH_KEYWORDS = [
  "config",
  "dlss",
  "dlssg",
  "fidelityfx",
  "framegen",
  "framegeneration",
  "fsr",
  "interpolation",
  "nvngx",
  "streamline",
  "upscaler",
  "xess",
];

const CONFIG_FILE_KEYWORDS = [
  "engine",
  "framegen",
  "framegeneration",
  "gameusersettings",
  "graphics",
  "interpolation",
  "render",
  "settings",
  "streamline",
  "upscaler",
  "user",
  "video",
];

const CONFIG_ACTIVE_KEYWORDS =
  /active|current|enable|enabled|method|mode|preset|quality|selected|state|type|upscal/i;

const DETECTION_IGNORED_PATH_SEGMENTS = [
  /\\\.optiscaler-backup(\\|$)/i,
  /\\optiscaler[^\\]*(\\|$)/i,
];

type GraphicsFeatureCategory = "upscaler" | "frame-generation";

interface GraphicsFeatureRule {
  name: string;
  category: GraphicsFeatureCategory;
  filePatterns: RegExp[];
  contentPatterns: RegExp[];
}

interface ParsedGraphicsConfig {
  upscaler?: string;
  frameGeneration?: string;
  evidence: string[];
}

interface EnumGraphicsConfigResult {
  value?: string;
  confidence: number;
}

const GRAPHICS_FEATURE_RULES: GraphicsFeatureRule[] = [
  {
    name: "DLSS Super Resolution",
    category: "upscaler",
    filePatterns: [/nvngx_dlss/i, /sl\.dlss/i],
    contentPatterns: [
      /\bnvngx[_ .-]?dlss\b/i,
      /\bdlss super resolution\b/i,
      /\bsl[._ -]?dlss\b/i,
      /\bdlss quality\b/i,
    ],
  },
  {
    name: "FSR 2",
    category: "upscaler",
    filePatterns: [/ffx_fsr2/i, /fsr2/i],
    contentPatterns: [
      /\bffx[_ .-]?fsr2\b/i,
      /\bfsr ?2\b/i,
      /\bfidelityfx super resolution 2\b/i,
    ],
  },
  {
    name: "FSR 3 Upscaling",
    category: "upscaler",
    filePatterns: [/ffx_fsr3upscaler/i, /fsr3upscaler/i],
    contentPatterns: [
      /\bffx[_ .-]?fsr3upscaler\b/i,
      /\bfsr ?3 upscal/i,
      /\bfidelityfx super resolution 3\b/i,
    ],
  },
  {
    name: "FSR 4",
    category: "upscaler",
    filePatterns: [/fsr4/i],
    contentPatterns: [/\bfsr ?4\b/i, /\bfidelityfx super resolution 4\b/i],
  },
  {
    name: "XeSS",
    category: "upscaler",
    filePatterns: [/libxess/i, /(^|[^a-z])xess([^a-z]|$)/i],
    contentPatterns: [
      /\bintel xess\b/i,
      /\bxe super sampling\b/i,
      /\blibxess\b/i,
      /\bxess quality\b/i,
    ],
  },
  {
    name: "TSR",
    category: "upscaler",
    filePatterns: [/temporalsuperresolution/i],
    contentPatterns: [
      /\btemporal super resolution\b/i,
      /\bunreal engine.*tsr\b/i,
    ],
  },
  {
    name: "DLSS Frame Generation",
    category: "frame-generation",
    filePatterns: [/nvngx_dlssg/i, /sl\.dlss_g/i, /dlssg/i],
    contentPatterns: [
      /\bnvngx[_ .-]?dlssg\b/i,
      /\bdlss frame generation\b/i,
      /\bsl[._ -]?dlss_g\b/i,
      /\bframe generation\b.{0,48}\bdlss\b/i,
    ],
  },
  {
    name: "FSR 3 Frame Generation",
    category: "frame-generation",
    filePatterns: [
      /ffx_fsr3fi/i,
      /frameinterpolation/i,
      /fidelityfx_frameinterpolation/i,
    ],
    contentPatterns: [
      /\bffx[_ .-]?fsr3fi\b/i,
      /\bfsr ?3 frame generation\b/i,
      /\bfidelityfx frame interpolation\b/i,
      /\bamd fluid motion frames\b/i,
      /\bframe interpolation\b/i,
    ],
  },
  {
    name: "XeSS Frame Generation",
    category: "frame-generation",
    filePatterns: [/libxessfg/i, /xessfg/i],
    contentPatterns: [
      /\blibxessfg\b/i,
      /\bxess frame generation\b/i,
      /\bxessfg\b/i,
    ],
  },
];

interface EpicManifestRecord {
  installLocation?: string;
  catalogItemId?: string;
  appName?: string;
  displayName?: string;
}

interface UbisoftArtRecord {
  title: string;
  thumbImage?: string;
  logoImage?: string;
}

function safeReadDir(folderPath: string): fs.Dirent[] {
  try {
    return fs.readdirSync(folderPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

function safeReadTextFile(filePath: string): string | undefined {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return undefined;
  }
}

function safeReadBinaryFile(filePath: string): Buffer | undefined {
  try {
    return fs.readFileSync(filePath);
  } catch {
    return undefined;
  }
}

function walkForFiles(
  folderPath: string,
  predicate: (entryPath: string, entry: fs.Dirent) => boolean,
  maxDepth: number,
  currentDepth = 0,
): string[] {
  if (currentDepth > maxDepth) {
    return [];
  }

  const matches: string[] = [];
  for (const entry of safeReadDir(folderPath)) {
    const entryPath = path.join(folderPath, entry.name);

    if (entry.isFile() && predicate(entryPath, entry)) {
      matches.push(entryPath);
      continue;
    }

    if (entry.isDirectory() && currentDepth < maxDepth) {
      matches.push(
        ...walkForFiles(entryPath, predicate, maxDepth, currentDepth + 1),
      );
    }
  }

  return matches;
}

function isDetectionCandidateFile(filePath: string): boolean {
  const normalizedPath = filePath.toLowerCase();
  if (
    DETECTION_IGNORED_PATH_SEGMENTS.some((pattern) => pattern.test(filePath))
  ) {
    return false;
  }

  const baseName = path.basename(normalizedPath);
  if (baseName.startsWith("optiscaler")) {
    return false;
  }

  const extension = path.extname(normalizedPath);
  return (
    DETECTION_TEXT_EXTENSIONS.has(extension) ||
    DETECTION_BINARY_EXTENSIONS.has(extension)
  );
}

function scoreDetectionCandidate(
  installPath: string,
  executablePath: string,
  filePath: string,
): number {
  const normalizedPath = filePath.toLowerCase();
  const normalizedExecutable = executablePath.toLowerCase();
  const relativePath = path.relative(installPath, filePath).toLowerCase();
  const baseName = path.basename(normalizedPath);
  const extension = path.extname(normalizedPath);
  let score = 0;

  if (normalizedPath === normalizedExecutable) {
    score += 200;
  }

  if (DETECTION_BINARY_EXTENSIONS.has(extension)) {
    score += 70;
  }

  if (DETECTION_TEXT_EXTENSIONS.has(extension)) {
    score += 35;
  }

  if (relativePath.includes("config") || relativePath.includes("setting")) {
    score += 40;
  }

  for (const keyword of DETECTION_PATH_KEYWORDS) {
    if (baseName.includes(keyword) || relativePath.includes(keyword)) {
      score += 55;
    }
  }

  return score;
}

function readDetectionContent(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  const buffer = safeReadBinaryFile(filePath);
  if (!buffer || buffer.length === 0) {
    return "";
  }

  if (DETECTION_TEXT_EXTENSIONS.has(extension)) {
    const limited = buffer.subarray(0, DETECTION_MAX_TEXT_BYTES);
    return `${limited.toString("utf8")}\n${limited.toString("utf16le")}`;
  }

  if (DETECTION_BINARY_EXTENSIONS.has(extension)) {
    const limited = buffer.subarray(0, DETECTION_MAX_BINARY_BYTES);
    return `${limited.toString("latin1")}\n${limited.toString("utf16le")}`;
  }

  return "";
}

function detectGraphicsTechnology(
  installPath: string,
  executablePath: string,
): GraphicsTechnologyDetection | undefined {
  const candidates = walkForFiles(
    installPath,
    (entryPath, entry) => entry.isFile() && isDetectionCandidateFile(entryPath),
    3,
  )
    .sort(
      (left, right) =>
        scoreDetectionCandidate(installPath, executablePath, right) -
        scoreDetectionCandidate(installPath, executablePath, left),
    )
    .slice(0, DETECTION_MAX_FILES);

  if (candidates.length === 0) {
    return undefined;
  }

  const fileContentCache = new Map<string, string>();
  const matches = new Map<
    string,
    {
      category: GraphicsFeatureCategory;
      score: number;
      evidence: Set<string>;
    }
  >();

  for (const candidatePath of candidates) {
    const relativePath =
      path.relative(installPath, candidatePath) || path.basename(candidatePath);
    const normalizedRelativePath = relativePath.toLowerCase();

    for (const rule of GRAPHICS_FEATURE_RULES) {
      let score = 0;
      const evidence = new Set<string>();

      if (
        rule.filePatterns.some((pattern) =>
          pattern.test(normalizedRelativePath),
        )
      ) {
        score += 3;
        evidence.add(`${rule.name} filename in ${relativePath}`);
      }

      let candidateContent = fileContentCache.get(candidatePath);
      if (candidateContent === undefined) {
        candidateContent = readDetectionContent(candidatePath);
        fileContentCache.set(candidatePath, candidateContent);
      }

      if (
        candidateContent &&
        rule.contentPatterns.some((pattern) => pattern.test(candidateContent))
      ) {
        score += 2;
        evidence.add(`${rule.name} strings in ${relativePath}`);
      }

      if (score === 0) {
        continue;
      }

      const existing = matches.get(rule.name);
      if (existing) {
        existing.score += score;
        for (const entry of evidence) {
          existing.evidence.add(entry);
        }
      } else {
        matches.set(rule.name, {
          category: rule.category,
          score,
          evidence,
        });
      }
    }
  }

  if (matches.size === 0) {
    return undefined;
  }

  const sortedMatches = Array.from(matches.entries()).sort(
    ([leftName, left], [rightName, right]) =>
      right.score - left.score || leftName.localeCompare(rightName),
  );

  const upscalers = sortedMatches
    .filter(([, value]) => value.category === "upscaler")
    .map(([name]) => name);
  const frameGeneration = sortedMatches
    .filter(([, value]) => value.category === "frame-generation")
    .map(([name]) => name);
  const evidence = sortedMatches
    .flatMap(([, value]) => Array.from(value.evidence))
    .slice(0, 6);

  return {
    upscalers,
    frameGeneration,
    evidence,
  };
}

function getTitlePathVariants(titleCandidates: string[]): string[] {
  const variants = new Set<string>();

  for (const title of titleCandidates) {
    const trimmed = title.trim();
    if (!trimmed) {
      continue;
    }

    const sanitized = trimmed
      .replace(/[<>:"/\\|?*]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const collapsed = sanitized
      .replace(/[']/g, "")
      .replace(/[^\w .-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    for (const variant of [trimmed, sanitized, collapsed]) {
      if (variant) {
        variants.add(variant);
      }
    }
  }

  return Array.from(variants);
}

function addDirectoryIfExists(
  results: Set<string>,
  directoryPath: string,
): void {
  if (!directoryPath || !fs.existsSync(directoryPath)) {
    return;
  }

  try {
    if (fs.statSync(directoryPath).isDirectory()) {
      results.add(directoryPath);
    }
  } catch {
    // Ignore inaccessible directories.
  }
}

function scoreCandidateDirectory(
  titleCandidates: string[],
  directoryName: string,
): number {
  const normalizedDirectory = normalizeTitle(directoryName);
  if (!normalizedDirectory) {
    return 0;
  }

  let bestScore = 0;
  for (const candidate of titleCandidates) {
    const normalizedCandidate = normalizeTitle(candidate);
    if (!normalizedCandidate) {
      continue;
    }

    if (normalizedDirectory === normalizedCandidate) {
      bestScore = Math.max(bestScore, 100);
      continue;
    }

    if (
      normalizedDirectory.includes(normalizedCandidate) ||
      normalizedCandidate.includes(normalizedDirectory)
    ) {
      bestScore = Math.max(bestScore, 72);
    }
  }

  return bestScore;
}

function getLikelyConfigRoots(
  installPath: string,
  executablePath: string,
  titleCandidates: string[],
): string[] {
  const roots = new Set<string>();
  const titleVariants = getTitlePathVariants(titleCandidates);
  const userProfile = process.env.USERPROFILE ?? "";
  const baseDirectories = [
    path.join(userProfile, "Documents"),
    path.join(userProfile, "Documents", "My Games"),
    path.join(userProfile, "Saved Games"),
    process.env.LOCALAPPDATA ?? path.join(userProfile, "AppData", "Local"),
    process.env.APPDATA ?? path.join(userProfile, "AppData", "Roaming"),
    path.join(userProfile, "AppData", "LocalLow"),
  ];

  addDirectoryIfExists(roots, installPath);
  addDirectoryIfExists(roots, path.dirname(executablePath));
  addDirectoryIfExists(roots, path.join(installPath, "Saved"));
  addDirectoryIfExists(roots, path.join(installPath, "Saved", "Config"));
  addDirectoryIfExists(roots, path.join(installPath, "Engine"));

  for (const baseDirectory of baseDirectories) {
    addDirectoryIfExists(roots, baseDirectory);

    for (const variant of titleVariants) {
      addDirectoryIfExists(roots, path.join(baseDirectory, variant));
      addDirectoryIfExists(roots, path.join(baseDirectory, variant, "Saved"));
      addDirectoryIfExists(roots, path.join(baseDirectory, variant, "Config"));
      addDirectoryIfExists(
        roots,
        path.join(baseDirectory, variant, "Saved", "Config"),
      );
    }

    const directMatches = safeReadDir(baseDirectory)
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({
        path: path.join(baseDirectory, entry.name),
        score: scoreCandidateDirectory(titleCandidates, entry.name),
      }))
      .filter((entry) => entry.score >= 72)
      .sort((left, right) => right.score - left.score)
      .slice(0, 4);

    for (const match of directMatches) {
      addDirectoryIfExists(roots, match.path);
    }
  }

  return Array.from(roots);
}

function isConfigCandidateFile(filePath: string): boolean {
  if (!DETECTION_TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase())) {
    return false;
  }

  const fileName = path.basename(filePath).toLowerCase();
  return CONFIG_FILE_KEYWORDS.some((keyword) => fileName.includes(keyword));
}

function scoreConfigCandidateFile(rootPath: string, filePath: string): number {
  const relativePath = path.relative(rootPath, filePath).toLowerCase();
  const fileName = path.basename(filePath).toLowerCase();
  let score = 0;

  if (fileName === "gameusersettings.ini") score += 160;
  if (fileName === "engine.ini") score += 100;
  if (fileName.includes("graphics")) score += 90;
  if (fileName.includes("video")) score += 70;
  if (fileName.includes("settings")) score += 60;
  if (fileName.includes("user")) score += 50;
  if (relativePath.includes("saved\\config")) score += 80;
  if (relativePath.includes("config")) score += 30;
  if (relativePath.includes("render")) score += 20;

  return score;
}

function getConfigCandidateFiles(
  installPath: string,
  executablePath: string,
  titleCandidates: string[],
): string[] {
  const candidates = new Map<string, number>();

  for (const rootPath of getLikelyConfigRoots(
    installPath,
    executablePath,
    titleCandidates,
  )) {
    const files = walkForFiles(
      rootPath,
      (entryPath, entry) => entry.isFile() && isConfigCandidateFile(entryPath),
      4,
    );

    for (const filePath of files) {
      let fileSize = 0;
      try {
        fileSize = fs.statSync(filePath).size;
      } catch {
        fileSize = 0;
      }

      if (fileSize === 0 || fileSize > CONFIG_MAX_BYTES) {
        continue;
      }

      const score = scoreConfigCandidateFile(rootPath, filePath);
      const currentScore = candidates.get(filePath) ?? -1;
      if (score > currentScore) {
        candidates.set(filePath, score);
      }
    }
  }

  return Array.from(candidates.entries())
    .sort(
      (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
    )
    .slice(0, CONFIG_MAX_FILES)
    .map(([filePath]) => filePath);
}

function normalizeConfigValue(value: string): string {
  return value
    .trim()
    .replace(/^["']+|["',]+$/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isTruthyConfigValue(value: string): boolean {
  const normalized = normalizeConfigValue(value).toLowerCase();
  return ["1", "true", "yes", "on", "enable", "enabled"].includes(normalized);
}

function isFalsyConfigValue(value: string): boolean {
  const normalized = normalizeConfigValue(value).toLowerCase();
  return ["0", "false", "no", "off", "disable", "disabled"].includes(
    normalized,
  );
}

function parseConfigInteger(value: string): number | undefined {
  const normalized = normalizeConfigValue(value);
  if (!/^-?\d+$/.test(normalized)) {
    return undefined;
  }

  const parsed = Number.parseInt(normalized, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function decodeGenericUpscalerEnum(
  normalizedKey: string,
  numericValue: number,
): EnumGraphicsConfigResult | undefined {
  if (!/(upscaler|upscale|super.?resolution|aa.?method|anti.?aliasing)/.test(normalizedKey)) {
    return undefined;
  }

  if (numericValue <= 0) {
    return { value: "Off / Native", confidence: 1 };
  }

  if (/dlss/.test(normalizedKey)) {
    return { value: "DLSS Super Resolution", confidence: 3 };
  }

  if (/xess/.test(normalizedKey)) {
    return { value: "XeSS", confidence: 3 };
  }

  if (/fsr4/.test(normalizedKey)) {
    return { value: "FSR 4", confidence: 3 };
  }

  if (/fsr3/.test(normalizedKey)) {
    return { value: "FSR 3 Upscaling", confidence: 3 };
  }

  if (/fsr|fidelityfx/.test(normalizedKey)) {
    return { value: "FSR 2", confidence: 3 };
  }

  if (/tsr|temporal/.test(normalizedKey)) {
    return { value: "TSR", confidence: 3 };
  }

  if (/aa.?method|anti.?aliasing/.test(normalizedKey)) {
    if (numericValue === 4) {
      return { value: "TSR", confidence: 2 };
    }

    return undefined;
  }

  const enumMap = new Map<number, string>([
    [1, "DLSS Super Resolution"],
    [2, "FSR 2"],
    [3, "XeSS"],
    [4, "TSR"],
    [5, "FSR 3 Upscaling"],
    [6, "FSR 4"],
  ]);
  const mappedValue = enumMap.get(numericValue);
  return mappedValue ? { value: mappedValue, confidence: 1 } : undefined;
}

function decodeGenericFrameGenerationEnum(
  normalizedKey: string,
  numericValue: number,
): EnumGraphicsConfigResult | undefined {
  if (!/(frame|interpolation|generation|streamline|dlssg|xessfg)/.test(normalizedKey)) {
    return undefined;
  }

  if (numericValue <= 0) {
    return { value: "Off", confidence: 1 };
  }

  if (/dlss|streamline|dlssg/.test(normalizedKey)) {
    return { value: "DLSS Frame Generation", confidence: 3 };
  }

  if (/xess|xessfg/.test(normalizedKey)) {
    return { value: "XeSS Frame Generation", confidence: 3 };
  }

  if (/fsr|fidelityfx|interpolation/.test(normalizedKey)) {
    return { value: "FSR 3 Frame Generation", confidence: 3 };
  }

  const enumMap = new Map<number, string>([
    [1, "DLSS Frame Generation"],
    [2, "FSR 3 Frame Generation"],
    [3, "XeSS Frame Generation"],
  ]);
  const mappedValue = enumMap.get(numericValue);
  return mappedValue ? { value: mappedValue, confidence: 1 } : undefined;
}

function decodeEngineSpecificUpscalerEnum(
  normalizedKey: string,
  numericValue: number,
): EnumGraphicsConfigResult | undefined {
  if (/r\.ngx\.dlss|dlssquality|dlssmode|dlssenabled/.test(normalizedKey)) {
    return numericValue <= 0
      ? { value: "Off / Native", confidence: 3 }
      : { value: "DLSS Super Resolution", confidence: 4 };
  }

  if (/r\.xess|xessquality|xessmode|xessenabled/.test(normalizedKey)) {
    return numericValue <= 0
      ? { value: "Off / Native", confidence: 3 }
      : { value: "XeSS", confidence: 4 };
  }

  if (/r\.fidelityfx\.fsr4|fsr4/.test(normalizedKey)) {
    return numericValue <= 0
      ? { value: "Off / Native", confidence: 3 }
      : { value: "FSR 4", confidence: 4 };
  }

  if (/r\.fidelityfx\.fsr3|fsr3upscaler|fsr3quality/.test(normalizedKey)) {
    return numericValue <= 0
      ? { value: "Off / Native", confidence: 3 }
      : { value: "FSR 3 Upscaling", confidence: 4 };
  }

  if (/r\.fidelityfx\.fsr2|fsr2quality|fsr2mode/.test(normalizedKey)) {
    return numericValue <= 0
      ? { value: "Off / Native", confidence: 3 }
      : { value: "FSR 2", confidence: 4 };
  }

  if (/r\.temporalsuperresolution|r\.tsr|tsrenabled/.test(normalizedKey)) {
    return numericValue <= 0
      ? { value: "Off / Native", confidence: 3 }
      : { value: "TSR", confidence: 4 };
  }

  if (/r\.antialiasingmethod/.test(normalizedKey)) {
    if (numericValue === 4) {
      return { value: "TSR", confidence: 4 };
    }

    if (numericValue === 0) {
      return { value: "Off / Native", confidence: 2 };
    }
  }

  return decodeGenericUpscalerEnum(normalizedKey, numericValue);
}

function decodeEngineSpecificFrameGenerationEnum(
  normalizedKey: string,
  numericValue: number,
): EnumGraphicsConfigResult | undefined {
  if (/streamline|dlssg|dlssgmode|framegenerationdlss/.test(normalizedKey)) {
    return numericValue <= 0
      ? { value: "Off", confidence: 3 }
      : { value: "DLSS Frame Generation", confidence: 4 };
  }

  if (/fidelityfx.*fi|frameinterpolation|fsr3fi|amd fluid motion/.test(normalizedKey)) {
    return numericValue <= 0
      ? { value: "Off", confidence: 3 }
      : { value: "FSR 3 Frame Generation", confidence: 4 };
  }

  if (/xessfg|xess frame generation/.test(normalizedKey)) {
    return numericValue <= 0
      ? { value: "Off", confidence: 3 }
      : { value: "XeSS Frame Generation", confidence: 4 };
  }

  return decodeGenericFrameGenerationEnum(normalizedKey, numericValue);
}

function inferUpscalerFromKeyValue(
  key: string,
  value: string,
): string | undefined {
  const normalizedKey = normalizeConfigValue(key).toLowerCase();
  const normalizedValue = normalizeConfigValue(value).toLowerCase();
  const numericValue = parseConfigInteger(value);

  if (numericValue !== undefined) {
    const decoded = decodeEngineSpecificUpscalerEnum(
      normalizedKey,
      numericValue,
    );
    if (decoded?.value) {
      return decoded.value;
    }
  }

  if (
    !CONFIG_ACTIVE_KEYWORDS.test(normalizedKey) &&
    !/(dlss|fsr|xess|tsr|super.?resolution|anti.?aliasing)/i.test(normalizedKey)
  ) {
    return undefined;
  }

  if (/frame|interpolation|generation|dlssg|xessfg/.test(normalizedKey)) {
    return undefined;
  }

  if (
    /(upscal|super.?resolution|anti.?aliasing|dlss|fsr|xess|tsr)/.test(
      normalizedKey,
    ) &&
    (/(native|none)/.test(normalizedValue) ||
      isFalsyConfigValue(normalizedValue))
  ) {
    return "Off / Native";
  }

  if (/fsr ?4/.test(normalizedValue) || /fsr4/.test(normalizedKey)) {
    return "FSR 4";
  }

  if (
    /fsr ?3/.test(normalizedValue) ||
    /ffx_fsr3upscaler/.test(normalizedValue) ||
    /fsr3/.test(normalizedKey)
  ) {
    return "FSR 3 Upscaling";
  }

  if (
    /fsr ?2/.test(normalizedValue) ||
    /ffx_fsr2/.test(normalizedValue) ||
    /fsr2/.test(normalizedKey)
  ) {
    return "FSR 2";
  }

  if (
    /dlss/.test(normalizedValue) ||
    (/dlss/.test(normalizedKey) && isTruthyConfigValue(normalizedValue))
  ) {
    return "DLSS Super Resolution";
  }

  if (
    /xess/.test(normalizedValue) ||
    (/xess/.test(normalizedKey) && isTruthyConfigValue(normalizedValue))
  ) {
    return "XeSS";
  }

  if (
    /tsr|temporal super resolution/.test(normalizedValue) ||
    (/temporalsuperresolution/.test(normalizedKey) &&
      isTruthyConfigValue(normalizedValue))
  ) {
    return "TSR";
  }

  return undefined;
}

function inferFrameGenerationFromKeyValue(
  key: string,
  value: string,
): string | undefined {
  const normalizedKey = normalizeConfigValue(key).toLowerCase();
  const normalizedValue = normalizeConfigValue(value).toLowerCase();
  const numericValue = parseConfigInteger(value);

  if (numericValue !== undefined) {
    const decoded = decodeEngineSpecificFrameGenerationEnum(
      normalizedKey,
      numericValue,
    );
    if (decoded?.value) {
      return decoded.value;
    }
  }

  if (
    !/(frame|interpolation|generation|dlssg|xessfg|streamline)/.test(
      normalizedKey,
    )
  ) {
    return undefined;
  }

  if (
    (/(frame|generation|interpolation)/.test(normalizedKey) ||
      /dlssg|xessfg/.test(normalizedKey)) &&
    (/(native|none)/.test(normalizedValue) ||
      isFalsyConfigValue(normalizedValue))
  ) {
    return "Off";
  }

  if (
    /dlss/.test(normalizedValue) ||
    /dlssg/.test(normalizedKey) ||
    /streamline/.test(normalizedKey)
  ) {
    return isTruthyConfigValue(normalizedValue) || /dlss/.test(normalizedValue)
      ? "DLSS Frame Generation"
      : undefined;
  }

  if (
    /fsr ?3/.test(normalizedValue) ||
    /frame interpolation/.test(normalizedValue) ||
    /fsr3fi|frameinterpolation/.test(normalizedKey)
  ) {
    return isTruthyConfigValue(normalizedValue) ||
      /fsr|interpolation/.test(normalizedValue)
      ? "FSR 3 Frame Generation"
      : undefined;
  }

  if (/xess/.test(normalizedValue) || /xessfg/.test(normalizedKey)) {
    return isTruthyConfigValue(normalizedValue) || /xess/.test(normalizedValue)
      ? "XeSS Frame Generation"
      : undefined;
  }

  return undefined;
}

function parseGraphicsConfigFile(filePath: string): ParsedGraphicsConfig {
  const buffer = safeReadBinaryFile(filePath);
  if (!buffer || buffer.length === 0) {
    return { evidence: [] };
  }

  const limited = buffer.subarray(0, CONFIG_MAX_BYTES);
  const content = `${limited.toString("utf8")}\n${limited.toString("utf16le")}`;
  const lines = content.split(/\r?\n/).slice(0, 3000);
  const evidence: string[] = [];
  let upscaler: string | undefined;
  let frameGeneration: string | undefined;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (
      !line ||
      line.startsWith(";") ||
      line.startsWith("#") ||
      line.startsWith("//")
    ) {
      continue;
    }

    const keyValueMatch = line.match(
      /^\s*["<\[]?([^:=><\]]+)["\]>]?\s*[:=]\s*(.+)$/,
    );
    if (!keyValueMatch) {
      continue;
    }

    const key = keyValueMatch[1] ?? "";
    const value = keyValueMatch[2] ?? "";

    if (!upscaler) {
      upscaler = inferUpscalerFromKeyValue(key, value);
      if (upscaler) {
        evidence.push(
          `${path.basename(filePath)}: ${normalizeConfigValue(key)}=${normalizeConfigValue(value)}`,
        );
      }
    }

    if (!frameGeneration) {
      frameGeneration = inferFrameGenerationFromKeyValue(key, value);
      if (frameGeneration) {
        evidence.push(
          `${path.basename(filePath)}: ${normalizeConfigValue(key)}=${normalizeConfigValue(value)}`,
        );
      }
    }

    if (upscaler && frameGeneration) {
      break;
    }
  }

  return {
    upscaler,
    frameGeneration,
    evidence,
  };
}

function detectConfiguredGraphics(
  installPath: string,
  executablePath: string,
  titleCandidates: string[],
): GraphicsTechnologyConfiguration | undefined {
  const configFiles = getConfigCandidateFiles(
    installPath,
    executablePath,
    titleCandidates,
  );
  if (configFiles.length === 0) {
    return undefined;
  }

  let upscaler: string | undefined;
  let frameGeneration: string | undefined;
  const evidence: string[] = [];
  const matchedFiles = new Set<string>();

  for (const filePath of configFiles) {
    const parsed = parseGraphicsConfigFile(filePath);
    if (!upscaler && parsed.upscaler) {
      upscaler = parsed.upscaler;
      matchedFiles.add(filePath);
    }

    if (!frameGeneration && parsed.frameGeneration) {
      frameGeneration = parsed.frameGeneration;
      matchedFiles.add(filePath);
    }

    if (parsed.evidence.length > 0) {
      evidence.push(...parsed.evidence);
    }

    if (upscaler && frameGeneration) {
      break;
    }
  }

  if (!upscaler && !frameGeneration) {
    return undefined;
  }

  return {
    upscaler,
    frameGeneration,
    evidence: evidence.slice(0, 6),
    configFiles: Array.from(matchedFiles)
      .map((filePath) => path.basename(filePath))
      .slice(0, 4),
  };
}

function isLikelyGameFolder(folderPath: string): boolean {
  if (
    INVALID_FOLDER_PATTERNS.some((pattern) =>
      pattern.test(path.basename(folderPath)),
    )
  ) {
    return false;
  }

  const entries = safeReadDir(folderPath);
  return entries.some(
    (entry) =>
      entry.isFile() &&
      entry.name.toLowerCase().endsWith(".exe") &&
      !INVALID_EXE_PATTERNS.some((pattern) => pattern.test(entry.name)),
  );
}

function isValidExecutableCandidate(
  executablePath: string,
  folderPath: string,
): boolean {
  const relativePath = path.relative(folderPath, executablePath);
  const fileName = path.basename(executablePath);

  if (INVALID_EXE_PATTERNS.some((pattern) => pattern.test(fileName))) {
    return false;
  }

  if (
    INVALID_EXECUTABLE_PATH_SEGMENTS.some((pattern) =>
      pattern.test(relativePath),
    )
  ) {
    return false;
  }

  return true;
}

function scoreExecutable(fileName: string, folderName: string): number {
  const lower = fileName.toLowerCase();
  let score = 0;

  if (lower === `${folderName.toLowerCase()}.exe`) score += 30;
  if (lower.includes(folderName.toLowerCase())) score += 20;
  if (lower.endsWith("shipping.exe")) score += 10;
  if (lower.endsWith("game.exe")) score += 10;
  if (lower.includes("win64")) score += 5;
  if (lower.includes("x64")) score += 5;
  if (INVALID_EXE_PATTERNS.some((pattern) => pattern.test(lower))) score -= 100;

  return score;
}

function walkForExecutables(
  folderPath: string,
  maxDepth: number,
  currentDepth = 0,
): string[] {
  if (currentDepth > maxDepth) return [];

  const found: string[] = [];
  for (const entry of safeReadDir(folderPath)) {
    const entryPath = path.join(folderPath, entry.name);
    if (entry.isFile() && entry.name.toLowerCase().endsWith(".exe")) {
      found.push(entryPath);
    }
    if (entry.isDirectory() && currentDepth < maxDepth) {
      found.push(...walkForExecutables(entryPath, maxDepth, currentDepth + 1));
    }
  }

  return found;
}

function findPrimaryExecutable(folderPath: string): string | null {
  const folderName = path.basename(folderPath);
  const immediateExecutables = safeReadDir(folderPath)
    .filter(
      (entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".exe"),
    )
    .map((entry) => entry.name)
    .sort(
      (a, b) => scoreExecutable(b, folderName) - scoreExecutable(a, folderName),
    );

  for (const choice of immediateExecutables) {
    const candidatePath = path.join(folderPath, choice);
    if (choice && isValidExecutableCandidate(candidatePath, folderPath)) {
      return candidatePath;
    }
  }

  const preferredFolders = [
    "Binaries",
    "bin",
    "game",
    "Game",
    "Win64",
    "WinGDK",
    "x64",
  ];

  for (const preferredFolder of preferredFolders) {
    const candidatePath = path.join(folderPath, preferredFolder);
    if (
      !fs.existsSync(candidatePath) ||
      !fs.statSync(candidatePath).isDirectory()
    ) {
      continue;
    }

    const nested = walkForExecutables(candidatePath, 2);
    if (nested.length > 0) {
      nested.sort(
        (a, b) =>
          scoreExecutable(path.basename(b), folderName) -
          scoreExecutable(path.basename(a), folderName),
      );
      const candidate = nested.find((entryPath) =>
        isValidExecutableCandidate(entryPath, folderPath),
      );
      if (candidate) {
        return candidate;
      }
    }
  }

  const recursive = walkForExecutables(folderPath, 2);
  if (recursive.length === 0) return null;

  recursive.sort(
    (a, b) =>
      scoreExecutable(path.basename(b), folderName) -
      scoreExecutable(path.basename(a), folderName),
  );

  return (
    recursive.find((entryPath) =>
      isValidExecutableCandidate(entryPath, folderPath),
    ) ?? null
  );
}

function determineRecommendation(executablePath: string): ProxyFilename {
  const lower = executablePath.toLowerCase();
  if (lower.includes("vulkan") || lower.includes("dxvk")) return "winmm.dll";
  if (
    lower.includes("xbox") ||
    lower.includes("wingdk") ||
    lower.includes("msstore")
  ) {
    return "version.dll";
  }
  if (lower.includes("editor") || lower.includes("benchmark")) {
    return "dbghelp.dll";
  }
  return "dxgi.dll";
}

function normalizePathSegment(value: string): string {
  return value.trim().toLowerCase();
}

function getMimeType(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".bmp":
      return "image/bmp";
    case ".ico":
      return "image/x-icon";
    default:
      return "application/octet-stream";
  }
}

function fileToDataUrl(filePath: string): string | undefined {
  try {
    const content = fs.readFileSync(filePath);
    return `data:${getMimeType(filePath)};base64,${content.toString("base64")}`;
  } catch {
    return undefined;
  }
}

function getRemoteArtCachePath(url: string): string {
  let extension = ".img";

  try {
    const pathname = new URL(url).pathname;
    const candidate = path.extname(pathname).toLowerCase();
    if (candidate) {
      extension = candidate;
    }
  } catch {
    const candidate = path.extname(url.split("?")[0] ?? "").toLowerCase();
    if (candidate) {
      extension = candidate;
    }
  }

  const hash = createHash("sha1").update(url).digest("hex");
  const cacheDir = path.join(app.getPath("userData"), REMOTE_ART_CACHE_FOLDER);
  fs.mkdirSync(cacheDir, { recursive: true });
  return path.join(cacheDir, `${hash}${extension}`);
}

async function downloadRemoteArt(url: string): Promise<string | undefined> {
  if (!/^https?:\/\//i.test(url)) {
    return undefined;
  }

  const cached = remoteArtCache.get(url);
  if (cached !== undefined) {
    return cached;
  }

  const cachePath = getRemoteArtCachePath(url);
  const existing = fileToDataUrl(cachePath);
  if (existing) {
    remoteArtCache.set(url, existing);
    return existing;
  }

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": REMOTE_ART_USER_AGENT,
      },
    });

    if (!response.ok) {
      remoteArtCache.set(url, undefined);
      return undefined;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length === 0) {
      remoteArtCache.set(url, undefined);
      return undefined;
    }

    try {
      fs.writeFileSync(cachePath, buffer);
    } catch {
      // Keep going even if the cache write fails.
    }

    const contentType =
      response.headers.get("content-type") || getMimeType(cachePath);
    const dataUrl = `data:${contentType};base64,${buffer.toString("base64")}`;
    remoteArtCache.set(url, dataUrl);
    return dataUrl;
  } catch {
    remoteArtCache.set(url, undefined);
    return undefined;
  }
}

function normalizeTitle(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function getBestTitleMatch<T>(
  titleCandidates: string[],
  entries: T[],
  getTitle: (entry: T) => string | undefined,
): T | undefined {
  const normalizedCandidates = titleCandidates
    .map((value) => ({ raw: value, normalized: normalizeTitle(value) }))
    .filter((value) => value.normalized.length > 0);

  let bestEntry: T | undefined;
  let bestScore = -1;

  for (const entry of entries) {
    const rawTitle = getTitle(entry);
    if (!rawTitle) {
      continue;
    }

    const normalizedTitle = normalizeTitle(rawTitle);
    if (!normalizedTitle) {
      continue;
    }

    for (const candidate of normalizedCandidates) {
      let score = 0;

      if (normalizedTitle === candidate.normalized) {
        score = 100;
      } else if (
        normalizedTitle.includes(candidate.normalized) ||
        candidate.normalized.includes(normalizedTitle)
      ) {
        score = 70;
      } else if (
        candidate.raw &&
        rawTitle.toLowerCase().includes(candidate.raw.toLowerCase())
      ) {
        score = 50;
      }

      if (score > bestScore) {
        bestEntry = entry;
        bestScore = score;
      }
    }
  }

  return bestScore >= 50 ? bestEntry : undefined;
}

function scoreImageFile(
  fileName: string,
  gameBaseNames: string[],
  sizeBytes: number,
): number {
  const lower = fileName.toLowerCase();
  let score = 0;

  if (lower.includes("library_600x900")) score += 80;
  if (lower.includes("library_2x") || lower.includes("librarycapsule2x"))
    score += 70;
  if (lower.includes("vertical_cover") || lower.includes("portrait_storefront"))
    score += 75;
  if (lower.includes("dieselgameboxtall")) score += 75;
  if (lower.includes("capsule")) score += 42;
  if (
    lower.includes("cover") ||
    lower.includes("poster") ||
    lower.includes("boxart")
  ) {
    score += 36;
  }
  if (lower.includes("hero") || lower.includes("banner")) score += 16;
  if (lower.includes("header")) score += 8;
  if (LOCAL_ART_KEYWORDS.some((keyword) => lower.includes(keyword)))
    score += 10;
  if (lower.includes("logo")) score -= 18;
  if (lower.includes("icon")) score -= 22;
  if (
    lower.includes("screenshot") ||
    lower.includes("thumb") ||
    (lower.includes("portrait") && !lower.includes("storefront"))
  ) {
    score -= 28;
  }
  if (lower.includes("avatar") || lower.includes("character")) score -= 18;
  if (sizeBytes < 12 * 1024) score -= 45;
  if (sizeBytes > 96 * 1024) score += 10;
  if (sizeBytes > 256 * 1024) score += 10;

  for (const name of gameBaseNames) {
    const normalized = name.toLowerCase();
    if (normalized && lower.includes(normalized)) score += 30;
  }

  return score;
}

function findQualifiedLocalArt(
  folderPath: string,
  gameBaseNames: string[],
): string | undefined {
  const imageCandidates = safeReadDir(folderPath)
    .filter((entry) => entry.isFile())
    .filter((entry) =>
      IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()),
    )
    .map((entry) => {
      const fullPath = path.join(folderPath, entry.name);
      let sizeBytes = 0;

      try {
        sizeBytes = fs.statSync(fullPath).size;
      } catch {
        sizeBytes = 0;
      }

      return {
        fileName: entry.name,
        fullPath,
        score: scoreImageFile(entry.name, gameBaseNames, sizeBytes),
      };
    })
    .filter((entry) => entry.score >= 45)
    .sort((left, right) => right.score - left.score);

  return imageCandidates[0]?.fullPath;
}

function findQualifiedLocalArtRecursive(
  folderPath: string,
  gameBaseNames: string[],
  maxDepth: number,
): string | undefined {
  const imageCandidates = walkForFiles(
    folderPath,
    (entryPath, entry) =>
      entry.isFile() &&
      IMAGE_EXTENSIONS.has(path.extname(entryPath).toLowerCase()),
    maxDepth,
  )
    .map((entryPath) => {
      let sizeBytes = 0;

      try {
        sizeBytes = fs.statSync(entryPath).size;
      } catch {
        sizeBytes = 0;
      }

      return {
        entryPath,
        score: scoreImageFile(
          path.basename(entryPath),
          gameBaseNames,
          sizeBytes,
        ),
      };
    })
    .filter((entry) => entry.score >= 45)
    .sort((left, right) => right.score - left.score);

  return imageCandidates[0]?.entryPath;
}

function getSteamAppId(
  commonRoot: string,
  installPath: string,
): string | undefined {
  const commonKey = commonRoot.toLowerCase();
  let manifestMap = steamManifestCache.get(commonKey);

  if (!manifestMap) {
    manifestMap = new Map<string, string>();
    const steamAppsPath = path.dirname(commonRoot);

    for (const entry of safeReadDir(steamAppsPath)) {
      if (!entry.isFile() || !/^appmanifest_.*\.acf$/i.test(entry.name)) {
        continue;
      }

      try {
        const manifest = fs.readFileSync(
          path.join(steamAppsPath, entry.name),
          "utf8",
        );
        const appId = manifest.match(/"appid"\s+"([^"]+)"/i)?.[1]?.trim();
        const installDir = manifest
          .match(/"installdir"\s+"([^"]+)"/i)?.[1]
          ?.trim();

        if (appId && installDir) {
          manifestMap.set(normalizePathSegment(installDir), appId);
        }
      } catch {
        continue;
      }
    }

    steamManifestCache.set(commonKey, manifestMap);
  }

  return manifestMap.get(normalizePathSegment(path.basename(installPath)));
}

function isSteamInstallRegistered(
  commonRoot: string,
  installPath: string,
): boolean {
  return Boolean(getSteamAppId(commonRoot, installPath));
}

function getSteamLibraryCacheImage(
  commonRoot: string,
  installPath: string,
): string | undefined {
  const appId = getSteamAppId(commonRoot, installPath);
  if (!appId) return undefined;

  const steamRoot = path.dirname(path.dirname(commonRoot));
  const libraryCachePath = path.join(steamRoot, "appcache", "librarycache");
  const imageCandidates = safeReadDir(libraryCachePath)
    .filter((entry) => entry.isFile() && entry.name.startsWith(`${appId}_`))
    .map((entry) => entry.name)
    .filter((fileName) =>
      IMAGE_EXTENSIONS.has(path.extname(fileName).toLowerCase()),
    )
    .sort(
      (left, right) =>
        scoreImageFile(right, [appId], 0) - scoreImageFile(left, [appId], 0),
    );

  const best = imageCandidates[0];
  return best ? path.join(libraryCachePath, best) : undefined;
}

function getSteamRemoteImageUrl(
  commonRoot: string,
  installPath: string,
): string | undefined {
  const appId = getSteamAppId(commonRoot, installPath);
  if (!appId) {
    return undefined;
  }

  return `https://steamcdn-a.akamaihd.net/steam/apps/${appId}/library_600x900_2x.jpg`;
}

function getEpicMetadataRoots(): string[] {
  const basePath = path.join(
    process.env.PROGRAMDATA ?? "C:\\ProgramData",
    "Epic",
    "EpicGamesLauncher",
    "Data",
  );

  return [
    path.join(basePath, "Manifests"),
    path.join(basePath, "Pending"),
  ].filter(
    (folderPath) =>
      fs.existsSync(folderPath) && fs.statSync(folderPath).isDirectory(),
  );
}

function parseEpicManifestRecord(
  filePath: string,
): EpicManifestRecord | undefined {
  const content = safeReadTextFile(filePath);
  if (!content) {
    return undefined;
  }

  try {
    const payload = JSON.parse(content) as Record<string, unknown>;
    return {
      installLocation:
        typeof payload.InstallLocation === "string"
          ? payload.InstallLocation
          : undefined,
      catalogItemId:
        typeof payload.CatalogItemId === "string"
          ? payload.CatalogItemId
          : undefined,
      appName:
        typeof payload.AppName === "string" ? payload.AppName : undefined,
      displayName:
        typeof payload.DisplayName === "string"
          ? payload.DisplayName
          : undefined,
    };
  } catch {
    return undefined;
  }
}

function getEpicManifestRecord(
  installPath: string,
  titleCandidates: string[],
): EpicManifestRecord | undefined {
  const records: EpicManifestRecord[] = [];

  for (const root of getEpicMetadataRoots()) {
    const manifestFiles = walkForFiles(
      root,
      (entryPath, entry) =>
        entry.isFile() &&
        [".item", ".mancpn", ".json"].includes(
          path.extname(entryPath).toLowerCase(),
        ),
      2,
    );

    for (const manifestFile of manifestFiles) {
      const record = parseEpicManifestRecord(manifestFile);
      if (!record) {
        continue;
      }

      if (
        record.installLocation &&
        normalizePathSegment(record.installLocation) ===
          normalizePathSegment(installPath)
      ) {
        return record;
      }

      records.push(record);
    }
  }

  return getBestTitleMatch(
    titleCandidates,
    records,
    (entry) => entry.displayName,
  );
}

function hasEpicInstallRecord(installPath: string): boolean {
  for (const root of getEpicMetadataRoots()) {
    const manifestFiles = walkForFiles(
      root,
      (entryPath, entry) =>
        entry.isFile() &&
        [".item", ".mancpn", ".json"].includes(
          path.extname(entryPath).toLowerCase(),
        ),
      2,
    );

    for (const manifestFile of manifestFiles) {
      const record = parseEpicManifestRecord(manifestFile);
      if (!record?.installLocation) {
        continue;
      }

      if (
        normalizePathSegment(record.installLocation) ===
        normalizePathSegment(installPath)
      ) {
        return true;
      }
    }
  }

  return false;
}

function isRegisteredInstall(
  group: { source: GameSource; roots: string[] },
  root: string,
  installPath: string,
): boolean {
  if (group.source === "Steam") {
    return isSteamInstallRegistered(root, installPath);
  }

  if (group.source === "Epic") {
    return hasEpicInstallRecord(installPath);
  }

  return true;
}

function getEpicCatalogText(): string {
  const catalogPath = path.join(
    process.env.PROGRAMDATA ?? "C:\\ProgramData",
    "Epic",
    "EpicGamesLauncher",
    "Data",
    "Catalog",
    "catcache.bin",
  );

  const cached = epicCatalogTextCache.get(catalogPath);
  if (cached !== undefined) {
    return cached;
  }

  const buffer = safeReadBinaryFile(catalogPath);
  if (!buffer) {
    epicCatalogTextCache.set(catalogPath, "");
    return "";
  }

  const text = `${buffer.toString("utf8")}\n${buffer.toString("utf16le")}`;
  epicCatalogTextCache.set(catalogPath, text);
  return text;
}

function extractBestEpicImageUrlFromText(
  searchWindow: string,
): string | undefined {
  const matches = searchWindow.match(EPIC_IMAGE_URL_REGEX) ?? [];
  const ranked = matches
    .map((url) => ({ url, score: scoreImageFile(url, [], 128 * 1024) }))
    .sort((left, right) => right.score - left.score);

  return ranked[0]?.url;
}

function getEpicRemoteImageUrl(
  installPath: string,
  titleCandidates: string[],
): string | undefined {
  const cacheKey = `${installPath.toLowerCase()}|${titleCandidates.join("|").toLowerCase()}`;
  if (epicRemoteUrlCache.has(cacheKey)) {
    return epicRemoteUrlCache.get(cacheKey);
  }

  const manifestRecord = getEpicManifestRecord(installPath, titleCandidates);
  const catalogText = getEpicCatalogText();
  const needles = [
    manifestRecord?.catalogItemId,
    manifestRecord?.appName,
    manifestRecord?.displayName,
    ...titleCandidates,
  ].filter((value): value is string => Boolean(value));

  for (const needle of needles) {
    const index = catalogText.toLowerCase().indexOf(needle.toLowerCase());
    if (index === -1) {
      continue;
    }

    const start = Math.max(0, index - 12000);
    const end = Math.min(catalogText.length, index + 12000);
    const bestUrl = extractBestEpicImageUrlFromText(
      catalogText.slice(start, end),
    );
    if (bestUrl) {
      epicRemoteUrlCache.set(cacheKey, bestUrl);
      return bestUrl;
    }
  }

  epicRemoteUrlCache.set(cacheKey, undefined);
  return undefined;
}

function getUbisoftConfigurationPath(): string | undefined {
  const localPath = path.join(
    process.env.LOCALAPPDATA ?? "",
    "Ubisoft Game Launcher",
    "cache",
    "configuration",
    "configurations",
  );
  if (localPath && fs.existsSync(localPath)) {
    return localPath;
  }

  const installPath = path.join(
    process.env.PROGRAMFILES_X86 ?? "C:\\Program Files (x86)",
    "Ubisoft",
    "Ubisoft Game Launcher",
    "cache",
    "configuration",
    "configurations",
  );

  return fs.existsSync(installPath) ? installPath : undefined;
}

function parseUbisoftArtRecords(): UbisoftArtRecord[] {
  const configPath = getUbisoftConfigurationPath();
  if (!configPath) {
    return [];
  }

  const content = safeReadBinaryFile(configPath)?.toString("utf8") ?? "";
  if (!content) {
    return [];
  }

  const records: UbisoftArtRecord[] = [];
  let pendingThumb: string | undefined;
  let pendingLogo: string | undefined;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith("thumb_image:")) {
      const value = line.slice("thumb_image:".length).trim();
      pendingThumb = /^[a-f0-9]{32}\.(jpg|png)$/i.test(value)
        ? value
        : undefined;
      continue;
    }

    if (line.startsWith("logo_image:")) {
      const value = line.slice("logo_image:".length).trim();
      pendingLogo = /^[a-f0-9]{32}\.(jpg|png)$/i.test(value)
        ? value
        : undefined;
      continue;
    }

    if (line.startsWith("game_identifier:")) {
      const title = line.slice("game_identifier:".length).trim();
      if (title) {
        records.push({
          title,
          thumbImage: pendingThumb,
          logoImage: pendingLogo,
        });
      }

      pendingThumb = undefined;
      pendingLogo = undefined;
    }
  }

  return records;
}

function getUbisoftRemoteImageUrl(
  titleCandidates: string[],
): string | undefined {
  const cacheKey = titleCandidates.join("|").toLowerCase();
  if (ubisoftRemoteUrlCache.has(cacheKey)) {
    return ubisoftRemoteUrlCache.get(cacheKey);
  }

  const bestMatch = getBestTitleMatch(
    titleCandidates,
    parseUbisoftArtRecords(),
    (entry) => entry.title,
  );

  const assetName = bestMatch?.thumbImage ?? bestMatch?.logoImage;
  const url = assetName
    ? `https://ubistatic3-a.akamaihd.net/orbit/uplay_launcher_3_0/assets/${assetName}`
    : undefined;

  ubisoftRemoteUrlCache.set(cacheKey, url);
  return url;
}

function findXboxManifestArt(installPath: string): string | undefined {
  const metadataFiles = [
    path.join(installPath, "Content", "MicrosoftGame.config"),
    path.join(installPath, "appxmanifest.xml"),
  ];
  const attributes = [
    "SplashScreenImage",
    "Square480x480Logo",
    "Square150x150Logo",
    "StoreLogo",
    "Square44x44Logo",
    "OverrideSplashScreenImage",
    "OverrideLogo",
    "OverrideSquare44x44Logo",
    "Logo",
    "Image",
  ];

  for (const metadataFile of metadataFiles) {
    const config = safeReadTextFile(metadataFile);
    if (!config) {
      continue;
    }

    for (const attribute of attributes) {
      const relativePath = config.match(
        new RegExp(`${attribute}="([^"]+)"`, "i"),
      )?.[1];
      if (!relativePath) {
        continue;
      }

      const candidates = [
        path.join(installPath, "Content", relativePath),
        path.join(installPath, relativePath),
      ];

      for (const candidate of candidates) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          return candidate;
        }
      }
    }
  }

  return undefined;
}

async function getGogRemoteImageUrl(
  titleCandidates: string[],
): Promise<string | undefined> {
  const cacheKey = titleCandidates.join("|").toLowerCase();
  if (gogCatalogCache.has(cacheKey)) {
    return gogCatalogCache.get(cacheKey);
  }

  const primaryTitle = titleCandidates[0];
  if (!primaryTitle) {
    gogCatalogCache.set(cacheKey, undefined);
    return undefined;
  }

  try {
    const query = encodeURIComponent(primaryTitle);
    const response = await fetch(
      `https://catalog.gog.com/v1/catalog?limit=10&productType=in:game&query=like:${query}`,
      {
        headers: {
          "User-Agent": REMOTE_ART_USER_AGENT,
        },
      },
    );

    if (!response.ok) {
      gogCatalogCache.set(cacheKey, undefined);
      return undefined;
    }

    const payload = (await response.json()) as {
      products?: Array<{
        title?: string;
        coverVertical?: string;
      }>;
    };

    const candidateTitles = new Set(titleCandidates.map(normalizeTitle));
    const bestMatch = payload.products?.find((product) => {
      const normalized = normalizeTitle(product.title ?? "");
      return normalized.length > 0 && candidateTitles.has(normalized);
    });

    const url =
      bestMatch?.coverVertical ??
      payload.products?.find((product) => Boolean(product.coverVertical))
        ?.coverVertical;

    gogCatalogCache.set(cacheKey, url);
    return url;
  } catch {
    gogCatalogCache.set(cacheKey, undefined);
    return undefined;
  }
}

function findLocalGameArt(
  installPath: string,
  executablePath: string,
): string | undefined {
  const gameBaseNames = [
    path.basename(installPath),
    path.basename(executablePath, path.extname(executablePath)),
  ];

  const searchFolders = [
    path.dirname(executablePath),
    installPath,
    path.join(installPath, ".egstore"),
  ];

  for (const folder of searchFolders) {
    if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) continue;
    const best = findQualifiedLocalArt(folder, gameBaseNames);
    if (best) return best;

    if (path.basename(folder).toLowerCase() === ".egstore") {
      const nested = findQualifiedLocalArtRecursive(folder, gameBaseNames, 2);
      if (nested) return nested;
    }
  }

  return undefined;
}

function getTitleCandidates(
  installPath: string,
  executablePath: string,
): string[] {
  return Array.from(
    new Set([
      path.basename(installPath),
      path.basename(executablePath, path.extname(executablePath)),
      path.basename(path.dirname(executablePath)),
    ]),
  ).filter(Boolean);
}

async function getIconDataUrl(targetPath: string): Promise<string | undefined> {
  try {
    const icon = await app.getFileIcon(targetPath, { size: "large" });
    const dataUrl = icon.toDataURL();
    return dataUrl.length > 0 ? dataUrl : undefined;
  } catch {
    return undefined;
  }
}

async function resolveGameArtDataUrl(
  group: { source: GameSource; roots: string[] },
  root: string,
  installPath: string,
  executablePath: string,
): Promise<string | undefined> {
  const steamArtPath =
    group.source === "Steam"
      ? getSteamLibraryCacheImage(root, installPath)
      : undefined;
  if (steamArtPath) {
    const dataUrl = fileToDataUrl(steamArtPath);
    if (dataUrl) return dataUrl;
  }

  if (group.source === "Steam") {
    const steamRemoteUrl = getSteamRemoteImageUrl(root, installPath);
    if (steamRemoteUrl) {
      const dataUrl = await downloadRemoteArt(steamRemoteUrl);
      if (dataUrl) return dataUrl;
    }
  }

  if (group.source === "Xbox") {
    const xboxArtPath = findXboxManifestArt(installPath);
    if (xboxArtPath) {
      const dataUrl = fileToDataUrl(xboxArtPath);
      if (dataUrl) return dataUrl;
    }
  }

  if (group.source === "GOG") {
    const gogRemoteUrl = await getGogRemoteImageUrl(
      getTitleCandidates(installPath, executablePath),
    );
    if (gogRemoteUrl) {
      const dataUrl = await downloadRemoteArt(gogRemoteUrl);
      if (dataUrl) return dataUrl;
    }
  }

  if (group.source === "Epic") {
    const epicRemoteUrl = getEpicRemoteImageUrl(
      installPath,
      getTitleCandidates(installPath, executablePath),
    );
    if (epicRemoteUrl) {
      const dataUrl = await downloadRemoteArt(epicRemoteUrl);
      if (dataUrl) return dataUrl;
    }
  }

  if (group.source === "Ubisoft") {
    const ubisoftRemoteUrl = getUbisoftRemoteImageUrl(
      getTitleCandidates(installPath, executablePath),
    );
    if (ubisoftRemoteUrl) {
      const dataUrl = await downloadRemoteArt(ubisoftRemoteUrl);
      if (dataUrl) return dataUrl;
    }
  }

  const localArtPath = findLocalGameArt(installPath, executablePath);
  if (localArtPath) {
    const dataUrl = fileToDataUrl(localArtPath);
    if (dataUrl) return dataUrl;
  }

  return (
    (await getIconDataUrl(executablePath)) ??
    (await getIconDataUrl(installPath))
  );
}

export async function discoverGames(): Promise<DiscoveredGame[]> {
  const discovered = new Map<string, DiscoveredGame>();
  const compatibilityCache = new Map<
    string,
    Awaited<ReturnType<typeof getWikiCompatibilityAdvice>>
  >();

  for (const group of ROOT_CANDIDATES) {
    for (const root of group.roots) {
      if (!root || !fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
        continue;
      }

      const entries = safeReadDir(root);
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const installPath = path.join(root, entry.name);
        if (!isLikelyGameFolder(installPath)) continue;
        if (!isRegisteredInstall(group, root, installPath)) continue;

        const executablePath = findPrimaryExecutable(installPath);
        if (!executablePath) continue;

        const title = path.basename(installPath);
        const id = `${installPath.toLowerCase()}|${executablePath.toLowerCase()}`;
        const titleCandidates = getTitleCandidates(installPath, executablePath);
        const compatibilityKey = titleCandidates.join("|").toLowerCase();

        let compatibility = compatibilityCache.get(compatibilityKey);
        if (compatibility === undefined) {
          compatibility = await getWikiCompatibilityAdvice(titleCandidates);
          compatibilityCache.set(compatibilityKey, compatibility);
        }

        const recommendation =
          compatibility?.recommendedProxy ??
          determineRecommendation(executablePath);
        const confidence = recommendation === "dxgi.dll" ? 0.78 : 0.72;
        const notes: string[] = [`Detected from ${group.source}`];

        if (compatibility?.notes) {
          notes.push(compatibility.notes);
        }

        const iconDataUrl = await resolveGameArtDataUrl(
          group,
          root,
          installPath,
          executablePath,
        );
        const activeGraphics = detectConfiguredGraphics(
          installPath,
          executablePath,
          titleCandidates,
        );
        const detectedGraphics = detectGraphicsTechnology(
          installPath,
          executablePath,
        );

        discovered.set(id, {
          id,
          title,
          source: group.source,
          installPath,
          executablePath,
          recommendation,
          confidence,
          notes,
          iconDataUrl,
          activeGraphics,
          detectedGraphics,
          compatibility: compatibility
            ? {
                ...compatibility,
                suggestedSpoofing: compatibility.suggestedSpoofing,
                suggestedOptiPatcher: compatibility.suggestedOptiPatcher,
              }
            : {
                source: "heuristic",
                recommendedProxy: recommendation,
                suggestedSpoofing: recommendation === "dxgi.dll",
              },
        });
      }
    }
  }

  return Array.from(discovered.values()).sort((left, right) =>
    left.title.localeCompare(right.title),
  );
}
