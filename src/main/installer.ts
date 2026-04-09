import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import extract from "extract-zip";
import sevenZipBinaryPath from "7zip-bin";
import type {
  InstallOptions,
  InstallProgress,
  InstallResult,
  ProxyFilename,
} from "../shared/types";

const OPTISCALER_RELEASE =
  "https://api.github.com/repos/optiscaler/OptiScaler/releases/latest";
const OPTIPATCHER_ASSET =
  "https://github.com/optiscaler/OptiPatcher/releases/download/rolling/OptiPatcher.asi";
const BACKUP_FOLDER = ".optiscaler-backup";
const ORIGINAL_STATE_FOLDER = "original-state";
const execFileAsync = promisify(execFile);

interface BackupManifest {
  installedAt: string;
  gamePath: string;
  proxyFilename: ProxyFilename;
  backupRoot: string;
  sourceRoot: string;
  releaseName: string;
  notes: string[];
  backedUpEntries: string[];
  createdEntries: string[];
  preserveOriginalState?: boolean;
}

export interface PayloadLocation {
  root: string;
  dllPath: string;
  releaseName: string;
}

export interface InstallerProgressSink {
  report: (progress: InstallProgress) => void;
}

let preparedPayloadPromise: Promise<PayloadLocation> | null = null;

async function ensureDirectory(directoryPath: string): Promise<void> {
  await fs.promises.mkdir(directoryPath, { recursive: true });
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.promises.access(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function downloadFile(
  url: string,
  destinationPath: string,
): Promise<void> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "OptiScaler-GUI",
      Accept: "application/octet-stream",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to download ${url}: ${response.status} ${response.statusText}`,
    );
  }

  await ensureDirectory(path.dirname(destinationPath));
  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.promises.writeFile(destinationPath, buffer);
}

async function downloadLatestReleaseArchive(): Promise<{
  archivePath: string;
  releaseName: string;
}> {
  const response = await fetch(OPTISCALER_RELEASE, {
    headers: {
      "User-Agent": "OptiScaler-GUI",
      Accept: "application/vnd.github+json",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to read latest OptiScaler release: ${response.status} ${response.statusText}`,
    );
  }

  const release = (await response.json()) as {
    tag_name: string;
    name: string;
    assets: Array<{ browser_download_url: string; name: string }>;
  };

  const asset =
    release.assets.find((item) => /\.zip$/i.test(item.name)) ??
    release.assets.find((item) => /\.7z$/i.test(item.name)) ??
    release.assets[0];
  if (!asset) {
    throw new Error("No downloadable release asset was found for OptiScaler.");
  }

  if (!/\.(zip|7z)$/i.test(asset.name)) {
    throw new Error(
      `Unsupported OptiScaler release asset format: ${asset.name}. Expected a .zip or .7z archive.`,
    );
  }

  const cacheDir = path.join(os.tmpdir(), "optiscaler-gui");
  await ensureDirectory(cacheDir);
  const archivePath = path.join(cacheDir, asset.name);
  await downloadFile(asset.browser_download_url, archivePath);

  return { archivePath, releaseName: release.name ?? release.tag_name };
}

async function extractSevenZipArchive(
  archivePath: string,
  extractedRoot: string,
): Promise<void> {
  await execFileAsync(sevenZipBinaryPath.path7za, [
    "x",
    archivePath,
    `-o${extractedRoot}`,
    "-y",
  ]);
}

async function extractArchiveToTemp(archivePath: string): Promise<string> {
  const extractedRoot = path.join(
    path.dirname(archivePath),
    `${path.basename(archivePath, path.extname(archivePath))}-extracted`,
  );
  await fs.promises.rm(extractedRoot, { recursive: true, force: true });
  await ensureDirectory(extractedRoot);

  const extension = path.extname(archivePath).toLowerCase();
  if (extension === ".zip") {
    await extract(archivePath, { dir: extractedRoot });
  } else if (extension === ".7z") {
    await extractSevenZipArchive(archivePath, extractedRoot);
  } else {
    throw new Error(
      `Unsupported archive format for extraction: ${path.basename(archivePath)}`,
    );
  }

  return extractedRoot;
}

