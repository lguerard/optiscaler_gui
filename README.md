# OptiScaler GUI

Electron desktop app for finding installed games and automating an OptiScaler deployment workflow.

## Features

- Scans common launcher install locations for games.
- Inspects local game files and likely per-game settings files to infer shipped and active upscaler or frame-generation methods.
- Downloads the latest OptiScaler release from GitHub.
- Copies OptiScaler into a selected game folder.
- Renames the main payload to the chosen proxy filename.
- Optionally installs OptiPatcher and updates `OptiScaler.ini` spoofing settings.
- Stores backups so an install can be restored.

## Development

1. Install dependencies with `npm install`.
2. Run the app with `npm run dev`.
3. Build the Windows executable with `npm run build`.
4. The runnable output is a portable Windows `.exe` created in `release/`.
5. The Windows app icon is generated from `scripts/generate-icon.ps1` into `build/icon.ico` during builds.

## Releases

- Pushing a version tag such as `v0.1.0` triggers GitHub Actions to build a Windows `.exe`, create a GitHub release, generate release notes automatically, and attach the built executable as a release asset.

## Notes

- This project is a GUI wrapper for the upstream OptiScaler installation flow.
- The packaged Windows build is portable and self-contained for end users. No separate Electron runtime folder is required.
- The app icon is an original design intended to communicate upscaling, swapping, and ease of use without reusing upstream branding directly.
- It does not redistribute OptiScaler binaries; it downloads them from the official GitHub release feed at runtime.
