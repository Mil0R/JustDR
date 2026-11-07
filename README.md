# JustDR

A Chrome extension that shows the current website's Ahrefs Domain Rating (DR) in the browser action badge.

## Features

- Manual DR lookup by clicking the extension icon
- Optional automatic DR lookup when switching to or opening a tab
- Right-click action menu toggle: `Auto DR`
- Right-click action menu switch: toggle between `DR3` and `DR4`
- Support for Ahrefs Domain Rating versions: DR3 (default) and DR4
- Color-coded badge ranges for DR values

## Files

- `manifest.json`: Chrome extension manifest
- `background.js`: service worker logic
- `icons/`: extension icons
- `CHROMEWEBSTORE.md`: Chrome Web Store submission notes
- `dr`: CLI helper for querying the Ahrefs free DR endpoint (`dr <domain> [dr3|dr4]`)

## Packaging

Build a Chrome Web Store upload zip from the project root:

```bash
zip -r dist/justdr-chrome-webstore.zip manifest.json background.js icons
```
