# Quick Reference: Publishing Updates

## Automated Release

Releases are built and published by `.github/workflows/release.yml` on a clean
Windows GitHub Actions runner. Do not upload installers built from a developer
workstation.

1. Update the version in `package.json` and `package-lock.json`.
2. Commit and push the release changes to `main`.
3. Tag that exact commit with the same version, optionally prefixed with `v`:
   ```bash
   git tag 1.2.5
   git push origin 1.2.5
   ```
4. Monitor the **Release** workflow. It installs dependencies, runs tests,
   downloads the transcription assets, builds the installer, verifies the
   packaged modules/model/checksums, uploads a draft, and then publishes it.

If any step fails, no public release is created. A failed run that already
created a draft can be rerun; its assets are replaced before publication.

## Manual Build Reference

### 1. Build Your App
```bash
# For Windows
npm run build
```

### 2. Files Created in `dist/` folder

**Windows:**
- `Meeting-Notes-Setup-x.x.x.exe` ← Upload to GitHub
- `Meeting-Notes-Setup-x.x.x.exe.blockmap` ← Upload to GitHub
- `latest.yml` ← **MUST UPLOAD** for auto-updates

**macOS:**
- `Meeting Notes-x.x.x.dmg` ← Upload to GitHub
- `Meeting Notes-x.x.x-mac.zip` ← Upload to GitHub
- `latest-mac.yml` ← **MUST UPLOAD** for auto-updates

### 3. Create GitHub Release Manually

1. Go to: https://github.com/deanhume/meeting-notes/releases/new
2. Tag version: `v1.1.8` (must be higher than current)
3. Release title: `Version 1.1.8`
4. Describe what's new
5. Drag and drop ALL files from step 2 without renaming them
6. Click "Publish release"

Before publishing, open `latest.yml` and verify its `path` and `files[].url`
exactly match the uploaded installer filename. A mismatch causes update checks
to fail with HTTP 404.

### 4. Users Get Updated

- Within 1 hour (or on next app start)
- They'll see: "Update available. Download now?"
- After download: "Restart to install?"
- Done! ✅

## Common Issues

❌ **"No updates available"** but there is one
- Did you upload `latest.yml`? (Windows)
- Did you upload `latest-mac.yml`? (macOS)
- Is the new version number higher?

❌ **Auto-updates not working at all**
- Only works in BUILT apps (not `npm start`)
- Check logs: `%APPDATA%/meeting-notes/logs/main.log`
- Confirm the installer filename exactly matches `latest.yml`

## Testing

```bash
# Build to test
npm run build:dir

# Run the built app
dist/win-unpacked/Meeting Notes.exe

# Check console for:
# "Running in development mode - auto-updates disabled" (if npm start)
# OR
# Auto-updater should be active
```

## Version Bump

Current version auto-increments when you build.

To manually set version:
```bash
npm version 1.2.0 --no-git-tag-version
npm run build
```

## That's It!

Simple as:
1. Build → 2. Upload to GitHub Release → 3. Users get updated ✅
