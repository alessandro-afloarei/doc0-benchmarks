---
title: "Browsers CLI"
---
## Overview

`@puppeteer/browsers` ships a command line for installing, launching, listing and removing browsers, built with `yargs` in the `CLI` class. The package's own binary runs it with default settings (`npx @puppeteer/browsers …`). The `puppeteer` package runs the same class as `npx puppeteer browsers …`, preconfigured with its cache directory and its pinned browser versions. Each command is a thin layer over the programmatic API ([[Installing Browsers and the Cache]], [[Browser Data and Version Resolution]], [[Launching Browser Processes]]).

Sources: [packages/browsers/src/main-cli.ts:1-11](repo://packages/browsers/src/main-cli.ts#L1-L11), [packages/browsers/src/CLI.ts:51-104](repo://packages/browsers/src/CLI.ts#L51-L104), [packages/puppeteer/src/node/cli.ts:9-50](repo://packages/puppeteer/src/node/cli.ts#L9-L50)

## Configuring a CLI instance

### Constructor options

| Option | Default | Effect |
| --- | --- | --- |
| `cachePath` | current working directory | Cache root used when `--path` is not given |
| `scriptName` | `@puppeteer/browsers` | Name shown in help |
| `version` | the package version | Output of `--version` |
| `prefixCommand` | none | Nest all commands under a sub-command, such as `browsers` |
| `allowCachePathOverride` | `true` | Whether the `--path` option exists |
| `pinnedBrowsers` | none | Per browser, a `buildId` and `skipDownload` used when no version is given |

Sources: [packages/browsers/src/CLI.ts:68-104](repo://packages/browsers/src/CLI.ts#L68-L104)

`run(argv)` loads `yargs` lazily, registers the commands (inside the prefix command when there is one), requires a command, and parses. Passing a string to the constructor is shorthand for `{cachePath}`.

Sources: [packages/browsers/src/CLI.ts:166-189](repo://packages/browsers/src/CLI.ts#L166-L189)

### Browser arguments

Browsers are written `<browser>[@<buildId>]`. The name must be a `Browser` value (`chrome`, `chrome-headless-shell`, `chromedriver`, `chromium`, `firefox`), and anything else fails with `Unsupported browser`. Without `@`, the build id is `latest`, or `pinned` when the CLI has pinned browsers. `pinned` is replaced by the pinned build id before use and fails with `No pinned version found for <browser>` if there is none. `--platform` defaults to the detected platform and accepts any `BrowserPlatform`.

Sources: [packages/browsers/src/CLI.ts:106-150](repo://packages/browsers/src/CLI.ts#L106-L150), [packages/browsers/src/CLI.ts:493-515](repo://packages/browsers/src/CLI.ts#L493-L515)

## Commands

### install

`install [browser]` resolves the build id with `resolveBuildId`, so tags (`stable`, `canary`, `latest`), milestones (`115`) and build prefixes (`115.0.5790`) become concrete versions. It installs with a progress bar, passes the original tag as `buildIdAlias` when it differs, and prints `<browser>@<buildId> <executablePath>`. Options are `--path`, `--platform`, `--base-url` and `--install-deps`. With pinned browsers and no browser argument, it installs every pinned browser not marked `skipDownload`, in parallel, and reports the first failure after all have settled.

Sources: [packages/browsers/src/CLI.ts:191-198](repo://packages/browsers/src/CLI.ts#L191-L198), [packages/browsers/src/CLI.ts:299-347](repo://packages/browsers/src/CLI.ts#L299-L347), [packages/browsers/src/CLI.ts:517-553](repo://packages/browsers/src/CLI.ts#L517-L553)

The help text's own examples show the accepted forms:

Sources: [packages/browsers/README.md:58-79](repo://packages/browsers/README.md#L58-L79)

```bash
npx @puppeteer/browsers install chrome@stable
npx @puppeteer/browsers install chrome@116.0.5793.0
npx @puppeteer/browsers install chrome@117
npx @puppeteer/browsers install chromedriver@canary
npx puppeteer browsers install chrome --install-deps
```

Sources: [packages/browsers/README.md:58-79](repo://packages/browsers/README.md#L58-L79)

### launch

`launch <browser>` starts a cached build, or with `--system` the system installation of the Chrome channel named by the build id (for example `chrome@canary --system`). Arguments after `--` are passed to the browser, and `--detached` and `--dumpio` map to the launch options of the same name.

Sources: [packages/browsers/src/CLI.ts:349-433](repo://packages/browsers/src/CLI.ts#L349-L433)

### clear and list

`clear` asks `Do you want to permanently and recursively delete the content of <dir> (yes/No)?` and deletes the whole cache directory only on `y` or `yes`. When the path can be overridden, `--path` is required for this command. `list` prints one line per installed build: `<browser>@<buildId> (<platform>) <executablePath>`.

Sources: [packages/browsers/src/CLI.ts:434-488](repo://packages/browsers/src/CLI.ts#L434-L488)

## The puppeteer browsers wrapper

The `puppeteer` package's `bin` creates a `CLI` with:

Sources: [packages/puppeteer/src/node/cli.ts:9-50](repo://packages/puppeteer/src/node/cli.ts#L9-L50), [packages/puppeteer/package.json:12-12](repo://packages/puppeteer/package.json#L12-L12)

- `cachePath` set to the configured `cacheDirectory` and `allowCachePathOverride: false`, so commands always act on Puppeteer's cache and `--path` does not exist;
- `scriptName: 'puppeteer'`, `prefixCommand: {cmd: 'browsers', …}` and Puppeteer's version;
- `pinnedBrowsers` for `chrome`, `chrome-headless-shell` and `firefox`, each with the configured version or the pinned revision (falling back to `latest`) and the configured `skipDownload`; Firefox defaults to skipped.

Sources: [packages/puppeteer/src/node/cli.ts:9-50](repo://packages/puppeteer/src/node/cli.ts#L9-L50), [packages/puppeteer/package.json:12-12](repo://packages/puppeteer/package.json#L12-L12)

As a result, `npx puppeteer browsers install` repeats the postinstall download, and `npx puppeteer browsers install firefox` installs the pinned Firefox even though it is skipped by default, because an explicit browser argument bypasses `skipDownload`. `npx puppeteer browsers launch chrome` launches the pinned Chrome from Puppeteer's cache. [[Configuration and Browser Download]] describes where the configuration comes from.

Sources: [packages/browsers/src/CLI.ts:317-347](repo://packages/browsers/src/CLI.ts#L317-L347), [packages/browsers/src/CLI.ts:403-432](repo://packages/browsers/src/CLI.ts#L403-L432)
