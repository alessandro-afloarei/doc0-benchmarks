---
title: "Dialogs, File Choosers and Device Prompts"
---
## Overview

Some page actions open browser UI that page scripts cannot dismiss: JavaScript dialogs (`alert`, `confirm`, `prompt`, `beforeunload`), the native file picker, and the device chooser of APIs such as Web Bluetooth. Puppeteer turns each into an object with a one-shot answer method. Dialogs arrive as a page event. File choosers and device prompts are explicit waits that also switch on the protocol interception that makes them observable.

Sources: [packages/puppeteer-core/src/api/Dialog.ts:10-35](repo://packages/puppeteer-core/src/api/Dialog.ts#L10-L35), [packages/puppeteer-core/src/common/FileChooser.ts:10-32](repo://packages/puppeteer-core/src/common/FileChooser.ts#L10-L32), [packages/puppeteer-core/src/cdp/DeviceRequestPrompt.ts:39-62](repo://packages/puppeteer-core/src/cdp/DeviceRequestPrompt.ts#L39-L62)

| Prompt | How you get it | Answer | Backends |
| --- | --- | --- | --- |
| `Dialog` | `page.on('dialog', …)` | `accept(text?)` or `dismiss()` | CDP and BiDi |
| `FileChooser` | `page.waitForFileChooser()` before the click | `accept(paths)` or `cancel()` | CDP and BiDi |
| `DeviceRequestPrompt` | `page.waitForDevicePrompt()` before the request | `select(device)` or `cancel()` | CDP only |

Sources: [packages/puppeteer-core/src/api/Page.ts:847-849](repo://packages/puppeteer-core/src/api/Page.ts#L847-L849), [packages/puppeteer-core/src/api/Page.ts:3132-3134](repo://packages/puppeteer-core/src/api/Page.ts#L3132-L3134), [packages/puppeteer-core/src/bidi/Page.ts:945-947](repo://packages/puppeteer-core/src/bidi/Page.ts#L945-L947)

## Dialogs

### Handling a dialog

A `Dialog` carries `type()` (`alert`, `confirm`, `prompt` or `beforeunload`), `message()` and, for prompts, `defaultValue()`. `accept(promptText?)` confirms it, with the text for a `prompt`, and `dismiss()` cancels it. Answering twice fails an assertion: `Cannot accept dialog which is already handled!`.

Sources: [packages/puppeteer-core/src/api/Dialog.ts:35-113](repo://packages/puppeteer-core/src/api/Dialog.ts#L35-L113)

```ts
page.on('dialog', async dialog => {
  console.log(dialog.message());
  await dialog.dismiss();
  await browser.close();
});
page.evaluate(() => alert('1'));
```

Sources: [packages/puppeteer-core/src/api/Dialog.ts:22-28](repo://packages/puppeteer-core/src/api/Dialog.ts#L22-L28)

### CDP and BiDi implementations

On CDP, `CdpPage` listens for `Page.javascriptDialogOpening`, validates the type, and emits a `CdpDialog`; answering sends `Page.handleJavaScriptDialog` with `accept` and `promptText`.

Sources: [packages/puppeteer-core/src/cdp/Page.ts:875-884](repo://packages/puppeteer-core/src/cdp/Page.ts#L875-L884), [packages/puppeteer-core/src/cdp/Dialog.ts:15-37](repo://packages/puppeteer-core/src/cdp/Dialog.ts#L15-L37)

On BiDi, each frame's browsing context emits `userprompt` with a core `UserPrompt` object ([[WebDriver BiDi Core Layer]]), and the frame emits a `BidiDialog` wrapping it. Answering sends `browsingContext.handleUserPrompt` with `accept` and `userText`. A prompt that the session already handles automatically (an `accept` or `dismiss` user-prompt handler) starts out as handled, so calling `accept` on it fails the assertion. A prompt whose browsing context closed throws its close reason when handled.

Sources: [packages/puppeteer-core/src/bidi/Frame.ts:164-169](repo://packages/puppeteer-core/src/bidi/Frame.ts#L164-L169), [packages/puppeteer-core/src/bidi/Dialog.ts:11-32](repo://packages/puppeteer-core/src/bidi/Dialog.ts#L11-L32), [packages/puppeteer-core/src/bidi/core/UserPrompt.ts:68-137](repo://packages/puppeteer-core/src/bidi/core/UserPrompt.ts#L68-L137)

## File choosers

### Waiting for the picker

`page.waitForFileChooser()` intercepts the file picker that an `<input type="file">` opens. Start the wait before the click:

Sources: [packages/puppeteer-core/src/common/FileChooser.ts:10-31](repo://packages/puppeteer-core/src/common/FileChooser.ts#L10-L31)

```ts
const [fileChooser] = await Promise.all([
  page.waitForFileChooser(),
  page.click('#upload-file-button'), // some button that triggers file selection
]);
await fileChooser.accept(['/tmp/myfile.pdf']);
```

Sources: [packages/puppeteer-core/src/common/FileChooser.ts:10-31](repo://packages/puppeteer-core/src/common/FileChooser.ts#L10-L31)

On CDP the first pending wait enables `Page.setInterceptFileChooserDialog`. When `Page.fileChooserOpened` arrives, the page adopts the input element (from its backend node id) into the frame's main world, builds one `FileChooser` with `isMultiple()` set unless the mode is `selectSingle`, and resolves every pending wait with it. Each wait has its own timeout (default: the page's timeout, failing with ``Waiting for `FileChooser` failed``) and an optional abort signal. An event with no pending wait is ignored.

Sources: [packages/puppeteer-core/src/cdp/Page.ts:380-403](repo://packages/puppeteer-core/src/cdp/Page.ts#L380-L403), [packages/puppeteer-core/src/cdp/Page.ts:421-461](repo://packages/puppeteer-core/src/cdp/Page.ts#L421-L461)

On BiDi the page listens once for the browsing context's `filedialogopened` event and wraps the reported element the same way.

Sources: [packages/puppeteer-core/src/bidi/Page.ts:619-660](repo://packages/puppeteer-core/src/bidi/Page.ts#L619-L660)

### Answering

`accept(paths)` calls `uploadFile(...paths)` on the input element ([[Element Handles]]); `cancel()` dispatches a bubbling `cancel` event on it. Either can be called only once. Only one file chooser can be open at a time in a browser, and a chooser that is neither accepted nor cancelled prevents later ones from appearing.

Sources: [packages/puppeteer-core/src/common/FileChooser.ts:15-18](repo://packages/puppeteer-core/src/common/FileChooser.ts#L15-L18), [packages/puppeteer-core/src/common/FileChooser.ts:63-86](repo://packages/puppeteer-core/src/common/FileChooser.ts#L63-L86)

## Device request prompts

### Waiting for the prompt

APIs such as Web Bluetooth ask the user to pick a device. `page.waitForDevicePrompt()` (or the same method on a frame) returns a `DeviceRequestPrompt` when the page makes such a request:

Sources: [packages/puppeteer-core/src/cdp/DeviceRequestPrompt.ts:39-61](repo://packages/puppeteer-core/src/cdp/DeviceRequestPrompt.ts#L39-L61)

```ts
const [devicePrompt] = Promise.all([
  page.waitForDevicePrompt(),
  page.click('#connect-bluetooth'),
]);
await devicePrompt.select(
  await devicePrompt.waitForDevice(({name}) => name.includes('My Device')),
);
```

Sources: [packages/puppeteer-core/src/cdp/DeviceRequestPrompt.ts:39-61](repo://packages/puppeteer-core/src/cdp/DeviceRequestPrompt.ts#L39-L61)

A `DeviceRequestPromptManager` exists per CDP session and is obtained from the frame manager. Its first pending wait sends `DeviceAccess.enable`. On `DeviceAccess.deviceRequestPrompted` it creates one `DeviceRequestPrompt` and resolves every pending wait with it. Waits time out with ``Waiting for `DeviceRequestPrompt` failed`` and accept an abort signal; waiting through a detached session fails an assertion.

Sources: [packages/puppeteer-core/src/cdp/DeviceRequestPrompt.ts:215-301](repo://packages/puppeteer-core/src/cdp/DeviceRequestPrompt.ts#L215-L301), [packages/puppeteer-core/src/cdp/Frame.ts:320-322](repo://packages/puppeteer-core/src/cdp/Frame.ts#L320-L322), [packages/puppeteer-core/src/cdp/Frame.ts:377-383](repo://packages/puppeteer-core/src/cdp/Frame.ts#L377-L383)

### Devices and the answer

The browser can report devices across several events. The prompt keeps listening to `deviceRequestPrompted` events with its own id and appends each new device (by id) to `devices`. `waitForDevice(filter)` returns a matching known device at once, or waits for the first new device that matches, with the same timeout and signal handling.

Sources: [packages/puppeteer-core/src/cdp/DeviceRequestPrompt.ts:81-165](repo://packages/puppeteer-core/src/cdp/DeviceRequestPrompt.ts#L81-L165)

`select(device)` sends `DeviceAccess.selectPrompt` and `cancel()` sends `DeviceAccess.cancelPrompt`. Both stop listening for device updates and can be called once. `select` also asserts that the device came from this prompt, and both fail when the session has detached.

Sources: [packages/puppeteer-core/src/cdp/DeviceRequestPrompt.ts:170-209](repo://packages/puppeteer-core/src/cdp/DeviceRequestPrompt.ts#L170-L209)

Over WebDriver BiDi, `waitForDevicePrompt` throws `UnsupportedOperation`.

Sources: [packages/puppeteer-core/src/bidi/Page.ts:945-947](repo://packages/puppeteer-core/src/bidi/Page.ts#L945-L947)
