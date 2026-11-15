---
title: "Keyboard, Mouse and Touch"
---
## Overview

Every page has three virtual input devices: `page.keyboard`, `page.mouse` and `page.touchscreen`. The abstract classes in `api/Input.ts` define the API, and the CDP classes `CdpKeyboard`, `CdpMouse` and `CdpTouchscreen` turn each call into `Input.dispatchKeyEvent`, `Input.dispatchMouseEvent`, `Input.dispatchTouchEvent` or `Input.dispatchDragEvent` commands. Element actions such as `click` and `type` compute a point and then call these devices ([[Element Handles]]).

Sources: [packages/puppeteer-core/src/api/Input.ts:82-201](repo://packages/puppeteer-core/src/api/Input.ts#L82-L201), [packages/puppeteer-core/src/cdp/Input.ts:40-81](repo://packages/puppeteer-core/src/cdp/Input.ts#L40-L81)

The mouse and the touchscreen share the keyboard's modifier state: each mouse, drag and touch command carries `this.#keyboard._modifiers`, so holding `Shift` with `keyboard.down('Shift')` turns a click into a shift-click.

Sources: [packages/puppeteer-core/src/cdp/Input.ts:273-281](repo://packages/puppeteer-core/src/cdp/Input.ts#L273-L281), [packages/puppeteer-core/src/cdp/Input.ts:374-380](repo://packages/puppeteer-core/src/cdp/Input.ts#L374-L380), [packages/puppeteer-core/src/cdp/Input.ts:584-588](repo://packages/puppeteer-core/src/cdp/Input.ts#L584-L588)

## Keyboard

### Keys and the US layout

Keys are named by `KeyInput`, a union of every name in `_keyDefinitions`: physical codes such as `KeyA` and `ArrowLeft`, key values such as `Enter`, and single characters such as `a` or `\n`. Each `KeyDefinition` gives the Windows key code, the `code`, the `key`, the text it types, and the shifted variants (`shiftKey`, `shiftKeyCode`, `shiftText`). `Enter`, `\r` and `\n` all map to the Enter key typing `\r`.

Sources: [packages/puppeteer-core/src/common/USKeyboardLayout.ts:10-19](repo://packages/puppeteer-core/src/common/USKeyboardLayout.ts#L10-L19), [packages/puppeteer-core/src/common/USKeyboardLayout.ts:287-321](repo://packages/puppeteer-core/src/common/USKeyboardLayout.ts#L287-L321)

`#keyDescriptionForString` resolves a key name against the current modifiers. An unknown name fails with `Unknown key: "<name>"`. With `Shift` held it uses the shifted key, code and text, and a single-character key types itself. While any modifier other than `Shift` is held, the text is cleared, so `Control`+`a` sends a key event but types nothing.

Sources: [packages/puppeteer-core/src/cdp/Input.ts:100-152](repo://packages/puppeteer-core/src/cdp/Input.ts#L100-L152)

### down, up and modifiers

`down(key)` sends `keyDown` when the key produces text and `rawKeyDown` otherwise. The keyboard keeps a set of pressed codes, so pressing a held key again sends `autoRepeat: true`. Modifier keys set bits in `_modifiers` (Alt 1, Control 2, Meta 4, Shift 8) that every later event carries, and `up(key)` clears the bit and sends `keyUp`.

Sources: [packages/puppeteer-core/src/cdp/Input.ts:55-98](repo://packages/puppeteer-core/src/cdp/Input.ts#L55-L98), [packages/puppeteer-core/src/cdp/Input.ts:154-167](repo://packages/puppeteer-core/src/cdp/Input.ts#L154-L167)

The `text` and `commands` options of `down` are deprecated: Puppeteer fills them in itself.

Sources: [packages/puppeteer-core/src/api/Input.ts:18-27](repo://packages/puppeteer-core/src/api/Input.ts#L18-L27)

### press, type and sendCharacter

`press(key, {delay})` is `down`, an optional pause, and `up`. `type(text, {delay})` walks the string character by character: a character with a key definition is pressed like a real key, and any other character (an emoji, a letter outside the US layout) is inserted with `sendCharacter`. That method sends `Input.insertText`, which produces an `input` event without `keydown` or `keyup`.

Sources: [packages/puppeteer-core/src/cdp/Input.ts:169-208](repo://packages/puppeteer-core/src/cdp/Input.ts#L169-L208)

The API's own example selects text with `Shift` held:

Sources: [packages/puppeteer-core/src/api/Input.ts:57-66](repo://packages/puppeteer-core/src/api/Input.ts#L57-L66)

```ts
await page.keyboard.type('Hello World!');
await page.keyboard.press('ArrowLeft');

await page.keyboard.down('Shift');
for (let i = 0; i < ' World'.length; i++)
  await page.keyboard.press('ArrowLeft');
await page.keyboard.up('Shift');

await page.keyboard.press('Backspace');
// Result text will end up saying 'Hello!'
```

Sources: [packages/puppeteer-core/src/api/Input.ts:57-66](repo://packages/puppeteer-core/src/api/Input.ts#L57-L66)

> [!NOTE]
> On macOS, keyboard shortcuts such as `⌘ A` for Select All do not work through `Keyboard`.

Sources: [packages/puppeteer-core/src/api/Input.ts:52-53](repo://packages/puppeteer-core/src/api/Input.ts#L52-L53)

## Mouse

### Coordinates and state

The mouse works in main-frame CSS pixels relative to the viewport's top-left corner. `CdpMouse` remembers its position and a bit mask of pressed buttons (`left`, `right`, `middle`, `back`, `forward`), because every CDP mouse event must state both.

Sources: [packages/puppeteer-core/src/api/Input.ts:278-282](repo://packages/puppeteer-core/src/api/Input.ts#L278-L282), [packages/puppeteer-core/src/cdp/Input.ts:214-268](repo://packages/puppeteer-core/src/cdp/Input.ts#L214-L268)

State changes are transactional. Each operation pushes a partial state onto a list of transactions, and the current state is the committed state with every open transaction applied on top. When the protocol command succeeds, the transaction is committed; when it throws, it is rolled back. Concurrent operations, which `click` relies on, each see the effect of the ones started before them, and a failed command does not leave a button marked as pressed.

Sources: [packages/puppeteer-core/src/cdp/Input.ts:287-336](repo://packages/puppeteer-core/src/cdp/Input.ts#L287-L336)

### Operations

| Method | What it sends |
| --- | --- |
| `move(x, y, {steps})` | `steps` `mouseMoved` events, interpolated linearly from the current position (default 1) |
| `down({button, clickCount})` | `mousePressed`; throws if the button is already pressed or unknown |
| `up({button, clickCount})` | `mouseReleased`; throws if the button is not pressed |
| `click(x, y, {button, count, delay})` | A move, then `count` press/release pairs with rising `clickCount`, with `delay` ms between the last press and release |
| `wheel({deltaX, deltaY})` | One `mouseWheel` event at the current position |
| `reset()` | Releases every pressed button and moves back to (0, 0) |

Sources: [packages/puppeteer-core/src/cdp/Input.ts:338-433](repo://packages/puppeteer-core/src/cdp/Input.ts#L338-L433), [packages/puppeteer-core/src/cdp/Input.ts:435-479](repo://packages/puppeteer-core/src/cdp/Input.ts#L435-L479)

`click` with `count: 2` therefore sends press and release with `clickCount: 1`, then press and release with `clickCount: 2`, which the page sees as a double click. `count` must be at least 1.

Sources: [packages/puppeteer-core/src/cdp/Input.ts:435-463](repo://packages/puppeteer-core/src/cdp/Input.ts#L435-L463)

> [!NOTE]
> Mouse events are synthetic `MouseEvent`s. Selecting text by dragging does not work; select with the Selection API through `page.evaluate` instead.

Sources: [packages/puppeteer-core/src/api/Input.ts:296-317](repo://packages/puppeteer-core/src/api/Input.ts#L296-L317)

### Drag and drop

Native drag and drop needs the drag data the browser creates, which `page.setDragInterception(true)` exposes. `drag(start, target)` waits for the next `Input.dragIntercepted` event while it moves to `start`, presses, and moves to `target`, and resolves with that event's `DragData`. `dragEnter`, `dragOver` and `drop` each send one `Input.dispatchDragEvent` at a point with that data. `dragAndDrop(start, target, {delay})` runs the whole sequence, drag, enter, over, optional pause, drop, and finally releases the button.

Sources: [packages/puppeteer-core/src/cdp/Input.ts:481-551](repo://packages/puppeteer-core/src/cdp/Input.ts#L481-L551)

## Touchscreen

### Touch handles

Touches are objects. `touchStart(x, y)` creates a touch point with rounded coordinates, a radius and force of 0.5 and an id from an incrementing generator, sends `touchStart`, and returns a `TouchHandle` that the touchscreen also keeps in its `touches` list. `handle.move(x, y)` sends `touchMove` for that point, and `handle.end()` sends `touchEnd` and removes the handle. Starting a handle twice throws `TouchError`. Several handles can be active at once, one per finger.

Sources: [packages/puppeteer-core/src/cdp/Input.ts:557-653](repo://packages/puppeteer-core/src/cdp/Input.ts#L557-L653), [packages/puppeteer-core/src/api/Input.ts:478-517](repo://packages/puppeteer-core/src/api/Input.ts#L478-L517)

### Convenience methods

`tap(x, y)` is `touchStart` followed by `end`. `touchMove(x, y)` and `touchEnd()` act on the oldest active touch, and both throw `TouchError('Must start a new Touch first')` when there is none.

Sources: [packages/puppeteer-core/src/api/Input.ts:524-566](repo://packages/puppeteer-core/src/api/Input.ts#L524-L566)

## Session changes

A page's devices outlive the CDP session they were created with. When the page's target is swapped, for example on activation of a prerendered page, the page calls `updateClient` on each device. The touchscreen also updates every active touch handle, so input keeps going to the current session.

Sources: [packages/puppeteer-core/src/cdp/Input.ts:51-53](repo://packages/puppeteer-core/src/cdp/Input.ts#L51-L53), [packages/puppeteer-core/src/cdp/Input.ts:283-285](repo://packages/puppeteer-core/src/cdp/Input.ts#L283-L285), [packages/puppeteer-core/src/cdp/Input.ts:625-630](repo://packages/puppeteer-core/src/cdp/Input.ts#L625-L630), [packages/puppeteer-core/src/cdp/Page.ts:260-273](repo://packages/puppeteer-core/src/cdp/Page.ts#L260-L273)
