---
title: "DOM Elements, Forms and CSS"
---
## Overview

A few HTML elements need behaviour beyond "create this element here" when rendered in the browser. Metadata tags (`title`, `meta`, `link`, `style`, `script`) belong in `document.head` even when a component deep in the tree renders them, and forms can take a JavaScript function as their `action`. `hono/jsx/dom` gives these elements their own components, registered in `domRenderers`, which the renderer calls instead of creating the element directly. This page also covers the form hooks, the browser version of the `css` helper, and the React-style `hono/jsx/dom/server` module.

Sources: [src/jsx/dom/intrinsic-element/components.ts:429-438](repo://src/jsx/dom/intrinsic-element/components.ts#L429-L438), [src/jsx/base.ts:318-336](repo://src/jsx/base.ts#L318-L336), [src/jsx/dom/render.ts:276-283](repo://src/jsx/dom/render.ts#L276-L283)

The same element names have server components that hoist tags into `<head>` while rendering HTML ([[JSX Server Rendering]]). On the first call to `jsxFn`, each server component gets the DOM component of the same name attached as its `DOM_RENDERER`, so a component tree written once uses the right one on each side.

Sources: [src/jsx/base.ts:318-327](repo://src/jsx/base.ts#L318-L327), [src/jsx/intrinsic-element/common.ts:11-11](repo://src/jsx/intrinsic-element/common.ts#L11-L11)

## Head elements

`documentMetadataTag` returns the element through `createPortal` into `document.head`, so it is rendered there whatever its position in the tree. Which elements are moved follows the same rules as on the server: a `script` needs `src` and `async`, a `style` needs `href` and `precedence`, a stylesheet `link` needs `precedence` and no `disabled`, and a `link` with `onLoad` or `onError` and a `title` inside `<svg>` render in place.

Sources: [src/jsx/dom/intrinsic-element/components.ts:58-77](repo://src/jsx/dom/intrinsic-element/components.ts#L58-L77), [src/jsx/dom/intrinsic-element/components.ts:236-316](repo://src/jsx/dom/intrinsic-element/components.ts#L236-L316)

Elements that can be de-duplicated, by the keys in `deDupeKeyMap` (`src` for scripts, `href` for styles and stylesheet links, `name`, `httpEquiv`, `charset` or `itemProp` for meta), reuse an element already in the head when one matches, for example one written by the server. Otherwise the created element is cached by its tag and keys, so two components rendering the same stylesheet share one `<link>`.

Sources: [src/jsx/dom/intrinsic-element/components.ts:80-120](repo://src/jsx/dom/intrinsic-element/components.ts#L80-L120), [src/jsx/intrinsic-element/common.ts:3-23](repo://src/jsx/intrinsic-element/common.ts#L3-L23)

New elements are inserted by `insert`, which orders them by precedence. A stylesheet with a `precedence` goes after the last stylesheet of the same precedence and before the next precedence or any stylesheet without one; other de-duplicated tags follow the same rule by `data-precedence`; other `title` and `meta` elements are inserted before the existing ones.

Sources: [src/jsx/dom/intrinsic-element/components.ts:122-188](repo://src/jsx/dom/intrinsic-element/components.ts#L122-L188)

When the element is removed from the tree, the node's preserve flag decides what happens: `script` and `link` (flag `1`) are kept in the head, and `style` (flag `2`) is kept, with its content cleared when the element is reused.

Sources: [src/jsx/dom/intrinsic-element/components.ts:190-199](repo://src/jsx/dom/intrinsic-element/components.ts#L190-L199), [src/jsx/dom/intrinsic-element/components.ts:246-249](repo://src/jsx/dom/intrinsic-element/components.ts#L246-L249), [src/jsx/dom/render.ts:36-39](repo://src/jsx/dom/render.ts#L36-L39)

## Load events and blocking

`onLoad` and `onError` on a de-duplicated element attach to one shared Promise per key, so every component that renders the same stylesheet or script is told when it loads. With `blocking="render"` on a `script`, `style` or `link`, the component calls `use()` on that Promise, which suspends rendering until the resource has loaded; a surrounding `Suspense` shows its fallback meanwhile ([[JSX Hooks]]).

Sources: [src/jsx/dom/intrinsic-element/components.ts:200-234](repo://src/jsx/dom/intrinsic-element/components.ts#L200-L234)

## Form actions

A `<form>` whose `action` is a function becomes a client-side form. The DOM `form` component attaches a `submit` listener through its ref; on submit it prevents the default, builds `FormData` from the form, calls the action with it, and, if the action returns a Promise, registers it and waits for it. A string `action` is passed through as the normal attribute.

Sources: [src/jsx/dom/intrinsic-element/components.ts:318-360](repo://src/jsx/dom/intrinsic-element/components.ts#L318-L360)

```tsx
const Signup = () => {
  const save = async (data: FormData) => {
    await fetch('/api/signup', { method: 'POST', body: data })
  }
  return (
    <form action={save}>
      <input name="email" />
      <SubmitButton />
    </form>
  )
}
```

Sources: [src/jsx/dom/intrinsic-element/components.ts:319-386](repo://src/jsx/dom/intrinsic-element/components.ts#L319-L386)

The form renders inside a `FormContext` provider whose value reports the submission: `pending`, the `data`, the `method` (`post` while pending) and the `action`. `input` and `button` with a function `formAction` dispatch a synthetic `submit` event carrying that function, so a button can run its own action on the enclosing form.

Sources: [src/jsx/dom/intrinsic-element/components.ts:362-427](repo://src/jsx/dom/intrinsic-element/components.ts#L362-L427)

On the server, a function `action` or `formAction` is replaced by its `PERMALINK` URL when it has one and dropped otherwise ([[JSX Server Rendering]]).

Sources: [src/jsx/intrinsic-element/components.ts:179-210](repo://src/jsx/intrinsic-element/components.ts#L179-L210)

## Form hooks

| Hook | Returns |
| --- | --- |
| `useFormStatus()` | The `FormContext` value of the closest form: `{ pending, data, method, action }` |
| `useActionState(fn, initialState, permalink?)` | `[state, action]`; calling `action(formData)` sets the state to `await fn(state, formData)` |
| `useOptimistic(state, update)` | `[optimisticState, addOptimistic]`; `addOptimistic(value)` applies `update` immediately |

Sources: [src/jsx/dom/hooks/index.ts:11-91](repo://src/jsx/dom/hooks/index.ts#L11-L91)

`useActionState` stores `permalink` on the returned action under `PERMALINK`, which is how a form action gets a URL for server rendering. `useOptimistic` resets the optimistic value to `state` once every registered form action has settled, so the optimistic value lasts exactly as long as the submissions in flight.

Sources: [src/jsx/dom/hooks/index.ts:31-35](repo://src/jsx/dom/hooks/index.ts#L31-L35), [src/jsx/dom/hooks/index.ts:52-91](repo://src/jsx/dom/hooks/index.ts#L52-L91)

```tsx
const SubmitButton = () => {
  const { pending } = useFormStatus()
  return <button disabled={pending}>{pending ? 'Saving…' : 'Save'}</button>
}
```

Sources: [src/jsx/dom/hooks/index.ts:41-43](repo://src/jsx/dom/hooks/index.ts#L41-L43)

## CSS in the browser

`hono/jsx/dom/css` provides `css`, `cx`, `keyframes`, `viewTransition`, `Style` and `createCssContext` with the same template syntax and class-name generation as `hono/css`, since both use the functions in `helper/css/common` ([[HTML and CSS Helpers]]). The difference is how rules reach the page. On the server, rules are collected into the `<style>` element through render callbacks. In the browser, a class name is an object whose `toString()` inserts its rules into the `<style id="hono-css">` stylesheet with `insertRule` the first time it is used as a string, and returns the class name.

Sources: [src/jsx/dom/css.ts:77-143](repo://src/jsx/dom/css.ts#L77-L143), [src/jsx/dom/css.ts:180-263](repo://src/jsx/dom/css.ts#L180-L263)

Each rule is inserted once per stylesheet, tracked in a set. If the `<style>` element does not exist yet, insertion is retried after a microtask, and throws `style sheet not found` if it is still missing. Global rules (`:-hono-global`) are split into top-level rules before insertion.

Sources: [src/jsx/dom/css.ts:27-66](repo://src/jsx/dom/css.ts#L27-L66), [src/jsx/dom/css.ts:78-113](repo://src/jsx/dom/css.ts#L78-L113)

The server `hono/css` already prepares for this: its class name objects carry the DOM `toString`, and its `Style` has the DOM `Style` as its `DOM_RENDERER`, so components using `hono/css` also work under `hono/jsx/dom`.

Sources: [src/helper/css/index.ts:81-81](repo://src/helper/css/index.ts#L81-L81), [src/helper/css/index.ts:165-165](repo://src/helper/css/index.ts#L165-L165), [src/helper/css/index.ts:205-206](repo://src/helper/css/index.ts#L205-L206)

## hono/jsx/dom/server

`hono/jsx/dom/server` mirrors React's `react-dom/server`, for libraries that import it:

Sources: [src/jsx/dom/server.ts:11-70](repo://src/jsx/dom/server.ts#L11-L70)

| Function | Behaviour |
| --- | --- |
| `renderToString(element)` | `element.toString()`; throws `Async component is not supported in renderToString` if the result is a Promise |
| `renderToReadableStream(element, options)` | Hono's streaming renderer ([[Suspense and Streaming JSX]]); only `onError` is honoured |

Sources: [src/jsx/dom/server.ts:11-70](repo://src/jsx/dom/server.ts#L11-L70)

Other options of either function log a warning that they are not supported yet.

Sources: [src/jsx/dom/server.ts:21-24](repo://src/jsx/dom/server.ts#L21-L24), [src/jsx/dom/server.ts:50-56](repo://src/jsx/dom/server.ts#L50-L56)
