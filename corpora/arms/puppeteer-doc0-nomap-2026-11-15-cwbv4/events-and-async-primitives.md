---
title: "Events and Async Primitives"
---
## Overview

Both protocol backends are event-driven: a protocol message arrives, an object updates its state and emits an event, and somewhere a promise waiting for that event settles. A small set of internal building blocks makes this consistent across the code base: a typed `EventEmitter`, `Deferred` promises with timeouts, a `Mutex`, disposable stacks with the `using` syntax, method and accessor decorators, iterable helpers, and a vendored subset of RxJS. This page is a catalogue: what each part is for and where it is used. The pages for each subsystem show them at work.

Sources: [packages/puppeteer-core/src/common/EventEmitter.ts:59-122](repo://packages/puppeteer-core/src/common/EventEmitter.ts#L59-L122), [packages/puppeteer-core/src/common/EventEmitter.ts:131-193](repo://packages/puppeteer-core/src/common/EventEmitter.ts#L131-L193), [packages/puppeteer-core/src/util/Deferred.ts:25-128](repo://packages/puppeteer-core/src/util/Deferred.ts#L25-L128)

| Part | File | Use it for |
| --- | --- | --- |
| `EventEmitter` | `common/EventEmitter.ts` | Typed events on any object; scoped subscriptions to another emitter |
| `Deferred` | `util/Deferred.ts` | A promise resolved from outside, with an optional timeout |
| `Mutex` | `util/Mutex.ts` | FIFO mutual exclusion released with `using` |
| `TaskQueue` | `common/TaskQueue.ts` | Running async tasks strictly one after another |
| `DisposableStack`, `AsyncDisposableStack` | `util/disposable.ts` | Grouping cleanup actions and running them in reverse |
| Decorators | `util/decorators.ts` | Guarding disposed objects, serializing calls, memoizing, bubbling events, moving handles |
| `AsyncIterableUtil` | `util/AsyncIterableUtil.ts` | `map`, `flatMap`, `collect`, `first` on async iterables |
| RxJS and helpers | `third_party/rxjs`, `common/util.ts` | Composing events, timeouts and abort signals |

Sources: [packages/puppeteer-core/src/util/Mutex.ts:12-51](repo://packages/puppeteer-core/src/util/Mutex.ts#L12-L51), [packages/puppeteer-core/src/common/TaskQueue.ts:10-29](repo://packages/puppeteer-core/src/common/TaskQueue.ts#L10-L29), [packages/puppeteer-core/src/util/AsyncIterableUtil.ts:11-46](repo://packages/puppeteer-core/src/util/AsyncIterableUtil.ts#L11-L46), [packages/puppeteer-core/third_party/rxjs/rxjs.ts:1-47](repo://packages/puppeteer-core/third_party/rxjs/rxjs.ts#L1-L47)

## EventEmitter

### Typed events

`EventEmitter<Events>` takes a map from event name (string or symbol) to payload type, so `page.on('request', r => …)` knows `r` is an `HTTPRequest`. Every emitter also accepts the wildcard `'*'`, whose handlers receive all events. Internally it delegates to `mitt` and keeps its own list of handlers per type, which gives `listenerCount`, `removeAllListeners`, and `off` that removes only the last matching registration.

Sources: [packages/puppeteer-core/src/common/EventEmitter.ts:13-45](repo://packages/puppeteer-core/src/common/EventEmitter.ts#L13-L45), [packages/puppeteer-core/src/common/EventEmitter.ts:84-180](repo://packages/puppeteer-core/src/common/EventEmitter.ts#L84-L180)

`emit` returns whether anyone was listening. `once` registers a wrapper that removes itself after the first call.

Sources: [packages/puppeteer-core/src/common/EventEmitter.ts:131-155](repo://packages/puppeteer-core/src/common/EventEmitter.ts#L131-L155)

### Scoped subscriptions

The constructor can take another `EventEmitter` instead of a fresh `mitt` instance. `new EventEmitter(session)` then registers handlers on the session but remembers them, and disposing the wrapper removes exactly those handlers and no others. Combined with a `DisposableStack`, this is the standard way objects subscribe to a parent and unsubscribe all at once:

Sources: [packages/puppeteer-core/src/common/EventEmitter.ts:70-76](repo://packages/puppeteer-core/src/common/EventEmitter.ts#L70-L76), [packages/puppeteer-core/src/common/EventEmitter.ts:185-192](repo://packages/puppeteer-core/src/common/EventEmitter.ts#L185-L192), [packages/puppeteer-core/src/cdp/ExecutionContext.ts:97-98](repo://packages/puppeteer-core/src/cdp/ExecutionContext.ts#L97-L98)

```ts
const clientEmitter = this.#disposables.use(new EventEmitter(this.#client));
clientEmitter.on('Runtime.bindingCalled', this.#onBindingCalled.bind(this));
```

Sources: [packages/puppeteer-core/src/common/EventEmitter.ts:70-76](repo://packages/puppeteer-core/src/common/EventEmitter.ts#L70-L76), [packages/puppeteer-core/src/common/EventEmitter.ts:185-192](repo://packages/puppeteer-core/src/common/EventEmitter.ts#L185-L192), [packages/puppeteer-core/src/cdp/ExecutionContext.ts:97-98](repo://packages/puppeteer-core/src/cdp/ExecutionContext.ts#L97-L98)

## Promises and locks

### Deferred

A `Deferred` is a promise that the code resolves or rejects later, from an event handler. Only the first `resolve` or `reject` counts. `finished()`, `resolved()` and `value()` inspect it synchronously, which code such as the target manager uses to check a target's initialization state without awaiting. With `{message, timeout}` it rejects itself with a `TimeoutError` after the timeout. `valueOrThrow()` returns one shared promise.

Sources: [packages/puppeteer-core/src/util/Deferred.ts:11-128](repo://packages/puppeteer-core/src/util/Deferred.ts#L11-L128), [packages/puppeteer-core/src/cdp/TargetManager.ts:293-294](repo://packages/puppeteer-core/src/cdp/TargetManager.ts#L293-L294)

`Deferred.race(list)` races promises and deferreds, then rejects every losing deferred that has a timer, so pending timers do not keep Node's event loop alive. Navigation code races a navigation command against a lifecycle watcher's termination this way ([[CDP Pages and Frame Management]]).

Sources: [packages/puppeteer-core/src/util/Deferred.ts:32-58](repo://packages/puppeteer-core/src/util/Deferred.ts#L32-L58), [packages/puppeteer-core/src/cdp/Frame.ts:166-175](repo://packages/puppeteer-core/src/cdp/Frame.ts#L166-L175)

### Mutex and TaskQueue

`Mutex.acquire(onRelease?)` resolves immediately when unlocked, otherwise queues the caller (first in, first out). It returns a `Guard` whose disposal releases the lock and hands it to the next waiter, so `using _guard = await mutex.acquire()` holds the lock for exactly one block. The browser context's screenshot lock and the execution context's binding installation are built on it ([[Browsers, Browser Contexts and Targets]]).

Sources: [packages/puppeteer-core/src/util/Mutex.ts:12-51](repo://packages/puppeteer-core/src/util/Mutex.ts#L12-L51), [packages/puppeteer-core/src/api/BrowserContext.ts:119-145](repo://packages/puppeteer-core/src/api/BrowserContext.ts#L119-L145), [packages/puppeteer-core/src/cdp/ExecutionContext.ts:116-124](repo://packages/puppeteer-core/src/cdp/ExecutionContext.ts#L116-L124)

`TaskQueue.postTask(task)` chains each task after the previous one, whether the previous succeeded or failed, and returns the task's own result.

Sources: [packages/puppeteer-core/src/common/TaskQueue.ts:10-29](repo://packages/puppeteer-core/src/common/TaskQueue.ts#L10-L29)

## Disposables

### The using pattern

Puppeteer adopts the explicit resource management proposal. It polyfills `Symbol.dispose` and `Symbol.asyncDispose` where the runtime lacks them, and implements them on handles, pages, browsers, browser contexts, guards and emitters. A `using` or `await using` declaration then cleans up at the end of the block, even on exceptions. Handles combine this with the `move()` mechanism described in [[JavaScript Evaluation and Handles]].

Sources: [packages/puppeteer-core/src/util/disposable.ts:7-43](repo://packages/puppeteer-core/src/util/disposable.ts#L7-L43), [packages/puppeteer-core/src/api/JSHandle.ts:200-212](repo://packages/puppeteer-core/src/api/JSHandle.ts#L200-L212)

### DisposableStack

`DisposableStack` collects cleanup work: `use(value)` adds a disposable, `adopt(value, fn)` adds a value with a cleanup function, and `defer(fn)` adds a bare callback. Disposing runs them in reverse order, once. If several throw, the errors are chained into a `SuppressedError`. `move()` transfers the contents to a new stack and marks the old one disposed. `AsyncDisposableStack` does the same with awaited async cleanups and also accepts sync disposables. Nearly every long-lived object keeps a `#disposables` stack of its subscriptions, and screenshot code uses `await using stack` to restore emulation settings afterwards ([[Screenshots, PDFs and Screen Recording]]).

Sources: [packages/puppeteer-core/src/util/disposable.ts:48-108](repo://packages/puppeteer-core/src/util/disposable.ts#L48-L108), [packages/puppeteer-core/src/util/disposable.ts:143-186](repo://packages/puppeteer-core/src/util/disposable.ts#L143-L186), [packages/puppeteer-core/src/util/disposable.ts:191-263](repo://packages/puppeteer-core/src/util/disposable.ts#L191-L263), [packages/puppeteer-core/src/util/disposable.ts:298-341](repo://packages/puppeteer-core/src/util/disposable.ts#L298-L341), [packages/puppeteer-core/src/util/disposable.ts:349-378](repo://packages/puppeteer-core/src/util/disposable.ts#L349-L378), [packages/puppeteer-core/src/cdp/Page.ts:1027-1035](repo://packages/puppeteer-core/src/cdp/Page.ts#L1027-L1035)

## Decorators

The code uses TypeScript's standard decorators for cross-cutting behaviour:

Sources: [packages/puppeteer-core/src/util/decorators.ts:14-87](repo://packages/puppeteer-core/src/util/decorators.ts#L14-L87), [packages/puppeteer-core/src/util/decorators.ts:88-119](repo://packages/puppeteer-core/src/util/decorators.ts#L88-L119), [packages/puppeteer-core/src/util/decorators.ts:121-210](repo://packages/puppeteer-core/src/util/decorators.ts#L121-L210)

| Decorator | Effect | Example use |
| --- | --- | --- |
| `@throwIfDisposed(message?)` | Throws when `this.disposed` is true | Handle and frame methods, all `bidi/core` commands |
| `@inertIfDisposed` | Silently returns when disposed | `dispose` methods in `bidi/core` |
| `@moveable` | Adds `move()`, making the next dispose a no-op | `JSHandle` |
| `@invokeAtMostOnceForArguments` | Runs only for an argument tuple not seen before (weak-map memoization) | Emulation updaters per session |
| `@guarded(getKey?)` | Serializes calls per key with a `Mutex` | `Page.screenshot`, `ScreenRecorder.stop` |
| `@bubble(events?)` | On an emitter-valued accessor, re-emits the field's events (or the listed ones) on the owner | `Session.connection`, BiDi trusted emitters |

Sources: [packages/puppeteer-core/src/util/decorators.ts:14-87](repo://packages/puppeteer-core/src/util/decorators.ts#L14-L87), [packages/puppeteer-core/src/util/decorators.ts:88-119](repo://packages/puppeteer-core/src/util/decorators.ts#L88-L119), [packages/puppeteer-core/src/util/decorators.ts:121-210](repo://packages/puppeteer-core/src/util/decorators.ts#L121-L210)

`@bubble` subscribes with the wildcard `'*'` and, when the accessor is reassigned, moves its subscription from the old emitter to the new one.

Sources: [packages/puppeteer-core/src/util/decorators.ts:150-210](repo://packages/puppeteer-core/src/util/decorators.ts#L150-L210)

## Iterables and RxJS

### AsyncIterableUtil

Query handlers return results lazily as async iterables, and `AsyncIterableUtil` provides the few operators the code needs: `map`, `flatMap` (used by the P-selector engine to chain query steps), `collect` into an array, and `first`.

Sources: [packages/puppeteer-core/src/util/AsyncIterableUtil.ts:11-46](repo://packages/puppeteer-core/src/util/AsyncIterableUtil.ts#L11-L46), [packages/puppeteer-core/src/injected/PQuerySelector.ts:85-150](repo://packages/puppeteer-core/src/injected/PQuerySelector.ts#L85-L150)

### Vendored RxJS and mitt

Third-party runtime dependencies are imported from `third_party/<name>` entry points rather than by package name, so the ESM build works in environments without Node's module resolution, such as browsers. `third_party/rxjs` re-exports only the operators the code uses; `third_party/mitt` re-exports `mitt`.

Sources: [packages/puppeteer-core/third_party/README.md:1-28](repo://packages/puppeteer-core/third_party/README.md#L1-L28), [packages/puppeteer-core/third_party/mitt/mitt.ts:1-3](repo://packages/puppeteer-core/third_party/mitt/mitt.ts#L1-L3)

Three helpers in `common/util.ts` connect RxJS to the rest of the code. `fromEmitterEvent(emitter, name)` turns an event into an observable that unsubscribes when the subscriber does. `fromAbortSignal(signal, cause)` errors with the signal's reason when it aborts and never emits without a signal. `filterAsync(predicate)` filters with an async predicate. With `timeout(ms)` (which emits nothing when `ms` is 0), they form the standard wait pattern used by `waitForTarget`, `waitForRequest`, `waitForFrame` and locators:

Sources: [packages/puppeteer-core/src/common/util.ts:425-481](repo://packages/puppeteer-core/src/common/util.ts#L425-L481), [packages/puppeteer-core/src/common/util.ts:288-296](repo://packages/puppeteer-core/src/common/util.ts#L288-L296), [packages/puppeteer-core/src/api/Browser.ts:360-369](repo://packages/puppeteer-core/src/api/Browser.ts#L360-L369)

```ts
return await firstValueFrom(
  merge(
    fromEmitterEvent(this, BrowserEvent.TargetCreated),
    fromEmitterEvent(this, BrowserEvent.TargetChanged),
    from(this.targets()),
  ).pipe(
    filterAsync(predicate),
    raceWith(fromAbortSignal(signal), timeout(ms)),
  ),
);
```

Sources: [packages/puppeteer-core/src/common/util.ts:425-481](repo://packages/puppeteer-core/src/common/util.ts#L425-L481), [packages/puppeteer-core/src/common/util.ts:288-296](repo://packages/puppeteer-core/src/common/util.ts#L288-L296), [packages/puppeteer-core/src/api/Browser.ts:360-369](repo://packages/puppeteer-core/src/api/Browser.ts#L360-L369)
