---
title: "Code Coverage and Tracing"
---
## Overview

Two page tools measure what a page does rather than what it shows. `page.coverage` records which bytes of each JavaScript file and stylesheet were used, and `page.tracing` records a Chrome performance trace that DevTools can open. Both are thin wrappers over CDP domains (`Profiler`, `Debugger` and `CSS` for coverage, `Tracing` and `IO` for traces) bound to the page's main session. They follow the session when the page swaps targets, through `updateClient`. `BidiPage` creates the same two classes over its main frame's CDP session.

Sources: [packages/puppeteer-core/src/cdp/Coverage.ts:118-187](repo://packages/puppeteer-core/src/cdp/Coverage.ts#L118-L187), [packages/puppeteer-core/src/cdp/Tracing.ts:40-57](repo://packages/puppeteer-core/src/cdp/Tracing.ts#L40-L57), [packages/puppeteer-core/src/cdp/Page.ts:268-273](repo://packages/puppeteer-core/src/cdp/Page.ts#L268-L273), [packages/puppeteer-core/src/bidi/Page.ts:98-119](repo://packages/puppeteer-core/src/bidi/Page.ts#L98-L119)

## Coverage

### Usage

`Coverage` delegates to a `JSCoverage` and a `CSSCoverage` object, which can run independently or together. Each `stop` returns entries of `{url, text, ranges}`, where `ranges` are the used character ranges of `text`. The class's own example computes the share of bytes used on page load:

Sources: [packages/puppeteer-core/src/cdp/Coverage.ts:80-117](repo://packages/puppeteer-core/src/cdp/Coverage.ts#L80-L117), [packages/puppeteer-core/src/cdp/Coverage.ts:19-32](repo://packages/puppeteer-core/src/cdp/Coverage.ts#L19-L32)

```ts
// Enable both JavaScript and CSS coverage
await Promise.all([
  page.coverage.startJSCoverage(),
  page.coverage.startCSSCoverage(),
]);
// Navigate to page
await page.goto('https://example.com');
// Disable both JavaScript and CSS coverage
const [jsCoverage, cssCoverage] = await Promise.all([
  page.coverage.stopJSCoverage(),
  page.coverage.stopCSSCoverage(),
]);
let totalBytes = 0;
let usedBytes = 0;
const coverage = [...jsCoverage, ...cssCoverage];
for (const entry of coverage) {
  totalBytes += entry.text.length;
  for (const range of entry.ranges) usedBytes += range.end - range.start - 1;
}
console.log(`Bytes used: ${(usedBytes / totalBytes) * 100}%`);
```

Sources: [packages/puppeteer-core/src/cdp/Coverage.ts:80-117](repo://packages/puppeteer-core/src/cdp/Coverage.ts#L80-L117), [packages/puppeteer-core/src/cdp/Coverage.ts:19-32](repo://packages/puppeteer-core/src/cdp/Coverage.ts#L19-L32)

### JavaScript coverage

| Option | Default | Effect |
| --- | --- | --- |
| `resetOnNavigation` | `true` | Forget collected scripts when the page's execution contexts are cleared |
| `reportAnonymousScripts` | `false` | Include scripts without a URL, named `debugger://VM<id>` |
| `includeRawScriptCoverage` | `false` | Add V8's raw per-function data (with call counts) as `rawScriptCoverage` |
| `useBlockCoverage` | `true` | Block-level instead of function-level granularity |

Sources: [packages/puppeteer-core/src/cdp/Coverage.ts:38-68](repo://packages/puppeteer-core/src/cdp/Coverage.ts#L38-L68), [packages/puppeteer-core/src/cdp/Coverage.ts:216-255](repo://packages/puppeteer-core/src/cdp/Coverage.ts#L216-L255)

`start` enables the profiler and debugger, starts precise coverage (`callCount` from `includeRawScriptCoverage`, `detailed` from `useBlockCoverage`), and sets the debugger to skip all pauses. For each `Debugger.scriptParsed` event it fetches the source with `Debugger.getScriptSource` and keeps the URL and text. Scripts with a `pptr:` URL, which are Puppeteer's own evaluations, are ignored, as are anonymous scripts unless requested ([[JavaScript Evaluation and Handles]]).

Sources: [packages/puppeteer-core/src/cdp/Coverage.ts:237-286](repo://packages/puppeteer-core/src/cdp/Coverage.ts#L237-L286)

`stop` takes the precise coverage, stops and disables the profiler and debugger, and builds one entry per script it has source for. V8 reports nested ranges per function with counts; they are flattened and passed through `convertToDisjointRanges`.

Sources: [packages/puppeteer-core/src/cdp/Coverage.ts:288-325](repo://packages/puppeteer-core/src/cdp/Coverage.ts#L288-L325)

### CSS coverage

`startCSSCoverage({resetOnNavigation})` enables the DOM and CSS domains and starts rule usage tracking. Each `CSS.styleSheetAdded` with a `sourceURL` has its text fetched; inline stylesheets without one are skipped. `stop` ends tracking, groups the used and unused rules by stylesheet as ranges with count 1 or 0, and converts them with the same function. Every stylesheet it saw is reported, even one with no used rules.

Sources: [packages/puppeteer-core/src/cdp/Coverage.ts:350-446](repo://packages/puppeteer-core/src/cdp/Coverage.ts#L350-L446)

### Merging nested ranges

Coverage data arrives as nested ranges: an outer function range with a count, and inner block ranges with their own counts. A block not executed inside an executed function has count 0. `convertToDisjointRanges` turns this into a flat list of used ranges with a sweep line:

Sources: [packages/puppeteer-core/src/cdp/Coverage.ts:449-508](repo://packages/puppeteer-core/src/cdp/Coverage.ts#L449-L508)

1. Turn every range into a start point and an end point.
2. Sort by offset. At equal offsets, ends come before starts, a longer range starts first and a shorter range ends first, so the points nest like parentheses.
3. Walk the points with a stack of counts. Between two consecutive offsets, the innermost range (top of the stack) decides: if its count is above zero, that span is used and is appended, or merged with the previous span when they touch.
4. Drop empty spans.

Sources: [packages/puppeteer-core/src/cdp/Coverage.ts:449-508](repo://packages/puppeteer-core/src/cdp/Coverage.ts#L449-L508)

Starting a coverage that is already running, or stopping one that is not, fails an assertion.

Sources: [packages/puppeteer-core/src/cdp/Coverage.ts:224-224](repo://packages/puppeteer-core/src/cdp/Coverage.ts#L224-L224), [packages/puppeteer-core/src/cdp/Coverage.ts:289-289](repo://packages/puppeteer-core/src/cdp/Coverage.ts#L289-L289), [packages/puppeteer-core/src/cdp/Coverage.ts:351-351](repo://packages/puppeteer-core/src/cdp/Coverage.ts#L351-L351), [packages/puppeteer-core/src/cdp/Coverage.ts:401-401](repo://packages/puppeteer-core/src/cdp/Coverage.ts#L401-L401)

## Tracing

### Recording a trace

`page.tracing.start({path, screenshots, categories})` starts a trace, and `page.tracing.stop()` returns its JSON as a `Uint8Array` and writes it to `path` if one was given. The file can be opened in Chrome DevTools or the timeline viewer:

Sources: [packages/puppeteer-core/src/cdp/Tracing.ts:23-38](repo://packages/puppeteer-core/src/cdp/Tracing.ts#L23-L38), [packages/puppeteer-core/src/cdp/Tracing.ts:18-22](repo://packages/puppeteer-core/src/cdp/Tracing.ts#L18-L22)

```ts
await page.tracing.start({path: 'trace.json'});
await page.goto('https://www.google.com');
await page.tracing.stop();
```

Sources: [packages/puppeteer-core/src/cdp/Tracing.ts:23-38](repo://packages/puppeteer-core/src/cdp/Tracing.ts#L23-L38), [packages/puppeteer-core/src/cdp/Tracing.ts:18-22](repo://packages/puppeteer-core/src/cdp/Tracing.ts#L18-L22)

### Categories

Without `categories`, Puppeteer uses a default timeline set: it excludes everything (`-*`) and includes `devtools.timeline`, `v8.execute`, `toplevel`, `blink.console`, `blink.user_timing`, `latencyInfo` and the disabled-by-default timeline, frame, stack and CPU-profiler categories. Categories starting with `-` are sent as excluded, the rest as included. `screenshots: true` adds `disabled-by-default-devtools.screenshot` to the list, appending it to the array that was passed in.

Sources: [packages/puppeteer-core/src/cdp/Tracing.ts:66-110](repo://packages/puppeteer-core/src/cdp/Tracing.ts#L66-L110)

### Reading the trace

`start` asks for `transferMode: 'ReturnAsStream'`. `stop` registers a one-time listener for `Tracing.tracingComplete` before sending `Tracing.end`. When the event arrives, it wraps the stream handle with `getReadableFromProtocolStream`, a web `ReadableStream` that pulls chunks with `IO.read` and calls `IO.close` at the end. It then collects the chunks with `getReadableAsTypedArray`, writing each one to `path` as it arrives. The same stream helpers carry `page.pdf()` output ([[Screenshots, PDFs and Screen Recording]]).

Sources: [packages/puppeteer-core/src/cdp/Tracing.ts:117-139](repo://packages/puppeteer-core/src/cdp/Tracing.ts#L117-L139), [packages/puppeteer-core/src/common/util.ts:197-262](repo://packages/puppeteer-core/src/common/util.ts#L197-L262)

Only one trace can run per page: a second `start` fails with `Cannot start recording trace while already recording trace.`

Sources: [packages/puppeteer-core/src/cdp/Tracing.ts:66-70](repo://packages/puppeteer-core/src/cdp/Tracing.ts#L66-L70)
