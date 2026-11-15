---
title: "Quickstart"
---
## Overview

This page installs Puppeteer, explains which browsers arrive with it, and walks through a first script that opens a page, interacts with it and saves a screenshot. Puppeteer needs Node.js 18 or newer.

Sources: [packages/puppeteer/package.json:34-41](repo://packages/puppeteer/package.json#L34-L41), [README.md:15-20](repo://README.md#L15-L20)

## Install

Choose between the two published packages:

Sources: [README.md:15-20](repo://README.md#L15-L20)

```bash
npm i puppeteer # Downloads compatible Chrome during installation.
npm i puppeteer-core # Alternatively, install as a library, without downloading Chrome.
```

Sources: [README.md:15-20](repo://README.md#L15-L20)

Installing `puppeteer` runs its `postinstall` script, `node install.mjs`. The script imports `downloadBrowsers` and fetches the Chrome and `chrome-headless-shell` builds that this Puppeteer release pins, unless the configuration says to skip them. Firefox is skipped by default. The browsers land in `~/.cache/puppeteer` unless the cache directory is configured elsewhere. A failed import only prints a warning, so `npm install` still succeeds. [[Configuration and Browser Download]] lists every setting that changes this step.

Sources: [packages/puppeteer/package.json:40-41](repo://packages/puppeteer/package.json#L40-L41), [packages/puppeteer/install.mjs:22-43](repo://packages/puppeteer/install.mjs#L22-L43), [packages/puppeteer/src/node/install.ts:67-133](repo://packages/puppeteer/src/node/install.ts#L67-L133), [packages/puppeteer/src/getConfiguration.ts:146-158](repo://packages/puppeteer/src/getConfiguration.ts#L146-L158)

`puppeteer-core` has no install step. Point `launch()` at a browser with the `executablePath` option, or connect to one that is already running, as [[Connecting to a Browser and Transports]] shows.

Sources: [packages/puppeteer-core/src/puppeteer-core.ts:14-48](repo://packages/puppeteer-core/src/puppeteer-core.ts#L14-L48)

## A first script

The repository's own example launches a browser, opens a tab, navigates and writes a screenshot:

Sources: [examples/screenshot.js:9-17](repo://examples/screenshot.js#L9-L17)

```js
const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.goto('https://example.com');
  await page.screenshot({path: 'example.png'});
  await browser.close();
})();
```

Sources: [examples/screenshot.js:9-17](repo://examples/screenshot.js#L9-L17)

Each line maps to one part of the library:

Sources: [examples/screenshot.js:11-17](repo://examples/screenshot.js#L11-L17), [packages/puppeteer-core/src/node/BrowserLauncher.ts:116-154](repo://packages/puppeteer-core/src/node/BrowserLauncher.ts#L116-L154)

1. `puppeteer.launch()` starts a headless Chrome and returns a `Browser`; [[Launching Browsers]] follows it step by step.
2. `browser.newPage()` opens a tab in the default browser context and returns a `Page` ([[Browsers, Browser Contexts and Targets]]).
3. `page.goto()` navigates the main frame and resolves when the `load` event fires ([[Frames and Navigation]]).
4. `page.screenshot()` captures the viewport ([[Screenshots, PDFs and Screen Recording]]).
5. `browser.close()` closes the browser process and removes its temporary profile.

Sources: [examples/screenshot.js:11-17](repo://examples/screenshot.js#L11-L17), [packages/puppeteer-core/src/node/BrowserLauncher.ts:116-154](repo://packages/puppeteer-core/src/node/BrowserLauncher.ts#L116-L154)

## Interact with the page

Locators find an element, wait until it can take the action, and retry when the page changes underneath them. The README's example fills a search box found by its accessible name, clicks a result and reads text from an element matched by its content:

Sources: [README.md:24-54](repo://README.md#L24-L54)

```ts
import puppeteer from 'puppeteer';
// Or import puppeteer from 'puppeteer-core';

// Launch the browser and open a new blank page
const browser = await puppeteer.launch();
const page = await browser.newPage();

// Navigate the page to a URL.
await page.goto('https://developer.chrome.com/');

// Set screen size.
await page.setViewport({width: 1080, height: 1024});

// Type into search box using accessible input name.
await page.locator('aria/Search').fill('automate beyond recorder');

// Wait and click on first result.
await page.locator('.devsite-result-item-link').click();

// Locate the full title with a unique string.
const textSelector = await page
  .locator('text/Customize and automate')
  .waitHandle();
const fullTitle = await textSelector?.evaluate(el => el.textContent);

// Print the full title.
console.log('The title of this blog post is "%s".', fullTitle);

await browser.close();
```

Sources: [README.md:24-54](repo://README.md#L24-L54)

The `aria/` and `text/` prefixes pick a query handler other than CSS ([[Selectors and Query Handlers]]). `fill` and `click` are locator actions with built-in waiting ([[Locators]]), and `evaluate` runs a function inside the page against the element handle ([[JavaScript Evaluation and Handles]]).

Sources: [README.md:38-48](repo://README.md#L38-L48)

The older handle-based style still works: `page.type`, `page.waitForSelector`, `page.click` and `page.evaluate` take a selector each time and do not retry.

Sources: [examples/search.js:39-45](repo://examples/search.js#L39-L45)

```js
await page.type('.devsite-search-field', 'Headless Chrome');
const allResultsSelector = '.devsite-suggest-all-results';
await page.waitForSelector(allResultsSelector);
await page.click(allResultsSelector);
```

Sources: [examples/search.js:39-45](repo://examples/search.js#L39-L45)

## Use Firefox or WebDriver BiDi

Pass `browser: 'firefox'` to `launch()` to drive Firefox, which always speaks WebDriver BiDi, or pass `protocol: 'webDriverBiDi'` to drive Chrome over BiDi instead of CDP. Firefox is not downloaded by default: install it first with `npx puppeteer browsers install firefox`.

Sources: [examples/webdriver-bidi.mjs:7-20](repo://examples/webdriver-bidi.mjs#L7-L20), [packages/puppeteer-core/src/node/BrowserLauncher.ts:92-101](repo://packages/puppeteer-core/src/node/BrowserLauncher.ts#L92-L101), [packages/puppeteer-core/src/node/BrowserLauncher.ts:492-498](repo://packages/puppeteer-core/src/node/BrowserLauncher.ts#L492-L498)

```js
import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({
  protocol: 'webDriverBiDi',
});
const page = await browser.newPage();
await page.goto('https://pptr.dev');

await page.pdf({
  path: 'pptr.pdf',
  format: 'letter',
});

await browser.close();
```

Sources: [examples/webdriver-bidi.mjs:7-20](repo://examples/webdriver-bidi.mjs#L7-L20), [packages/puppeteer-core/src/node/BrowserLauncher.ts:92-101](repo://packages/puppeteer-core/src/node/BrowserLauncher.ts#L92-L101), [packages/puppeteer-core/src/node/BrowserLauncher.ts:492-498](repo://packages/puppeteer-core/src/node/BrowserLauncher.ts#L492-L498)

## Run the repository examples

The `examples` folder runs against a local build. Install the dependencies, build, then run a script with `NODE_PATH` pointing at the repository so `require('puppeteer')` resolves to the build:

Sources: [examples/README.md:6-24](repo://examples/README.md#L6-L24)

```bash
npm install
npm run build
NODE_PATH=../ node examples/search.js
```

Sources: [examples/README.md:6-24](repo://examples/README.md#L6-L24)

`block-images.js` shows request interception: it calls `setRequestInterception(true)`, aborts every request whose `resourceType()` is `image`, continues the rest, and takes a full-page screenshot. [[Network Requests and Interception]] explains what each of those calls does.

Sources: [examples/block-images.js:19-35](repo://examples/block-images.js#L19-L35)
