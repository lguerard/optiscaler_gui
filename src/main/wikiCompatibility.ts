import type {
  CompatibilityRecommendation,
  ProxyFilename,
} from "../shared/types";

type WikiEntry = {
  title: string;
  slug: string;
};

type WikiPage = {
  fields: Map<string, string>;
};

const WIKI_BASE =
  "https://raw.githubusercontent.com/wiki/optiscaler/OptiScaler";
const COMPATIBILITY_LIST_URL = `${WIKI_BASE}/Compatibility-List.md`;

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

const wikiIndexPromise = createWikiIndexPromise();
const wikiPageCache = new Map<
  string,
  Promise<CompatibilityRecommendation | null>
>();

const ROMAN_NUMERAL_MAP: Record<string, string> = {
  i: "1",
  ii: "2",
  iii: "3",
  iv: "4",
  v: "5",
  vi: "6",
  vii: "7",
  viii: "8",
  ix: "9",
  x: "10",
  xi: "11",
  xii: "12",
  xiii: "13",
  xiv: "14",
  xv: "15",
  xvi: "16",
};

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function splitWords(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/([a-z])(\d)/g, "$1 $2")
    .replace(/(\d)([a-z])/g, "$1 $2")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function toSignature(value: string): string {
  const tokens = splitWords(value);
  if (tokens.length === 0) return "";

  if (tokens.length === 1 && tokens[0]!.length <= 6) {
    return tokens[0]!;
  }

  return tokens
    .map((token) => {
      if (ROMAN_NUMERAL_MAP[token]) return ROMAN_NUMERAL_MAP[token];
      if (/^\d+$/.test(token)) return token;
      if (token.length <= 2) return token;
      if (/\d/.test(token)) return token;
      return token[0] ?? "";
    })
    .join("");
}

function scoreCandidate(query: string, candidate: string): number {
  const normalizedQuery = normalizeText(query);
  const normalizedCandidate = normalizeText(candidate);
  const querySignature = toSignature(query);
  const candidateSignature = toSignature(candidate);

  if (!normalizedQuery || !normalizedCandidate) return 0;
  if (normalizedQuery === normalizedCandidate) return 1;
  if (querySignature && querySignature === candidateSignature) return 0.98;
  if (
    normalizedCandidate.includes(normalizedQuery) ||
    normalizedQuery.includes(normalizedCandidate)
  ) {
    return 0.9;
  }
  if (
    querySignature &&
    candidateSignature &&
    (candidateSignature.includes(querySignature) ||
      querySignature.includes(candidateSignature))
  ) {
    return 0.87;
  }

  const queryWords = splitWords(query);
  const candidateWords = splitWords(candidate);
  if (queryWords.length === 0 || candidateWords.length === 0) return 0;

  const shared = queryWords.filter((word) =>
    candidateWords.includes(word),
  ).length;
  const coverage = shared / Math.max(queryWords.length, candidateWords.length);

  return coverage;
}

async function createWikiIndexPromise(): Promise<WikiEntry[]> {
  const response = await fetch(COMPATIBILITY_LIST_URL);
  if (!response.ok) {
    throw new Error(
      `Failed to load OptiScaler compatibility list: ${response.status} ${response.statusText}`,
    );
  }

  const markdown = await response.text();
  const entries = new Map<string, WikiEntry>();

  const linkPattern = /\[([^\]]+)\]\(([^)]+)\)/g;
  for (const match of markdown.matchAll(linkPattern)) {
    const title = match[1]?.trim();
    const slug = match[2]?.trim();
    if (!title || !slug) continue;
    if (/^https?:\/\//i.test(slug)) continue;
    if (slug === "Home" || slug === "Installation" || slug === "Known-Issues")
      continue;
    if (slug === "Compatibility-List" || slug === "Frame-Generation-Options")
      continue;
    if (
      slug === "Unreal-Engine-Tweaks" ||
      slug === "OptiFG" ||
      slug === "Hudfix-incompatible"
    )
      continue;
    if (slug === "FSR4-Compatibility-List" || slug === "CL-Template") continue;

    const key = normalizeText(title);
    if (!entries.has(key)) {
      entries.set(key, { title, slug });
    }
  }

  return Array.from(entries.values());
}

async function loadWikiIndex(): Promise<WikiEntry[]> {
  try {
    return await wikiIndexPromise;
  } catch {
    return [];
  }
}