async function findFileRecursive(
  rootPath: string,
  fileName: string,
): Promise<string | null> {
  const stack = [rootPath];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;

    const entries = await fs.promises.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (
        entry.isFile() &&
        entry.name.toLowerCase() === fileName.toLowerCase()
      ) {
        return entryPath;
      }
      if (entry.isDirectory()) {
        stack.push(entryPath);
      }
    }
  }

  return null;
}

async function findPayloadRoot(
  extractedRoot: string,
  releaseName: string,
): Promise<PayloadLocation> {
  const dllPath = await findFileRecursive(extractedRoot, "OptiScaler.dll");
  if (!dllPath) {
    throw new Error("OptiScaler.dll was not found in the downloaded release.");
  }

  return {
    root: path.dirname(dllPath),
    dllPath,
    releaseName,
  };
}

async function prepareLatestPayload(
  sink?: InstallerProgressSink,
): Promise<PayloadLocation> {
  if (!preparedPayloadPromise) {
    preparedPayloadPromise = (async () => {
      sink?.report({
        phase: "download",
        message: "Fetching latest OptiScaler release",
        done: 1,
        total: 6,
      });
      const { archivePath, releaseName } = await downloadLatestReleaseArchive();

      sink?.report({
        phase: "extract",
        message: `Extracting ${releaseName}`,
        done: 2,
        total: 6,
      });
      const extractedRoot = await extractArchiveToTemp(archivePath);
      return findPayloadRoot(extractedRoot, releaseName);
    })().catch((error) => {
      preparedPayloadPromise = null;
      throw error;
    });
  }

  const payload = await preparedPayloadPromise;
  if (sink && payload.releaseName) {
    sink.report({
      phase: "extract",
      message: `Using ${payload.releaseName}`,
      done: 2,
      total: 6,
    });
  }

  return payload;
}

async function copyDirectoryRecursive(
  sourcePath: string,
  targetPath: string,
  sink?: InstallerProgressSink,
  basePath = sourcePath,
): Promise<void> {
  await ensureDirectory(targetPath);
  const entries = await fs.promises.readdir(sourcePath, {
    withFileTypes: true,
  });

  for (const entry of entries) {
    const sourceEntryPath = path.join(sourcePath, entry.name);
    const targetEntryPath = path.join(targetPath, entry.name);
    const relative = path.relative(basePath, sourceEntryPath) || entry.name;

    if (entry.isDirectory()) {
      sink?.report({
        phase: "copy",
        message: `Creating ${relative}`,
        done: 0,
        total: 0,
      });
      await copyDirectoryRecursive(
        sourceEntryPath,
        targetEntryPath,
        sink,
        basePath,
      );
      continue;
    }

    sink?.report({
      phase: "copy",
      message: `Copying ${relative}`,
      done: 0,
      total: 0,
    });
    await ensureDirectory(path.dirname(targetEntryPath));
    await fs.promises.copyFile(sourceEntryPath, targetEntryPath);
  }
}

async function backupFile(
  originalPath: string,
  backupRoot: string,
): Promise<void> {
  const relative = path.basename(originalPath);
  const backupPath = path.join(backupRoot, relative);
  await ensureDirectory(path.dirname(backupPath));
  await fs.promises.copyFile(originalPath, backupPath);
}

async function backupPath(
  originalPath: string,
  backupRoot: string,
): Promise<void> {
  const stats = await fs.promises.stat(originalPath);
  if (stats.isDirectory()) {
    const targetDirectory = path.join(backupRoot, path.basename(originalPath));
    await copyDirectoryRecursive(originalPath, targetDirectory);
    return;
  }

  await backupFile(originalPath, backupRoot);
}

async function removePathIfPresent(targetPath: string): Promise<void> {
  if (await pathExists(targetPath)) {
    await fs.promises.rm(targetPath, { force: true, recursive: true });
  }
}

