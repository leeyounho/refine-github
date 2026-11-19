# Refine GitHub

Refine GitHub lets you adjust the layout and text size of repository issues, pull requests, and wikis on github.com and your GitHub Enterprise Server in Chrome or Microsoft Edge.

## Features

- Choose a Page width. Default uses GitHub’s layout, Wide caps the layout at 1600 px, and Full width uses the available space.
- Turn on Focus mode to hide the issue or pull request sidebar, or the page list beside a wiki article.
- Set Font size from 8 to 20 px in 1 px steps for descriptions, comments, and wiki text. Code diffs keep their original size.
- Select Reset to restore GitHub’s default width, turn off Focus mode, and return text to 16 px.

Changes apply immediately to open GitHub tabs and are saved for your next visit.

On an HTTPS GitHub Enterprise site, open the toolbar popup, choose **Enable on this site**, and approve access to the displayed hostname. The extension applies your reading settings to that host on this and future visits. Choose **Disable on this site** to remove access. Reset only affects reading preferences.

## Permissions

| Permission | Justification |
| --- | --- |
| `storage` | Refine GitHub uses local storage to remember the user’s page width, focus mode, font size, and enabled GitHub Enterprise hosts across browser sessions. Open tabs listen for changes so reading preferences take effect immediately. |
| `activeTab` | When the user opens the toolbar popup, Refine GitHub reads the active tab’s URL to display its hostname and let the user enable or disable the extension for that site. |
| `scripting` | GitHub Enterprise hostnames are chosen after installation. Refine GitHub uses this permission to apply its bundled layout script and stylesheet to open tabs on a user-approved host and register them for future visits. |

## Installation

1. Extract the extension ZIP. To build from source instead, run `npm ci` and `npm run build`.
2. Open `chrome://extensions` or `edge://extensions` and enable Developer mode.
3. Select Load unpacked and choose the extracted folder containing `manifest.json`, or `dist/` for a local build.
4. Refresh any open GitHub tabs and select the Refine GitHub toolbar icon to adjust your settings.

## Development

Use Node.js 22 or later. Run `npm run verify` to type-check the code, build the extension, and run the tests in an isolated Edge profile. Run `npm run test:live` to check layouts on public GitHub pages.

## Release files

On Windows, run `npm run package` or double-click `package-extension.bat`. Both run verification and create `release/refine-github-<version>.zip` using the version in `manifest.json`. Packaging the same version again replaces its ZIP after validation. Other versions stay in `release/`. Use `dist/` to load the unpacked extension during development.

## Support

[Report an issue](https://github.com/leeyounho/refine-github/issues) · [Support the developer on Ko-fi](https://ko-fi.com/coffee320ml)
