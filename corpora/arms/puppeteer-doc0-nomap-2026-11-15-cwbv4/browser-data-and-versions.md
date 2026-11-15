---
title: "Browser Data and Version Resolution"
---
## Overview

Everything browser-specific in `@puppeteer/browsers` lives in `src/browser-data`: one module per browser (`chrome`, `chrome-headless-shell`, `chromedriver`, `chromium`, `firefox`) that knows how to name a download for a platform and build id, where the executable sits inside the unpacked archive, how to compare two build ids, and how to turn a tag such as `stable` into a concrete build id. `browser-data.ts` gathers these functions into lookup tables keyed by `Browser`, so the install, cache and launch code never switch on the browser themselves ([[Installing Browsers and the Cache]], [[Launching Browser Processes]]).

Sources: [packages/browsers/src/browser-data/browser-data.ts:7-54](repo://packages/browsers/src/browser-data/browser-data.ts#L7-L54)

## Names and enums

| Enum | Values |
| --- | --- |
| `Browser` | `chrome`, `chrome-headless-shell`, `chromium`, `firefox`, `chromedriver` |
| `BrowserPlatform` | `linux`, `linux_arm`, `mac`, `mac_arm`, `win32`, `win64` |
| `BrowserTag` | `canary`, `nightly`, `beta`, `dev`, `devedition`, `stable`, `esr`, `latest` |
| `ChromeReleaseChannel` | `stable`, `dev`, `canary`, `beta` |

Sources: [packages/browsers/src/browser-data/types.ts:12-70](repo://packages/browsers/src/browser-data/types.ts#L12-L70)

The `Browser` values are also the folder names in the cache. Installation folders are named `<platform>-<buildId>`, and the cache only recognises names with exactly one hyphen when listing installed browsers.

Sources: [packages/browsers/src/Cache.ts:129-172](repo://packages/browsers/src/Cache.ts#L129-L172), [packages/browsers/src/Cache.ts:261-274](repo://packages/browsers/src/Cache.ts#L261-L274)

## Lookup tables

| Table | Function per browser | Used by |
| --- | --- | --- |
| `downloadUrls` | `resolveDownloadUrl(platform, buildId, baseUrl?)` | `install`, `canDownload`, `getDownloadUrl` |
| `downloadPaths` | `resolveDownloadPath(platform, buildId)` (URL path segments) | URL builders |
| `executablePathByBrowser` | `relativeExecutablePath(platform, buildId)` | `Cache.computeExecutablePath` |
| `versionComparators` | `compareVersions(a, b)` | Sorting aliases to resolve `latest` |

Sources: [packages/browsers/src/browser-data/browser-data.ts:22-52](repo://packages/browsers/src/browser-data/browser-data.ts#L22-L52), [packages/browsers/src/browser-data/browser-data.ts:248-252](repo://packages/browsers/src/browser-data/browser-data.ts#L248-L252)

## Chrome for Testing family

### Downloads and executables

Chrome, `chrome-headless-shell` and ChromeDriver all come from Chrome for Testing at `https://storage.googleapis.com/chrome-for-testing-public`. The URL path is `<buildId>/<folder>/<product>-<folder>.zip`, where the folder is `linux64`, `mac-arm64`, `mac-x64`, `win32` or `win64`. ARM Linux maps to `linux64` too.

Sources: [packages/browsers/src/browser-data/chrome.ts:15-44](repo://packages/browsers/src/browser-data/chrome.ts#L15-L44), [packages/browsers/src/browser-data/chrome-headless-shell.ts:10-43](repo://packages/browsers/src/browser-data/chrome-headless-shell.ts#L10-L43), [packages/browsers/src/browser-data/chromedriver.ts:10-39](repo://packages/browsers/src/browser-data/chromedriver.ts#L10-L39)

| Product | Executable inside the archive (Linux / macOS / Windows) |
| --- | --- |
| Chrome | `chrome-linux64/chrome` / `chrome-mac-*/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing` / `chrome-win*/chrome.exe` |
| chrome-headless-shell | `chrome-headless-shell-linux64/chrome-headless-shell` / `chrome-headless-shell-mac-*/chrome-headless-shell` / `…/chrome-headless-shell.exe` |
| ChromeDriver | `chromedriver-linux64/chromedriver` / `chromedriver-mac-*/chromedriver` / `…/chromedriver.exe` |

Sources: [packages/browsers/src/browser-data/chrome.ts:46-67](repo://packages/browsers/src/browser-data/chrome.ts#L46-L67), [packages/browsers/src/browser-data/chrome-headless-shell.ts:45-69](repo://packages/browsers/src/browser-data/chrome-headless-shell.ts#L45-L69), [packages/browsers/src/browser-data/chromedriver.ts:41-56](repo://packages/browsers/src/browser-data/chromedriver.ts#L41-L56)

### Resolving Chrome versions

`chrome.resolveBuildId(value)` understands three forms, each answered by a JSON file published at `https://googlechromelabs.github.io/chrome-for-testing/`:

Sources: [packages/browsers/src/browser-data/chrome.ts:69-155](repo://packages/browsers/src/browser-data/chrome.ts#L69-L155)

| Input | Example | Lookup |
| --- | --- | --- |
| A release channel | `stable`, `beta`, `dev`, `canary` | `last-known-good-versions.json` (channel names lower-cased) |
| A milestone | `117` | `latest-versions-per-milestone.json` |
| A build prefix | `116.0.5793` | `latest-patch-versions-per-build.json` |

Sources: [packages/browsers/src/browser-data/chrome.ts:69-155](repo://packages/browsers/src/browser-data/chrome.ts#L69-L155)

Anything else resolves to `undefined`, and the caller then uses the input as the build id unchanged, which is how full versions such as `116.0.5793.0` pass through. ChromeDriver and `chrome-headless-shell` re-export Chrome's `resolveBuildId` and `compareVersions`, which compares with `semver` and throws on invalid versions.

Sources: [packages/browsers/src/browser-data/chrome.ts:201-215](repo://packages/browsers/src/browser-data/chrome.ts#L201-L215), [packages/browsers/src/browser-data/chrome-headless-shell.ts:71-71](repo://packages/browsers/src/browser-data/chrome-headless-shell.ts#L71-L71), [packages/browsers/src/browser-data/browser-data.ts:178-202](repo://packages/browsers/src/browser-data/browser-data.ts#L178-L202)

### System Chrome

`resolveSystemExecutablePath(platform, channel)` returns the standard install location of a release channel, which is what `channel: 'chrome-beta'` and similar launch options use:

Sources: [packages/browsers/src/browser-data/chrome.ts:157-199](repo://packages/browsers/src/browser-data/chrome.ts#L157-L199), [packages/browsers/src/browser-data/browser-data.ts:224-240](repo://packages/browsers/src/browser-data/browser-data.ts#L224-L240)

| Platform | Stable | Beta / Dev / Canary |
| --- | --- | --- |
| Windows | `%PROGRAMFILES%\Google\Chrome\Application\chrome.exe` | `Chrome Beta`, `Chrome Dev`, `Chrome SxS` folders |
| macOS | `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` | `Google Chrome Beta.app`, `Google Chrome Dev.app`, `Google Chrome Canary.app` |
| Linux | `/opt/google/chrome/chrome` | `/opt/google/chrome-beta`, `/opt/google/chrome-unstable`, `/opt/google/chrome-canary` |

Sources: [packages/browsers/src/browser-data/chrome.ts:157-199](repo://packages/browsers/src/browser-data/chrome.ts#L157-L199), [packages/browsers/src/browser-data/browser-data.ts:224-240](repo://packages/browsers/src/browser-data/browser-data.ts#L224-L240)

System detection is only implemented for Chrome; other browsers throw `System browser detection is not supported`.

Sources: [packages/browsers/src/browser-data/browser-data.ts:229-236](repo://packages/browsers/src/browser-data/browser-data.ts#L229-L236)

## Chromium snapshots

Chromium builds are revision numbers from `https://storage.googleapis.com/chromium-browser-snapshots`, under `<folder>/<revision>/<archive>.zip`. The folders are `Linux_x64`, `Mac_Arm`, `Mac`, `Win` and `Win_x64`, and the archive is `chrome-linux`, `chrome-mac`, or on Windows `chrome-win` (`chrome-win32` for revisions up to 591479). `latest` reads the folder's `LAST_CHANGE` file; other tags are rejected. Revisions compare numerically.

Sources: [packages/browsers/src/browser-data/chromium.ts:13-95](repo://packages/browsers/src/browser-data/chromium.ts#L13-L95)

## Firefox

### Channel-prefixed build ids

Firefox build ids carry their channel: `stable_142.0.1`, `beta_…`, `devedition_…`, `esr_…`, or a bare version for nightly. `parseBuildId` splits the prefix off and defaults to nightly. This is why Puppeteer's pinned Firefox revision is `stable_142.0.1` ([[Configuration and Browser Download]]).

Sources: [packages/browsers/src/browser-data/firefox.ts:63-72](repo://packages/browsers/src/browser-data/firefox.ts#L63-L72), [packages/puppeteer-core/src/revisions.ts:10-14](repo://packages/puppeteer-core/src/revisions.ts#L10-L14)

### Downloads

| Channel | Host | Path |
| --- | --- | --- |
| Nightly | `archive.mozilla.org/pub/firefox/nightly/latest-mozilla-central` | `firefox-<v>.en-US.<platform>.<ext>` |
| Dev edition | `archive.mozilla.org/pub/devedition/releases` | `<v>/<platform>/en-US/<archive>` |
| Beta, stable, ESR | `archive.mozilla.org/pub/firefox/releases` | `<v>/<platform>/en-US/<archive>` |

Sources: [packages/browsers/src/browser-data/firefox.ts:74-116](repo://packages/browsers/src/browser-data/firefox.ts#L74-L116)

Archives are `.tar.xz` on Linux from version 135 (`.tar.bz2` before), `.dmg` on macOS, a `.zip` for Windows nightlies and a `Firefox Setup <v>.exe` installer for Windows releases. The executable is `firefox/firefox` on Linux, `Firefox.app` (or `Firefox Nightly.app`) on macOS, and `core\firefox.exe` or `firefox\firefox.exe` on Windows. Versions compare by parsing the digits as hexadecimal after removing the first dot.

Sources: [packages/browsers/src/browser-data/firefox.ts:14-61](repo://packages/browsers/src/browser-data/firefox.ts#L14-L61), [packages/browsers/src/browser-data/firefox.ts:118-157](repo://packages/browsers/src/browser-data/firefox.ts#L118-L157), [packages/browsers/src/browser-data/firefox.ts:452-455](repo://packages/browsers/src/browser-data/firefox.ts#L452-L455)

### Resolving Firefox versions

`firefox.resolveBuildId(channel)` reads `https://product-details.mozilla.org/1.0/firefox_versions.json` and returns `<channel>_<version>` from the key for that channel (`LATEST_FIREFOX_VERSION`, `FIREFOX_ESR`, `FIREFOX_DEVEDITION` for both dev edition and beta, or `FIREFOX_NIGHTLY`). A plain version string passes through unchanged.

Sources: [packages/browsers/src/browser-data/firefox.ts:159-185](repo://packages/browsers/src/browser-data/firefox.ts#L159-L185), [packages/browsers/src/browser-data/browser-data.ts:178-180](repo://packages/browsers/src/browser-data/browser-data.ts#L178-L180)

### Profiles

`createProfile(Browser.FIREFOX, {path, preferences})` prepares a profile folder for automation. It merges a long list of default preferences (for example no update checks, no safe browsing, a blank start page, and `remote.enabled`) with the caller's, writes them as `user_pref(...)` lines to `user.js`, and backs up any existing `user.js` and `prefs.js` as `*.puppeteer`. Puppeteer's Firefox launcher restores those backups when the browser exits ([[Launching Browsers]]). Profile creation for Chrome and Chromium throws.

Sources: [packages/browsers/src/browser-data/firefox.ts:187-260](repo://packages/browsers/src/browser-data/firefox.ts#L187-L260), [packages/browsers/src/browser-data/firefox.ts:370-414](repo://packages/browsers/src/browser-data/firefox.ts#L370-L414), [packages/browsers/src/browser-data/firefox.ts:416-450](repo://packages/browsers/src/browser-data/firefox.ts#L416-L450), [packages/browsers/src/browser-data/browser-data.ts:208-219](repo://packages/browsers/src/browser-data/browser-data.ts#L208-L219)

## Tag resolution across browsers

`resolveBuildId(browser, platform, tag)` first checks whether `tag` is a `BrowserTag` and, if so, maps it per browser:

Sources: [packages/browsers/src/browser-data/browser-data.ts:59-163](repo://packages/browsers/src/browser-data/browser-data.ts#L59-L163)

| Tag | Chrome | ChromeDriver, chrome-headless-shell | Chromium | Firefox |
| --- | --- | --- | --- | --- |
| `latest` | Canary channel | Canary channel | `LAST_CHANGE` | Nightly |
| `stable`, `beta`, `dev`, `canary` | That channel | That channel | error | `stable`, `beta`; `dev` and `canary` error |
| `nightly`, `devedition`, `esr` | error | error | error | That channel |

Sources: [packages/browsers/src/browser-data/browser-data.ts:59-163](repo://packages/browsers/src/browser-data/browser-data.ts#L59-L163)

Any other string goes to the browser's own resolver, which returns a concrete id for channels, milestones and build prefixes, or the input unchanged. The CLI and Puppeteer's installer call this before `install` and pass the original tag as `buildIdAlias`, so the cache can resolve `stable` to the build it downloaded ([[Browsers CLI]]).

Sources: [packages/browsers/src/browser-data/browser-data.ts:168-203](repo://packages/browsers/src/browser-data/browser-data.ts#L168-L203), [packages/puppeteer/src/node/install.ts:37-52](repo://packages/puppeteer/src/node/install.ts#L37-L52)