async function loadBackupManifest(
  backupRoot: string,
): Promise<BackupManifest | null> {
  const manifestPath = path.join(backupRoot, "manifest.json");
  if (!(await pathExists(manifestPath))) {
    return null;
  }

  return JSON.parse(
    await fs.promises.readFile(manifestPath, "utf8"),
  ) as BackupManifest;
}

interface BackupSnapshot {
  root: string;
  name: string;
  manifest: BackupManifest;
}

async function getBackupSnapshots(gamePath: string): Promise<BackupSnapshot[]> {
  const backupFolder = path.join(gamePath, BACKUP_FOLDER);
  const folders: fs.Dirent[] = await fs.promises
    .readdir(backupFolder, { withFileTypes: true })
    .catch(() => [] as fs.Dirent[]);

  const snapshots = await Promise.all(
    folders
      .filter((entry: fs.Dirent) => entry.isDirectory())
      .map(async (entry: fs.Dirent) => {
        const root = path.join(backupFolder, entry.name);
        const manifest = await loadBackupManifest(root);
        if (!manifest) {
          return null;
        }

        return {
          root,
          name: entry.name,
          manifest,
        } satisfies BackupSnapshot;
      }),
  );

  return snapshots.filter((snapshot): snapshot is BackupSnapshot =>
    Boolean(snapshot),
  );
}

async function restorePathRecursive(
  backupPath: string,
  targetPath: string,
): Promise<void> {
  const stats = await fs.promises.stat(backupPath);
  if (stats.isDirectory()) {
    await ensureDirectory(targetPath);
    const entries = await fs.promises.readdir(backupPath, {
      withFileTypes: true,
    });
    for (const entry of entries) {
      await restorePathRecursive(
        path.join(backupPath, entry.name),
        path.join(targetPath, entry.name),
      );
    }
    return;
  }

  await ensureDirectory(path.dirname(targetPath));
  await fs.promises.copyFile(backupPath, targetPath);
}

async function writeConfigTweaks(
  gamePath: string,
  options: InstallOptions,
): Promise<string[]> {
  const notes: string[] = [];
  const configPath = path.join(gamePath, "OptiScaler.ini");

  if (!(await pathExists(configPath))) {
    notes.push("OptiScaler.ini was not present in the release payload.");
    return notes;
  }

  const currentText = await fs.promises.readFile(configPath, "utf8");
  let updatedText = currentText;

  if (options.enableSpoofing) {
    updatedText = updatedText.replace(/Dxgi=false/g, "Dxgi=auto");
    notes.push("Enabled default spoofing mode in OptiScaler.ini.");
  } else {
    updatedText = updatedText.replace(/Dxgi=auto/g, "Dxgi=false");
    notes.push("Disabled spoofing in OptiScaler.ini.");
  }

  if (updatedText !== currentText) {
    await fs.promises.writeFile(configPath, updatedText, "utf8");
  }

  return notes;
}

async function installOptiPatcher(gamePath: string): Promise<string | null> {
  const pluginsPath = path.join(gamePath, "plugins");
  await ensureDirectory(pluginsPath);
  const destinationPath = path.join(pluginsPath, "OptiPatcher.asi");
  await downloadFile(OPTIPATCHER_ASSET, destinationPath);
  return destinationPath;
}

function normalizeProxyFilename(proxyFilename: ProxyFilename): ProxyFilename {
  return proxyFilename;
}