function pickBestMatch(title: string, entries: WikiEntry[]): WikiEntry | null {
  let bestMatch: WikiEntry | null = null;
  let bestScore = 0;

  for (const entry of entries) {
    const score = scoreCandidate(title, entry.title);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = entry;
    }
  }

  return bestScore >= 0.6 ? bestMatch : null;
}

async function fetchWikiPageMarkdown(slug: string): Promise<string> {
  const response = await fetch(`${WIKI_BASE}/${encodeURI(slug)}.md`);
  if (!response.ok) {
    throw new Error(
      `Failed to load wiki page for ${slug}: ${response.status} ${response.statusText}`,
    );
  }

  return response.text();
}

function parseWikiTable(markdown: string): WikiPage {
  const fields = new Map<string, string>();
  const tableLines = markdown
    .split(/\r?\n/)
    .filter((line) => line.trim().startsWith("|"));

  for (const line of tableLines) {
    const cells = line
      .split("|")
      .map((cell) => cell.trim())
      .filter(Boolean);

    if (cells.length < 2) continue;
    const [key, ...rest] = cells;
    if (!key || /^-+$/.test(key)) continue;
    const value = rest.join(" | ").trim();
    if (value === "---" || value === "-") continue;
    if (!fields.has(key)) fields.set(key, value);
  }

  return { fields };
}

function normalizeFieldKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function getFieldValue(
  fields: Map<string, string>,
  aliases: string[],
): string | undefined {
  for (const alias of aliases) {
    const direct = fields.get(alias);
    if (direct) {
      return direct;
    }
  }

  const normalizedAliases = new Set(
    aliases.map((alias) => normalizeFieldKey(alias)),
  );
  for (const [key, value] of fields) {
    if (normalizedAliases.has(normalizeFieldKey(key))) {
      return value;
    }
  }

  return undefined;
}

function combineFieldValues(
  fields: Map<string, string>,
  aliases: string[],
): string | undefined {
  const values = aliases
    .map((alias) => getFieldValue(fields, [alias]))
    .filter((value): value is string => Boolean(value && value !== "-"));

  if (values.length === 0) {
    return undefined;
  }

  return Array.from(new Set(values)).join(" | ");
}

