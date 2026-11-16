---
title: "Browser Rendering"
---
## Overview

The DOM renderer turns JSX into browser nodes, retains component state and reconciles later renders. It provides root objects, direct rendering and synchronous flushing, alongside shared hooks and DOM-specific form hooks. [[Server Rendering]] covers the HTML serialization path; the browser path described here invokes components, builds node records and applies changes to real DOM containers.

Sources: [src/jsx/dom/client.ts:11-83](repo://src/jsx/dom/client.ts#L11-L83), [src/jsx/dom/render.ts:783-818](repo://src/jsx/dom/render.ts#L783-L818), [src/jsx/dom/hooks/index.ts:37-90](repo://src/jsx/dom/hooks/index.ts#L37-L90)

## Root lifecycle

`createRoot(element, options)` accepts an HTMLElement or DocumentFragment and returns `render` and `unmount`. The first render mounts a wrapper component whose state contains the supplied JSX; subsequent renders call that component's setter. Unmount sets its state to null and permanently marks the root unmounted. A later render throws `Cannot update an unmounted root`. Options are currently unsupported and nonempty options produce a warning.

Sources: [src/jsx/dom/client.ts:23-65](repo://src/jsx/dom/client.ts#L23-L65)

`hydrateRoot` creates a root and immediately renders into it. Its source explicitly defines hydration as equivalent to render in this implementation. Initial `renderNode` builds the tree, applies it to a DocumentFragment, replaces internal container references, and replaces the target's children with the fragment. Code relying on root creation should therefore use this implementation's stated hydration behavior rather than assuming a separate existing-markup hydration algorithm.

Sources: [src/jsx/dom/client.ts:68-83](repo://src/jsx/dom/client.ts#L68-L83), [src/jsx/dom/render.ts:783-798](repo://src/jsx/dom/render.ts#L783-L798)

## Building and reconciling nodes

`buildNode` drops booleans and nullish children, turns strings and numbers into text records, and gives function components a hook stash. `invokeTag` resets that component's hook cursor, pushes its build context onto `buildDataStack`, invokes its DOM-specific renderer or component, and pops the stack in `finally`. The renderer's node identity and hook storage are therefore connected: reusing a component record preserves its stash across builds.

Sources: [src/jsx/dom/render.ts:274-290](repo://src/jsx/dom/render.ts#L274-L290), [src/jsx/dom/render.ts:667-703](repo://src/jsx/dom/render.ts#L667-L703)

During `build`, nested child arrays flatten and each new child is compared against remaining previous children. Keyed nodes require both key and tag to match; unkeyed nodes match by tag, and text records match text records. Reused text nodes mark changed text as dirty. Reused component nodes carry previous props and context snapshots; memoized nodes can skip work when their props/context checks pass. DOM application separately removes obsolete nodes, updates props and moves or inserts retained elements into the desired order.

Sources: [src/jsx/dom/render.ts:497-578](repo://src/jsx/dom/render.ts#L497-L578), [src/jsx/dom/render.ts:387-455](repo://src/jsx/dom/render.ts#L387-L455)

## State updates and scheduling

`useState` keeps hook entries in the component's indexed state array. Its setter accepts a value or updater function and schedules work only when `Object.is` finds a change. Outside a DOM build it returns the resolved initial value and a no-op setter. `useReducer` composes state and a callback that applies the reducer. Because hook storage is addressed by the incrementing cursor, these APIs depend on a consistent hook call sequence for the reused component.

Sources: [src/jsx/hooks/index.ts:178-257](repo://src/jsx/hooks/index.ts#L178-L257), [src/jsx/dom/render.ts:274-276](repo://src/jsx/dom/render.ts#L274-L276)

```mermaid
flowchart LR
  setter["State setter changes stored value"] --> queue["update stores latest node task"]
  queue --> tick["Microtask or flushSync"]
  tick --> build["updateSync builds component"]
  build --> apply["Apply DOM changes"]
  apply --> effects["Run effect callbacks"]
```

Sources: [src/jsx/hooks/index.ts:199-239](repo://src/jsx/hooks/index.ts#L199-L239), [src/jsx/dom/render.ts:713-780](repo://src/jsx/dom/render.ts#L713-L780), [src/jsx/dom/render.ts:454-496](repo://src/jsx/dom/render.ts#L454-L496), [src/jsx/dom/render.ts:801-818](repo://src/jsx/dom/render.ts#L801-L818)

The update map retains only the latest queued task per component; superseded update promises resolve with undefined. Ordinary updates yield to a resolved promise before executing the latest task. `flushSync` collects updated nodes during its callback and runs their queued tasks immediately. Transition/deferred paths use pending-state information and additional scheduled work, with stale follow-up work skipped when a component's children have already changed.

Sources: [src/jsx/dom/render.ts:734-780](repo://src/jsx/dom/render.ts#L734-L780), [src/jsx/dom/render.ts:801-818](repo://src/jsx/dom/render.ts#L801-L818), [src/jsx/hooks/index.ts:206-239](repo://src/jsx/hooks/index.ts#L206-L239)

## Props, effects and cleanup

DOM prop application installs event listeners, rejects non-function event handlers, handles raw inner HTML, updates styles, and attaches callback or object refs. Callback refs may return cleanup; otherwise cleanup calls the ref with null. Removed props remove event listeners or attributes. Node removal runs effect and ref cleanup, recursively removes children and clears queued component updates. Select values are applied after children so option nodes already exist.

Sources: [src/jsx/dom/render.ts:164-207](repo://src/jsx/dom/render.ts#L164-L207), [src/jsx/dom/render.ts:255-270](repo://src/jsx/dom/render.ts#L255-L270), [src/jsx/dom/render.ts:341-361](repo://src/jsx/dom/render.ts#L341-L361), [src/jsx/dom/render.ts:437-441](repo://src/jsx/dom/render.ts#L437-L441)

Effect hooks compare dependency lists, run prior cleanup when dependencies change, and register runners in distinct effect slots. Layout, insertion and ordinary effects use different slots; a runner clears its slot before calling the effect to avoid duplicate invocation. `useCallback` reuses its prior callback while dependencies are unchanged, and `useRef` preserves an object in the component's ref stash. `useSyncExternalStore` subscribes through an effect and requires a server snapshot when called during serialization without a DOM build.

Sources: [src/jsx/hooks/index.ts:260-329](repo://src/jsx/hooks/index.ts#L260-L329), [src/jsx/hooks/index.ts:397-424](repo://src/jsx/hooks/index.ts#L397-L424)

## Context, suspension and forms

DOM context providers push a value around their children and pop it afterward, including an error path that pops before rethrowing. Built function nodes capture context values for later updates. The shared `use(promise)` caches a promise result or rejection and throws a pending promise while it is unresolved, providing the suspension signal used by rendering boundaries. The server counterpart and its asynchronous scope guarantees are described in [[Server Rendering]].

Sources: [src/jsx/dom/context.ts:7-51](repo://src/jsx/dom/context.ts#L7-L51), [src/jsx/dom/render.ts:529-538](repo://src/jsx/dom/render.ts#L529-L538), [src/jsx/hooks/index.ts:332-370](repo://src/jsx/hooks/index.ts#L332-L370)

Function-valued form actions intercept submission, construct FormData, set pending status, and await a registered action promise before clearing status. `useFormStatus` reads that form context. `useActionState` returns state plus an async action that updates it from the callback result and records an optional permalink. `useOptimistic` applies an optimistic reducer and resets to the supplied state when registered actions settle. These hooks coordinate the browser form lifecycle rather than creating HTTP routes automatically.

Sources: [src/jsx/dom/intrinsic-element/components.ts:318-385](repo://src/jsx/dom/intrinsic-element/components.ts#L318-L385), [src/jsx/dom/hooks/index.ts:24-90](repo://src/jsx/dom/hooks/index.ts#L24-L90)