async function createOriginalStateSnapshot(
  gamePath: string,
  proxyFilename: ProxyFilename,
  payloadEntries: fs.Dirent[],
): Promise<void> {
  const backupFolder = path.join(gamePath, BACKUP_FOLDER);
  const originalRoot = path.join(backupFolder, ORIGINAL_STATE_FOLDER);
  if (await pathExists(path.join(originalRoot, "manifest.json"))) {
    return;
  }

  await ensureDirectory(backupFolder);
  const existingSnapshots = (await getBackupSnapshots(gamePath))
    .filter((snapshot) => snapshot.name !== ORIGINAL_STATE_FOLDER)
    .sort((left, right) => left.name.localeCompare(right.name));

  if (existingSnapshots.length > 0) {
    await fs.promises.cp(existingSnapshots[0]!.root, originalRoot, {
      recursive: true,
    });
    return;
  }

  await ensureDirectory(originalRoot);
  const backedUpEntries = new Set<string>();
  const createdEntries = new Set<string>();

  for (const entry of payloadEntries) {
    const targetPath = path.join(gamePath, entry.name);
    if (await pathExists(targetPath)) {
      await backupPath(targetPath, originalRoot);
      backedUpEntries.add(entry.name);
    } else {
      createdEntries.add(entry.name);
    }
  }

  const targetDll = path.join(gamePath, proxyFilename);
  if (await pathExists(targetDll)) {
    await backupFile(targetDll, originalRoot);
    backedUpEntries.add(proxyFilename);
  } else {
    createdEntries.add(proxyFilename);
  }

  const manifest: BackupManifest = {
    installedAt: new Date().toISOString(),
    gamePath,
    proxyFilename,
    backupRoot: originalRoot,
    sourceRoot: gamePath,
    releaseName: "original-state",
    notes: ["Captured the original game state before OptiScaler changes."],
    backedUpEntries: Array.from(backedUpEntries).sort(),
    createdEntries: Array.from(createdEntries).sort(),
    preserveOriginalState: true,
  };
  await fs.promises.writeFile(
    path.join(originalRoot, "manifest.json"),
    JSON.stringify(manifest, null, 2),
    "utf8",
  );
}

export async function installOptiScalerIntoGame(
  gamePath: string,
  options: InstallOptions,
  sink?: InstallerProgressSink,
): Promise<InstallResult> {
  const payload = await prepareLatestPayload(sink);

  const proxyFilename = normalizeProxyFilename(options.proxyFilename);
  const backupRoot = path.join(
    gamePath,
    BACKUP_FOLDER,
    new Date().toISOString().replace(/[:.]/g, "-"),
  );
  await ensureDirectory(backupRoot);

  const payloadEntries = await fs.promises.readdir(payload.root, {
    withFileTypes: true,
  });
  const notes: string[] = [];
  const backedUpEntries = new Set<string>();
  const createdEntries = new Set<string>();

  if (options.preserveOriginalState) {
    await createOriginalStateSnapshot(gamePath, proxyFilename, payloadEntries);
    notes.push("Preserved the original game state for future restore.");
  }

  sink?.report({
    phase: "backup",
    message: "Backing up existing files",
    done: 3,
    total: 6,
  });
  for (const entry of payloadEntries) {
    const targetPath = path.join(gamePath, entry.name);
    if (await pathExists(targetPath)) {
      await backupPath(targetPath, backupRoot);
      backedUpEntries.add(entry.name);
    } else {
      createdEntries.add(entry.name);
    }
  }

  sink?.report({
    phase: "copy",
    message: "Copying OptiScaler files into the game folder",
    done: 4,
    total: 6,
  });
  await copyDirectoryRecursive(payload.root, gamePath, sink);

  const installedDll = path.join(gamePath, "OptiScaler.dll");
  const targetDll = path.join(gamePath, proxyFilename);
  if (proxyFilename !== "OptiScaler.asi") {
    if (await pathExists(targetDll)) {
      await backupFile(targetDll, backupRoot);
      backedUpEntries.add(proxyFilename);
      await fs.promises.rm(targetDll, { force: true });
    } else {
      createdEntries.add(proxyFilename);
    }
    await fs.promises.rename(installedDll, targetDll);
    notes.push(`Main payload renamed to ${proxyFilename}.`);
  } else {
    createdEntries.add(proxyFilename);
    await fs.promises.rename(installedDll, targetDll);
    notes.push("Installed as OptiScaler.asi.");
  }

  sink?.report({
    phase: "config",
    message: "Applying configuration tweaks",
    done: 5,
    total: 6,
  });
  notes.push(...(await writeConfigTweaks(gamePath, options)));

  if (options.installOptiPatcher) {
    sink?.report({
      phase: "optiPatcher",
      message: "Downloading OptiPatcher",
      done: 5,
      total: 6,
    });
    const patcherPath = await installOptiPatcher(gamePath);
    if (patcherPath) {
      createdEntries.add(path.relative(gamePath, patcherPath));
      notes.push("OptiPatcher.asi downloaded to plugins/.");
      const configPath = path.join(gamePath, "OptiScaler.ini");
      if (await pathExists(configPath)) {
        const text = await fs.promises.readFile(configPath, "utf8");
        const updated = text.replace(
          /LoadAsiPlugins=auto/g,
          "LoadAsiPlugins=true",
        );
        if (updated !== text) {
          await fs.promises.writeFile(configPath, updated, "utf8");
          notes.push("Enabled ASI plugin loading in OptiScaler.ini.");
        }
      }
    }
  }

  const manifest: BackupManifest = {
    installedAt: new Date().toISOString(),
    gamePath,
    proxyFilename,
    backupRoot,
    sourceRoot: payload.root,
    releaseName: payload.releaseName,
    notes,
    backedUpEntries: Array.from(backedUpEntries).sort(),
    createdEntries: Array.from(createdEntries).sort(),
    preserveOriginalState: options.preserveOriginalState,
  };
  await fs.promises.writeFile(
    path.join(backupRoot, "manifest.json"),
    JSON.stringify(manifest, null, 2),
    "utf8",
  );

  sink?.report({
    phase: "complete",
    message: "Installation complete",
    done: 6,
    total: 6,
  });
  return {
    gameId: gamePath,
    gameTitle: path.basename(gamePath),
    installedTo: gamePath,
    proxyFilename,
    restored: false,
    notes,
  };
}

