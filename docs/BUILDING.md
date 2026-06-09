# Building for Distribution

## Build Windows Installer

To create a Windows installer (.exe):

```bash
npm run build
```

This will create:
- `dist/Meeting Notes Setup x.x.x.exe` - NSIS installer
- `dist/latest.yml` - **Required for auto-updates** - upload this to GitHub Releases
- `dist/win-unpacked/` - Unpacked application files

## Build macOS Installer

```bash
npm run build:mac
```

## Build All Platforms

```bash
npm run build:all
```

## Build to Directory Only (for testing)

```bash
npm run build:dir
```

This creates an unpacked version without the installer for quick testing.

## Build Configuration

The build configuration is in `package.json` under the `build` key. It includes settings for both Windows and macOS builds, including icon configuration, installers, and platform-specific options. The `publish` section enables automatic updates via GitHub Releases.

### Update Configuration

The update configuration in `package.json`:
```json
{
  "build": {
    "publish": [
      {
        "provider": "github",
        "owner": "deanhume",
        "repo": "meeting-notes"
      }
    ]
  }
}
```

## Related Documentation

- **[AUTO_UPDATES.md](../AUTO_UPDATES.md)** - Complete guide for auto-updates with testing, troubleshooting, and advanced configuration
- **[RELEASE_CHECKLIST.md](../RELEASE_CHECKLIST.md)** - Quick reference for publishing updates