function parseList(value: string | undefined): string[] {
  if (!value || value === "-") return [];
  return value
    .split(/[\n,;|]|(?:^|\s)[*-]\s+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function inferUpscalerInputs(...values: Array<string | undefined>): string[] {
  const combined = values.filter(Boolean).join(" ");
  if (!combined) {
    return [];
  }

  const inferred: string[] = [];
  const matches: Array<[RegExp, string]> = [
    [/\bdlss\b/i, "DLSS"],
    [/\bfsr\s*4\b/i, "FSR4"],
    [/\bfsr\s*3(?:\.1|\.0)?\b/i, "FSR3"],
    [/\bfsr\s*2\b/i, "FSR2"],
    [/\bxess\b/i, "XeSS"],
    [/(?:\btsr\b|temporal super resolution)/i, "TSR"],
  ];

  for (const [pattern, label] of matches) {
    if (pattern.test(combined)) {
      inferred.push(label);
    }
  }

  return inferred;
}

function inferFgInputs(...values: Array<string | undefined>): string[] {
  const combined = values.filter(Boolean).join(" ");
  if (!combined) {
    return [];
  }

  const inferred: string[] = [];
  const matches: Array<[RegExp, string]> = [
    [
      /(?:\bdlssg\b.*\bstreamline\b|\bstreamline\b.*\bdlssg\b)/i,
      "DLSSG via Streamline",
    ],
    [
      /(?:\bnukem'?s?\b.*\bdlssg\b|\bdlssg\b.*\bnukem'?s?\b|\bnukems\b)/i,
      "Nukem's DLSSG",
    ],
    [
      /(?:\bfsr\s*3(?:\.1|\.0)?\s*(?:fg|frame generation)\b|\bfsr\s*fg\b)/i,
      "FSR 3 Frame Generation",
    ],
    [/(?:\boptifg\b|hudfix)/i, "OptiFG"],
    [/(?:\bxefg\b|\bxemfg\b|\bxess frame generation\b)/i, "XeFG"],
  ];

  for (const [pattern, label] of matches) {
    if (pattern.test(combined)) {
      inferred.push(label);
    }
  }

  return inferred;
}

function pickProxyFilename(
  value: string | undefined,
): ProxyFilename | undefined {
  if (!value) return undefined;
  const lower = value.toLowerCase();
  return PROXY_CHOICES.find((choice) => lower.includes(choice.toLowerCase()));
}

function inferSpoofing(fields: Map<string, string>): boolean | undefined {
  const combined = [
    fields.get("Settings"),
    fields.get("Known Issues"),
    fields.get("Notes"),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (!combined) return undefined;
  if (
    /(dxgi=false|disable dxgi spoof|spoofing disabled|no spoof needed|avoid it by)/i.test(
      combined,
    )
  ) {
    return false;
  }

  if (
    /(requires spoofing|enables spoofing|dlss inputs are required|spoof enough to unlock|dlss inputs required|required for dlss fg)/i.test(
      combined,
    )
  ) {
    return true;
  }

  return undefined;
}

function inferOptiPatcher(fields: Map<string, string>): boolean | undefined {
  const combined = [fields.get("Known Issues"), fields.get("Notes")]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (!combined) return undefined;

  if (combined.includes("optipatcher")) return true;
  if (combined.includes("no spoof needed") || combined.includes("dxgi=false"))
    return true;
  return undefined;
}

function buildRecommendation(
  pageTitle: string,
  slug: string,
  markdown: string,
): CompatibilityRecommendation {
  const page = parseWikiTable(markdown);
  const fields = page.fields;

  const recommendedProxy = pickProxyFilename(
    getFieldValue(fields, ["Filename", "Executable", "Exe"]),
  );
  const settings = combineFieldValues(fields, [
    "Settings",
    "FG-Settings",
    "FG Settings",
  ]);
  const knownIssues = getFieldValue(fields, ["Known Issues", "Known Issue"]);
  const notes = getFieldValue(fields, ["Notes", "Note"]);
  const explicitUpscalerInputs = parseList(
    getFieldValue(fields, [
      "Upscaler Inputs",
      "Upscaler Input",
      "Upscaler Options",
      "Upscalers",
    ]),
  );
  const explicitFgInputs = parseList(
    getFieldValue(fields, [
      "FG Inputs",
      "FG Input",
      "Frame Generation Inputs",
      "Frame Generation Input",
    ]),
  );
  const upscalerInputs =
    explicitUpscalerInputs.length > 0
      ? explicitUpscalerInputs
      : inferUpscalerInputs(settings, knownIssues, notes);
  const fgInputs =
    explicitFgInputs.length > 0
      ? explicitFgInputs
      : inferFgInputs(settings, knownIssues, notes);

  return {
    source: "wiki",
    wikiPageTitle: pageTitle,
    wikiPageUrl: `https://github.com/optiscaler/OptiScaler/wiki/${slug}`,
    recommendedProxy,
    suggestedSpoofing: inferSpoofing(fields),
    suggestedOptiPatcher: inferOptiPatcher(fields),
    upscalerInputs: upscalerInputs.length > 0 ? upscalerInputs : undefined,
    fgInputs: fgInputs.length > 0 ? fgInputs : undefined,
    settings,
    knownIssues: knownIssues && knownIssues !== "-" ? knownIssues : undefined,
    notes: notes && notes !== "-" ? notes : undefined,
  };
}

export async function getWikiCompatibilityAdvice(
  titleCandidates: string[],
): Promise<CompatibilityRecommendation | null> {
  const index = await loadWikiIndex();
  if (index.length === 0) return null;

  let bestMatch: WikiEntry | null = null;
  let bestScore = 0;
  for (const candidate of titleCandidates) {
    const match = pickBestMatch(candidate, index);
    if (!match) continue;

    const score = Math.max(
      ...index.map((entry) => scoreCandidate(candidate, entry.title)),
    );
    if (score > bestScore) {
      bestScore = score;
      bestMatch = match;
    }
  }

  if (!bestMatch) return null;

  const cacheKey = bestMatch.slug.toLowerCase();
  let pagePromise = wikiPageCache.get(cacheKey);
  if (!pagePromise) {
    pagePromise = fetchWikiPageMarkdown(bestMatch.slug)
      .then((markdown) =>
        buildRecommendation(bestMatch!.title, bestMatch!.slug, markdown),
      )
      .catch(() => null);
    wikiPageCache.set(cacheKey, pagePromise);
  }

  return pagePromise;
}