export async function restoreOptiScalerFromGame(
  gamePath: string,
): Promise<InstallResult> {
  const backupFolder = path.join(gamePath, BACKUP_FOLDER);
  const snapshots = await getBackupSnapshots(gamePath);
  const originalSnapshot = snapshots.find(
    (snapshot) => snapshot.name === ORIGINAL_STATE_FOLDER,
  );
  const latestSnapshot = snapshots
    .filter((snapshot) => snapshot.name !== ORIGINAL_STATE_FOLDER)
    .sort((left, right) => right.name.localeCompare(left.name))[0];

  if (!originalSnapshot && !latestSnapshot) {
    throw new Error("No OptiScaler backup was found for this game.");
  }

  const restoreSnapshot = originalSnapshot ?? latestSnapshot!;

  const installedFiles = new Set([
    latestSnapshot?.manifest.proxyFilename ??
      restoreSnapshot.manifest.proxyFilename,
    "OptiScaler.dll",
    "OptiScaler.ini",
    "OptiScaler.log",
    "nvapi64.dll",
    "nvngx.dll",
    "fakenvapi.dll",
    "fakenvapi.ini",
    "fakenvapi.log",
    "dlssg_to_fsr3_amd_is_better.dll",
    "dlssg_to_fsr3.log",
    "Remove OptiScaler.bat",
    ...snapshots.flatMap((snapshot) => [
      snapshot.manifest.proxyFilename,
      ...(snapshot.manifest.createdEntries ?? []),
      ...(snapshot.manifest.backedUpEntries ?? []),
    ]),
  ]);

  for (const relativePath of installedFiles) {
    await removePathIfPresent(path.join(gamePath, relativePath));
  }

  const restoreEntries = await fs.promises.readdir(restoreSnapshot.root, {
    withFileTypes: true,
  });
  for (const entry of restoreEntries) {
    if (entry.name === "manifest.json") continue;
    await restorePathRecursive(
      path.join(restoreSnapshot.root, entry.name),
      path.join(gamePath, entry.name),
    );
  }

  return {
    gameId: gamePath,
    gameTitle: path.basename(gamePath),
    installedTo: gamePath,
    proxyFilename: restoreSnapshot.manifest.proxyFilename,
    restored: true,
    notes: [
      originalSnapshot
        ? "Restored the preserved original game state."
        : "Restored the most recent OptiScaler backup.",
      ...(restoreSnapshot.manifest.notes ?? []),
    ],
  };
}
