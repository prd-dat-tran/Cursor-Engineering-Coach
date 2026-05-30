---
title: "Installation"
weight: 10
description: "Build and install the extension from source"
---

# Installation

The extension is not yet published on the Cursor extensions marketplace. Install it by building a `.vsix` package from source.

## Package from Source

```bash
git clone https://github.com/prd-dat-tran/Cursor-Engineering-Coach.git
cd Cursor-Engineering-Coach
npm install
npm run package
```

This produces a `.vsix` file in the project root.

## Install the .vsix

From the command line:

```bash
cursor --install-extension cursor-engineering-coach-*.vsix
```

Or open the Extensions panel in Cursor, click the `...` menu, choose **Install from VSIX...**, and select the file.

## Development

To run the extension in development mode instead, use `npm run build` and press `F5` in Cursor to launch the Extension Development Host.

## Opening the Dashboard

After installation, open the Command Palette and run:

```
Cursor Engineering Coach: Open Dashboard
```

You can also click the Cursor Engineering Coach icon in the Activity Bar (sidebar) if it appears there.

## Configuration

Cursor Engineering Coach works out of the box with sensible defaults. Optional settings are available under `cursorEngineeringCoach.*` in Cursor settings to control cache behavior, date ranges, and workspace filtering.
