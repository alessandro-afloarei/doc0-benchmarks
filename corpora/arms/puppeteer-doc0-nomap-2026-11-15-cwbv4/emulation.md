---
title: "Emulation"
---
## Overview

Emulation makes a page behave as if it ran on another device or in another environment: a phone-sized touch screen, a dark colour scheme, a slow CPU or network, another time zone or location, or a user with a vision deficiency. Each feature is a `Page` method. On CDP, most of them go through `EmulationManager`, which stores every setting as state and pushes it to every CDP session that belongs to the page, including sessions that appear later. Network throttling belongs to the network manager ([[Network Requests and Interception]]).

Sources: [packages/puppeteer-core/src/cdp/EmulationManager.ts:117-228](repo://packages/puppeteer-core/src/cdp/EmulationManager.ts#L117-L228), [packages/puppeteer-core/src/cdp/Page.ts:941-985](repo://packages/puppeteer-core/src/cdp/Page.ts#L941-L985)

## Emulation features

### Methods and protocol commands

| Page method | Validation | CDP command |
| --- | --- | --- |
| `setViewport(viewport)` | none | `Emulation.setDeviceMetricsOverride` and `Emulation.setTouchEmulationEnabled`; `null` clears both |
| `emulate(device)` | none | `setUserAgent` plus `setViewport` |
| `emulateMediaType(type)` | Only `screen`, `print` or nothing | `Emulation.setEmulatedMedia` with `media` |
| `emulateMediaFeatures(features)` | Only `prefers-color-scheme`, `prefers-reduced-motion`, `color-gamut` | `Emulation.setEmulatedMedia` with `features` |
| `emulateTimezone(id)` | Invalid ids throw `Invalid timezone ID` | `Emulation.setTimezoneOverride` |
| `emulateCPUThrottling(factor)` | `factor` ≥ 1 or `null` | `Emulation.setCPUThrottlingRate` |
| `emulateIdleState(overrides?)` | none | `Emulation.setIdleOverride`, or `clearIdleOverride` without overrides |
| `emulateVisionDeficiency(type)` | One of `achromatopsia`, `blurredVision`, `deuteranopia`, `protanopia`, `reducedContrast`, `tritanopia`, `none` | `Emulation.setEmulatedVisionDeficiency` |
| `setGeolocation({latitude, longitude, accuracy})` | Range checks on all three | `Emulation.setGeolocationOverride` |
| `setJavaScriptEnabled(bool)` | none | `Emulation.setScriptExecutionDisabled` |

Sources: [packages/puppeteer-core/src/cdp/EmulationManager.ts:234-258](repo://packages/puppeteer-core/src/cdp/EmulationManager.ts#L234-L258), [packages/puppeteer-core/src/cdp/EmulationManager.ts:309-317](repo://packages/puppeteer-core/src/cdp/EmulationManager.ts#L309-L317), [packages/puppeteer-core/src/cdp/EmulationManager.ts:357-399](repo://packages/puppeteer-core/src/cdp/EmulationManager.ts#L357-L399), [packages/puppeteer-core/src/cdp/EmulationManager.ts:414-480](repo://packages/puppeteer-core/src/cdp/EmulationManager.ts#L414-L480), [packages/puppeteer-core/src/cdp/EmulationManager.ts:502-527](repo://packages/puppeteer-core/src/cdp/EmulationManager.ts#L502-L527), [packages/puppeteer-core/src/cdp/EmulationManager.ts:562-580](repo://packages/puppeteer-core/src/cdp/EmulationManager.ts#L562-L580), [packages/puppeteer-core/src/api/Page.ts:2032-2037](repo://packages/puppeteer-core/src/api/Page.ts#L2032-L2037)

Calling a method without arguments resets that feature: no media type, no media features, the default time zone, a CPU rate of 1, or `none` for vision deficiency.

Sources: [packages/puppeteer-core/src/cdp/EmulationManager.ts:337-375](repo://packages/puppeteer-core/src/cdp/EmulationManager.ts#L337-L375), [packages/puppeteer-core/src/cdp/EmulationManager.ts:401-436](repo://packages/puppeteer-core/src/cdp/EmulationManager.ts#L401-L436), [packages/puppeteer-core/src/cdp/EmulationManager.ts:456-480](repo://packages/puppeteer-core/src/cdp/EmulationManager.ts#L456-L480)

`setBypassCSP` and `setBypassServiceWorker` are page settings sent directly to the page's main session (`Page.setBypassCSP`, `Network.setBypassServiceWorker`), not stored in the emulation manager.

Sources: [packages/puppeteer-core/src/cdp/Page.ts:537-543](repo://packages/puppeteer-core/src/cdp/Page.ts#L537-L543), [packages/puppeteer-core/src/cdp/Page.ts:944-946](repo://packages/puppeteer-core/src/cdp/Page.ts#L944-L946)

### The viewport

A `Viewport` has `width` and `height` in CSS pixels and optional `deviceScaleFactor` (default 1; `0` resets to the system default), `isMobile` (honours the meta viewport tag), `isLandscape` and `hasTouch`. The manager turns it into a device-metrics override with a screen orientation of 90° landscape or 0° portrait, and enables touch emulation to match `hasTouch`. A target that does not support metrics overrides only logs the error.

Sources: [packages/puppeteer-core/src/common/Viewport.ts:10-50](repo://packages/puppeteer-core/src/common/Viewport.ts#L10-L50), [packages/puppeteer-core/src/cdp/EmulationManager.ts:260-307](repo://packages/puppeteer-core/src/cdp/EmulationManager.ts#L260-L307)

`setViewport` reloads the page when `isMobile` or `hasTouch` changes. `emulateViewport` returns whether a reload is needed by comparing the flags with the previous ones.

Sources: [packages/puppeteer-core/src/cdp/EmulationManager.ts:234-258](repo://packages/puppeteer-core/src/cdp/EmulationManager.ts#L234-L258), [packages/puppeteer-core/src/cdp/Page.ts:979-985](repo://packages/puppeteer-core/src/cdp/Page.ts#L979-L985)

Every new page starts with the browser's `defaultViewport` (800×600 unless the launch or connect options say otherwise). `CdpPage._create` applies it right after initialisation and ignores the error if the target closed meanwhile. Passing `defaultViewport: null` keeps the window's own size.

Sources: [packages/puppeteer-core/src/cdp/Page.ts:99-118](repo://packages/puppeteer-core/src/cdp/Page.ts#L99-L118), [packages/puppeteer-core/src/common/ConnectOptions.ts:61-66](repo://packages/puppeteer-core/src/common/ConnectOptions.ts#L61-L66)

### Devices

`KnownDevices` is a frozen map from device name to `{userAgent, viewport}`, built from a long list of phones and tablets in `Device.ts`. `page.emulate(device)` sets both at once:

Sources: [packages/puppeteer-core/src/common/Device.ts:1723-1753](repo://packages/puppeteer-core/src/common/Device.ts#L1723-L1753), [packages/puppeteer-core/src/common/Device.ts:11-30](repo://packages/puppeteer-core/src/common/Device.ts#L11-L30)

```ts
import {KnownDevices} from 'puppeteer';
const iPhone = KnownDevices['iPhone 15 Pro'];

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.emulate(iPhone);
  await page.goto('https://www.google.com');
  // other actions...
  await browser.close();
})();
```

Sources: [packages/puppeteer-core/src/common/Device.ts:1723-1753](repo://packages/puppeteer-core/src/common/Device.ts#L1723-L1753), [packages/puppeteer-core/src/common/Device.ts:11-30](repo://packages/puppeteer-core/src/common/Device.ts#L11-L30)

### Network conditions

`page.emulateNetworkConditions({download, upload, latency})` throttles the page's network through `Network.emulateNetworkConditions`; `null` turns throttling off. `PredefinedNetworkConditions` offers presets aligned with DevTools:

Sources: [packages/puppeteer-core/src/cdp/PredefinedNetworkConditions.ts:43-80](repo://packages/puppeteer-core/src/cdp/PredefinedNetworkConditions.ts#L43-L80), [packages/puppeteer-core/src/cdp/NetworkManager.ts:205-254](repo://packages/puppeteer-core/src/cdp/NetworkManager.ts#L205-L254)

| Preset | Download | Upload | Latency |
| --- | --- | --- | --- |
| `Slow 3G` | ~500 kbps | ~500 kbps | 2000 ms |
| `Fast 3G` | ~1.6 Mbps | ~750 kbps | 562.5 ms |
| `Slow 4G` | same as `Fast 3G` | same as `Fast 3G` | 562.5 ms |
| `Fast 4G` | ~9 Mbps | ~1.5 Mbps | 165 ms |

Sources: [packages/puppeteer-core/src/cdp/PredefinedNetworkConditions.ts:43-80](repo://packages/puppeteer-core/src/cdp/PredefinedNetworkConditions.ts#L43-L80), [packages/puppeteer-core/src/cdp/NetworkManager.ts:205-254](repo://packages/puppeteer-core/src/cdp/NetworkManager.ts#L205-L254)

Throttling does not affect WebSockets and WebRTC connections. `setOfflineMode` sets the separate `offline` flag of the same conditions object, so going offline keeps the configured throughput values.

Sources: [packages/puppeteer-core/src/api/Page.ts:990-1024](repo://packages/puppeteer-core/src/api/Page.ts#L990-L1024), [packages/puppeteer-core/src/cdp/NetworkManager.ts:192-203](repo://packages/puppeteer-core/src/cdp/NetworkManager.ts#L192-L203)

## How the EmulationManager keeps sessions in sync

### State objects

Each feature is an `EmulatedState`: a value with an `active` flag, a reference to the manager, and an updater function that sends the protocol command for one session. The state registers itself with the manager when it is created. `setState(state)` stores the value and calls `sync()`, which runs the updater for every client the manager reports. Updaters return early while `active` is false, so a feature the user never touched sends nothing.

Sources: [packages/puppeteer-core/src/cdp/EmulationManager.ts:72-112](repo://packages/puppeteer-core/src/cdp/EmulationManager.ts#L72-L112), [packages/puppeteer-core/src/cdp/EmulationManager.ts:125-195](repo://packages/puppeteer-core/src/cdp/EmulationManager.ts#L125-L195)

### Sessions it manages

`clients()` returns the page's primary session plus a set of secondary sessions. When a prerender target attaches to the page, `CdpPage` calls `registerSpeculativeSession`, which adds the session and immediately re-syncs every state without awaiting. All commands are queued before the prerendered target is resumed, so a prerendered page already has the emulated viewport, time zone and so on when it is activated. When the prerendered page becomes the primary target, `updateClient` makes it the primary session and removes it from the secondary set.

Sources: [packages/puppeteer-core/src/cdp/EmulationManager.ts:197-228](repo://packages/puppeteer-core/src/cdp/EmulationManager.ts#L197-L228), [packages/puppeteer-core/src/cdp/Page.ts:278-287](repo://packages/puppeteer-core/src/cdp/Page.ts#L278-L287)

### Avoiding duplicate commands

Every updater carries the `@invokeAtMostOnceForArguments` decorator. It memoizes calls in nested `WeakMap`s keyed by the argument objects, here the session and the state object. Calling the updater again with the same session and the same state object does nothing. A `sync()` that reaches a session already up to date is free, and only `setState`, which creates a new state object, causes new commands.

Sources: [packages/puppeteer-core/src/util/decorators.ts:88-119](repo://packages/puppeteer-core/src/util/decorators.ts#L88-L119), [packages/puppeteer-core/src/cdp/EmulationManager.ts:260-264](repo://packages/puppeteer-core/src/cdp/EmulationManager.ts#L260-L264)

### Background colour for screenshots

The manager also owns a default-background-colour state used by screenshots: `setTransparentBackgroundColor()` sets an RGBA of all zeros for `omitBackground`, and `resetDefaultBackgroundColor()` clears the override afterwards ([[Screenshots, PDFs and Screen Recording]]).

Sources: [packages/puppeteer-core/src/cdp/EmulationManager.ts:529-560](repo://packages/puppeteer-core/src/cdp/EmulationManager.ts#L529-L560), [packages/puppeteer-core/src/cdp/Page.ts:1027-1035](repo://packages/puppeteer-core/src/cdp/Page.ts#L1027-L1035)
